import discord
from discord import ui, app_commands
from discord.ext import commands, tasks
import asyncpg
from datetime import datetime, timedelta, time
from dateutil.relativedelta import relativedelta
from zoneinfo import ZoneInfo
import config

# 定数
EMOJI_FIRST = "<:first:1452959005625417790>"
EMOJI_SECOND = "<:second:1452958981969543168>"
EMOJI_THIRD = "<:third:1452958880379306024>"
EXCLUDE_CHANNEL_ID = 1406033558757314752
KING_ROLE_ID = 1452968848998531245

DELETED_USER_FILTER = "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')"

# 古いボタン対策
class DummyOldRankingView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(custom_id="view_ranking_details", style=discord.ButtonStyle.success, label="詳細を見る", emoji="📊")
    async def old_button_handler(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message(
            "このボタンは古いランキングのものです。\n新しいランキングメッセージをご利用ください！",
            ephemeral=True
        )

# 月選択プルダウン
class MonthSelect(discord.ui.Select):
    def __init__(self, bot):
        self.bot = bot
        options = []
        now = datetime.now(ZoneInfo("Asia/Tokyo"))
        for i in range(12):
            date = now - relativedelta(months=i)
            label = date.strftime("%Y年 %m月")
            value = date.strftime("%Y-%m")
            options.append(discord.SelectOption(label=label, value=value))
            
        super().__init__(placeholder="集計したい月を選択してください...", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        year_str, month_str = self.values[0].split("-")
        year, month = int(year_str), int(month_str)
        
        await interaction.response.send_message(f"<:2_:1453233982647959752> {year}年{month}月の集計を開始し、結果を送信します...", ephemeral=True)
        
        cog = self.bot.get_cog("Ranking")
        if cog:
            target_guild = self.bot.get_guild(config.GUILD_ID)
            await cog.run_ranking_logic(target_guild, year, month, channel=interaction.channel)

class MonthSelectView(discord.ui.View):
    def __init__(self, bot):
        super().__init__()
        self.add_item(MonthSelect(bot))

class Ranking(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # 月初めの自動ランキング送信を一時停止（復活させる場合はコメントアウトを外す）
        # self.monthly_task.start()

    async def get_db_pool(self):
        return await asyncpg.create_pool(
            config.DB_DSN,
            server_settings={"application_name": "ymkw-bot-ranking"},
        )

    def create_ranking_view(self, title: str, rows, year: int, month: int, show_role_reward: bool = True, custom_url: str = None):
        container = ui.Container(accent_color=0x00ddff)

        if month == 12:
            container.add_item(ui.TextDisplay("**🎍あけましておめでとうございます🎍**"))

        container.add_item(ui.TextDisplay(f"# {title}"))
        container.add_item(ui.TextDisplay(f"-# <#{EXCLUDE_CHANNEL_ID}>はランキングに含まれません"))
        container.add_item(ui.TextDisplay("-# <:4_:1453234089980334255> **プラチャ内の発言もカウントされます。**"))

        top_user_id = None
        for i, row in enumerate(rows):
            user_id = row['user_id']
            count = row.get('count') or row.get('msg_count')
            user_name = row['display_name'] if row['display_name'] else f"<@{user_id}>"

            if i == 0:
                top_user_id = user_id
                rank_str = f"## {EMOJI_FIRST} **{user_name}** (<@{user_id}>) — **{count}回**"
            elif i == 1:
                rank_str = f"### {EMOJI_SECOND} **{user_name}** (<@{user_id}>) — **{count}回**"
            elif i == 2:
                rank_str = f"### {EMOJI_THIRD} **{user_name}** (<@{user_id}>) — **{count}回**"
            else:
                rank_str = f"**{i+1}位** **{user_name}** (<@{user_id}>) — **{count}回**"

            container.add_item(ui.TextDisplay(rank_str))

        container.add_item(ui.Separator())

        if show_role_reward and top_user_id:
            container.add_item(ui.TextDisplay(
                f"**<:4_:1453234089980334255> 1位の <@{top_user_id}> には <@&1452967299404271686> ロールが付与されます**"
            ))
            container.add_item(ui.TextDisplay("-# 1か月ごとに切り替わります"))
            container.add_item(ui.Separator())

        container.add_item(ui.TextDisplay("### <:2_:1453233982647959752> Web上でさらに詳しく見ることができます"))
        container.add_item(ui.TextDisplay("-# **<a:6_:1455555980816285730> 個人分析・全体分析・グラフ分析・チャンネル比較 など**"))

        action_row = ui.ActionRow()
        target_url = custom_url if custom_url else f"https://ymkw.top/month/{year}/{month}"
        
        action_row.add_item(
            ui.Button(
                label="WEBで詳しく見る",
                style=discord.ButtonStyle.url,
                url=target_url,
                emoji="<:3_:1453234036339245249>"
            )
        )
        action_row.add_item(
            ui.Button(
                label="全期間のデータを見る",
                style=discord.ButtonStyle.url,
                url="https://ymkw.top/all",
                emoji="<:3_:1453234036339245249>"
            )
        )
        container.add_item(action_row)

        view = ui.LayoutView()
        view.add_item(container)

        return view

    # 月次タスク（月初めの自動ランキング送信。一時停止中。復活させる場合はコメントアウトを外す）
    # @tasks.loop(time=[time(hour=0, minute=0, tzinfo=ZoneInfo("Asia/Tokyo"))])
    # async def monthly_task(self):
    #     now = datetime.now(ZoneInfo("Asia/Tokyo"))
    #     if now.day != 1: return
    #     last_month = now - relativedelta(months=1)
    #     guild = self.bot.get_guild(config.GUILD_ID)
    #     await self.run_ranking_logic(guild, last_month.year, last_month.month, is_auto=True)

    # コマンド: /month
    @app_commands.command(name="month", description="【管理者用】指定した月のランキングを手動送信")
    async def open_month(self, interaction: discord.Interaction):
        if interaction.user.id != config.OWNER_ID:
            return await interaction.response.send_message("権限がありません", ephemeral=True)
        view = MonthSelectView(self.bot)
        await interaction.response.send_message("集計したい月を選択してください:", view=view, ephemeral=True)

    # コマンド: /all
    @app_commands.command(name="all", description="【管理者用】全期間のランキングを表示")
    async def all_total(self, interaction: discord.Interaction):
        if interaction.user.id != config.OWNER_ID:
            return await interaction.response.send_message("権限がありません", ephemeral=True)

        await interaction.response.defer()
        
        pool = await self.get_db_pool()
        try:
            rows = await pool.fetch(f"""
                SELECT
                    m.user_id,
                    count(*) as count,
                    u.display_name,
                    u.username,
                    u.avatar_url as avatar
                FROM messages m
                LEFT JOIN users u ON m.user_id = u.user_id
                WHERE m.is_bot = FALSE AND m.guild_id = $1 AND m.channel_id != {EXCLUDE_CHANNEL_ID}
                  AND {DELETED_USER_FILTER}
                GROUP BY m.user_id, u.display_name, u.username, u.avatar_url
                ORDER BY count DESC
                LIMIT 100
            """, config.GUILD_ID)

            if not rows:
                await interaction.followup.send("データがありません")
                return

            now_jst = datetime.now(ZoneInfo("Asia/Tokyo"))
            view = self.create_ranking_view(
                "🏆 全期間の発言ランキング",
                rows[:10], 
                now_jst.year, 
                now_jst.month, 
                show_role_reward=False,
                custom_url="https://ymkw.top/all"
            )
            
            await interaction.channel.send(
                view=view,
                allowed_mentions=discord.AllowedMentions.none()
            )
            await interaction.followup.send("✅ 全期間ランキングを送信しました。", ephemeral=True)

        finally:
            await pool.close()

    # 共通ロジック
    async def run_ranking_logic(self, guild, year, month, channel=None, is_auto=False):
        pool = await self.get_db_pool()
        start_date = datetime(year, month, 1)
        end_date = (start_date + relativedelta(months=1)) - timedelta(seconds=1)

        try:
            rows = await pool.fetch(f"""
                SELECT m.user_id, count(*) as count, u.display_name
                FROM messages m
                LEFT JOIN users u ON m.user_id = u.user_id
                WHERE m.created_at >= $1 AND m.created_at <= $2
                  AND m.is_bot = FALSE AND m.guild_id = $3 AND m.channel_id != {EXCLUDE_CHANNEL_ID}
                  AND {DELETED_USER_FILTER}
                GROUP BY m.user_id, u.display_name
                ORDER BY count DESC
                LIMIT 10
            """, start_date, end_date, config.GUILD_ID)

            if not rows:
                if channel: await channel.send(f"{year}年{month}月のデータはありません。")
                return

            title = f"<:1_:1453233921310589059> {year}年{month}月の発言ランキングはこちら！"
            view = self.create_ranking_view(title, rows, year, month)

            target_channel = channel
            if is_auto and guild:
                target_channel = guild.get_channel(config.ANNOUNCE_CHANNEL_ID)
            elif is_auto and not guild:
                try: target_channel = await self.bot.fetch_channel(config.ANNOUNCE_CHANNEL_ID)
                except: pass

            if target_channel:
                await target_channel.send(
                    view=view,
                    allowed_mentions=discord.AllowedMentions.none()
                )

            if rows and guild:
                top_user_id = rows[0]['user_id']
                king_role = guild.get_role(KING_ROLE_ID)
                if king_role:
                    for m in king_role.members:
                        try: await m.remove_roles(king_role)
                        except: pass
                    new_king = guild.get_member(top_user_id)
                    if new_king:
                        try: await new_king.add_roles(king_role)
                        except: pass

        except Exception as e:
            print(f"Ranking Error: {e}")
        finally:
            await pool.close()

async def setup(bot):
    await bot.add_cog(Ranking(bot))
    bot.add_view(DummyOldRankingView())
