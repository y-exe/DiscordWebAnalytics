import discord
from discord.ext import commands
import asyncpg
import config

class Logger(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.db_dsn = config.DB_DSN
        self.pool = None
        self.known_channel_ids = set()

    async def cog_load(self):
        self.pool = await asyncpg.create_pool(
            self.db_dsn,
            min_size=1,
            max_size=4,
            server_settings={"application_name": "ymkw-bot-logger"},
        )

    async def cog_unload(self):
        if self.pool:
            await self.pool.close()

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or not message.guild or message.author.id in config.EXCLUDED_USER_IDS:
            return

        try:
            await self.ensure_channel(message.channel)
            await self.pool.execute("""
                INSERT INTO messages (message_id, user_id, channel_id, guild_id, created_at, is_bot, char_count)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (message_id) DO NOTHING
            """, 
            message.id, 
            message.author.id, 
            message.channel.id, 
            message.guild.id, 
            message.created_at, 
            message.author.bot, 
            len(message.content)
            )
        except Exception as e:
            print(f"Log Error: {e}")

    async def ensure_channel(self, channel):
        if channel.id in self.known_channel_ids:
            return

        parent = getattr(channel, "parent", None) if isinstance(channel, discord.Thread) else None
        category = parent.category if parent and parent.category else getattr(channel, "category", None)

        if category:
            category_name = category.name
            category_id = category.id
            category_position = category.position
        else:
            category_name = "未分類"
            category_id = None
            category_position = 999

        base_position = parent.position if parent else getattr(channel, "position", 999)
        position = (category_position * 1000) + base_position
        name = f"{parent.name} / {channel.name}" if parent else channel.name

        await self.pool.execute('''
            INSERT INTO channels (channel_id, name, category_name, category_id, position, is_active)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            ON CONFLICT (channel_id) DO UPDATE
            SET name = EXCLUDED.name,
                category_name = EXCLUDED.category_name,
                category_id = EXCLUDED.category_id,
                position = EXCLUDED.position,
                is_active = TRUE
        ''', channel.id, name, category_name, category_id, position)
        self.known_channel_ids.add(channel.id)

    @commands.Cog.listener()
    async def on_raw_message_delete(self, payload):
        try:
            await self.pool.execute(
                "DELETE FROM messages WHERE message_id = $1", 
                payload.message_id
            )
        except Exception as e:
            print(f"Delete Error: {e}")

    @commands.Cog.listener()
    async def on_raw_bulk_message_delete(self, payload):
        if not payload.message_ids:
            return
        try:
            await self.pool.execute(
                "DELETE FROM messages WHERE message_id = ANY($1::bigint[])",
                list(payload.message_ids)
            )
        except Exception as e:
            print(f"Bulk Delete Error: {e}")

async def setup(bot):
    await bot.add_cog(Logger(bot))
