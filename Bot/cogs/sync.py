import discord
from discord.ext import commands, tasks
import asyncpg
import config
import asyncio

class SyncData(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db_dsn = config.DB_DSN

    async def cog_load(self):
        self.sync_loop.start()
        self.fetch_missing_users_loop.start()

    @tasks.loop(minutes=30)
    async def sync_loop(self):
        await self.bot.wait_until_ready()
        guild = self.bot.get_guild(config.GUILD_ID)
        if not guild: return

        pool = await asyncpg.create_pool(
            self.db_dsn,
            server_settings={"application_name": "ymkw-bot-sync"},
        )
        try:
            channel_data = []
            channels = list(guild.text_channels) + list(getattr(guild, "forums", [])) + list(await guild.active_threads())

            for channel in channels:
                perms = channel.permissions_for(guild.me)
                if not perms.read_message_history or not perms.view_channel:
                    continue

                parent = getattr(channel, "parent", None) if isinstance(channel, discord.Thread) else None
                category = parent.category if parent and parent.category else getattr(channel, "category", None)

                if category:
                    cat_name = category.name
                    cat_id = category.id
                    cat_pos = category.position
                else:
                    cat_name = "未分類"
                    cat_id = None
                    cat_pos = 999

                base_position = parent.position if parent else getattr(channel, "position", 999)
                sort_position = (cat_pos * 1000) + base_position
                name = f"{parent.name} / {channel.name}" if parent else channel.name
                channel_data.append((channel.id, name, cat_name, cat_id, sort_position, True))

            await pool.execute("UPDATE channels SET is_active = FALSE")
            if channel_data:
                await pool.executemany('''
                    INSERT INTO channels (channel_id, name, category_name, category_id, position, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (channel_id) DO UPDATE 
                    SET name = EXCLUDED.name,
                        category_name = EXCLUDED.category_name,
                        category_id = EXCLUDED.category_id,
                        position = EXCLUDED.position,
                        is_active = EXCLUDED.is_active
                ''', channel_data)

            member_data = []
            for member in guild.members:
                if not member.bot and member.id not in config.EXCLUDED_USER_IDS:
                    avatar = str(member.display_avatar.url) if member.display_avatar else None
                    member_data.append((member.id, member.display_name, member.name, avatar))

            await pool.executemany('''
                INSERT INTO users (user_id, display_name, username, avatar_url)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id) DO UPDATE 
                SET display_name = EXCLUDED.display_name, username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
            ''', member_data)
            
            print(f"同期完了: チャンネル{len(channel_data)}件 / メンバー{len(member_data)}人")
            
        except Exception as e:
            print(f"同期エラー: {e}")
        finally:
            await pool.close()

    @tasks.loop(hours=12)
    async def fetch_missing_users_loop(self):
        await self.bot.wait_until_ready()
        
        pool = await asyncpg.create_pool(
            self.db_dsn,
            server_settings={"application_name": "ymkw-bot-sync"},
        )
        try:
            missing_ids = await pool.fetch('''
                SELECT DISTINCT m.user_id 
                FROM messages m
                LEFT JOIN users u ON m.user_id = u.user_id
                WHERE u.user_id IS NULL AND m.is_bot = FALSE AND m.user_id != ALL($1::bigint[])
            ''', list(config.EXCLUDED_USER_IDS))
            
            if not missing_ids: return

            print(f"Unknownユーザー補完開始: 対象{len(missing_ids)}人")
            
            updates = []
            for row in missing_ids:
                user_id = row['user_id']
                if user_id in config.EXCLUDED_USER_IDS:
                    continue
                try:
                    user = await self.bot.fetch_user(user_id)
                    avatar = str(user.display_avatar.url) if user.display_avatar else None
                    updates.append((user.id, user.display_name, user.name, avatar))
                    await asyncio.sleep(0.1)
                except discord.NotFound:
                    updates.append((user_id, "Deleted User", "deleted_user", None))
                except Exception as e:
                    print(f"User fetch error {user_id}: {e}")

            if updates:
                await pool.executemany('''
                    INSERT INTO users (user_id, display_name, username, avatar_url)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (user_id) DO NOTHING
                ''', updates)
                print(f"補完完了: {len(updates)}人")

        finally:
            await pool.close()

async def setup(bot):
    await bot.add_cog(SyncData(bot))
