import discord
import asyncio
import asyncpg
import datetime
import os
import argparse
import config
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("history-backfill")

DEFAULT_AFTER = "2025-03-28"
BACKFILL_ARGS = None
BATCH_SIZE = 100
MAX_SOURCE_RETRIES = 5

# 除外するチャンネルID
EXCLUDE_CHANNEL_IDS = [
]

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.guilds = True

client = discord.Client(intents=intents)

async def backfill():
    logger.info("Starting history backfill process...")
    
    if not config.DB_DSN:
        logger.error("DB_DSN is not configured.")
        return

    pool = await asyncpg.create_pool(
        config.DB_DSN,
        min_size=1,
        max_size=5,
        command_timeout=120,
        server_settings={"application_name": "ymkw-history-scanner"},
    )
    try:
        args = BACKFILL_ARGS or parse_args()
        if args.reset_progress:
            await reset_progress(pool)
        after_date = parse_datetime(args.after)
        before_date = parse_datetime(args.before) if args.before else None
        logger.info(f"Fetching messages after {after_date.isoformat()}")
        if before_date:
            logger.info(f"Fetching messages before {before_date.isoformat()}")
        
        guild = client.get_guild(config.GUILD_ID)
        if not guild:
             logger.error(f"Guild not found (ID: {config.GUILD_ID}).")
             return

        total_messages = 0
        
        text_channels = [c for c in guild.text_channels if c.id not in EXCLUDE_CHANNEL_IDS]
        forum_channels = [c for c in getattr(guild, "forums", []) if c.id not in EXCLUDE_CHANNEL_IDS]
        logger.info(f"Found {len(text_channels)} text channels and {len(forum_channels)} forum channels.")
        await save_channels(pool, text_channels + forum_channels, mark_missing_inactive=True)

        sources = []
        sources.extend(text_channels)

        threads = await collect_threads(guild, text_channels + forum_channels)
        await save_channels(pool, threads, mark_missing_inactive=False)
        sources.extend(threads)
        logger.info(f"Scanning {len(sources)} message sources including {len(threads)} threads.")

        failed_sources = []
        skipped_permission_sources = 0
        for i, channel in enumerate(sources):
            processed, success = await scan_message_source(pool, guild, channel, after_date, before_date, i + 1, len(sources))
            total_messages += processed
            if success is None:
                skipped_permission_sources += 1
                continue
            if not success:
                failed_sources.append(format_channel_name(channel))
                    
        logger.info(f"==========\nBackfill complete! Total processed: {total_messages} messages.")
        if skipped_permission_sources:
            logger.warning(f"Skipped {skipped_permission_sources} message sources due to missing channel permissions.")
        if failed_sources:
            raise RuntimeError(f"Backfill finished with {len(failed_sources)} incomplete sources: {', '.join(failed_sources[:10])}")
    finally:
        await pool.close()

def parse_args():
    parser = argparse.ArgumentParser(description="Backfill Discord message metadata into PostgreSQL.")
    parser.add_argument(
        "--after",
        default=os.getenv("BACKFILL_AFTER", DEFAULT_AFTER),
        help=f"Fetch messages after this date/time. Default: {DEFAULT_AFTER}. Example: 2025-03-28 or 2025-03-28T00:00:00+09:00",
    )
    parser.add_argument(
        "--before",
        default=os.getenv("BACKFILL_BEFORE"),
        help="Optional end date/time. Example: 2026-05-01 or 2026-05-01T00:00:00+09:00",
    )
    parser.add_argument(
        "--reset-progress",
        action="store_true",
        help="Clear saved backfill progress before scanning from --after.",
    )
    return parser.parse_args()

def parse_datetime(value):
    if not value:
        value = DEFAULT_AFTER

    normalized = value.strip()
    if len(normalized) == 10:
        normalized = f"{normalized}T00:00:00+09:00"
    normalized = normalized.replace("Z", "+00:00")

    parsed = datetime.datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=9)))
    return parsed.astimezone(datetime.timezone.utc)

async def collect_threads(guild, parent_channels):
    threads_by_id = {}
    skipped_permission_count = 0

    for thread in await guild.active_threads():
        if thread.parent_id not in {c.id for c in parent_channels}:
            continue
        if thread.id not in EXCLUDE_CHANNEL_IDS:
            threads_by_id[thread.id] = thread

    for parent in parent_channels:
        perms = parent.permissions_for(guild.me)
        if not perms.read_message_history or not perms.view_channel:
            skipped_permission_count += 1
            continue

        for thread in getattr(parent, "threads", []):
            if thread.id not in EXCLUDE_CHANNEL_IDS:
                threads_by_id[thread.id] = thread

        try:
            async for thread in parent.archived_threads(limit=None):
                if thread.id not in EXCLUDE_CHANNEL_IDS:
                    threads_by_id[thread.id] = thread
        except discord.Forbidden:
            logger.warning(f"Skipping archived threads in {parent.name}: Missing permissions.")
        except Exception as e:
            logger.warning(f"Failed to fetch archived threads in {parent.name}: {e}")

        if isinstance(parent, discord.TextChannel):
            try:
                async for thread in parent.archived_threads(private=True, joined=True, limit=None):
                    if thread.id not in EXCLUDE_CHANNEL_IDS:
                        threads_by_id[thread.id] = thread
            except discord.Forbidden:
                logger.info(f"Skipping unjoined private archived threads in {parent.name}: Discord requires thread access.")
            except Exception as e:
                logger.warning(f"Failed to fetch private archived threads in {parent.name}: {e}")

        await asyncio.sleep(0.5)

    if skipped_permission_count:
        logger.warning(f"Skipped archived-thread discovery in {skipped_permission_count} channels due to missing channel permissions.")

    return list(threads_by_id.values())

async def scan_message_source(pool, guild, channel, after_date, before_date, index, total):
    perms = channel.permissions_for(guild.me)
    if not perms.read_message_history or not perms.view_channel:
        return 0, None

    logger.info(f"[{index}/{total}] Scanning: {format_channel_name(channel)}...")
    processed = 0
    retries = 0
    progress = await load_progress(pool, channel.id)
    cursor_after = after_date
    if progress and progress["last_message_id"] and progress["last_created_at"] and progress["last_created_at"] > after_date:
        cursor_after = discord.Object(id=progress["last_message_id"])
        logger.info(f"Resuming {format_channel_name(channel)} after message {progress['last_message_id']} ({progress['last_created_at'].isoformat()})")
    else:
        progress = None

    while True:
        try:
            channel_count, completed = await scan_message_source_once(pool, channel, cursor_after, before_date)
            processed += channel_count
            if completed:
                logger.info(f"Finished {format_channel_name(channel)}: Processed {processed} messages.")
                await asyncio.sleep(2.0)
                return processed, True

            new_progress = await load_progress(pool, channel.id)
            if not new_progress or (progress and new_progress["last_message_id"] == progress["last_message_id"]):
                logger.error(f"Progress did not advance in {format_channel_name(channel)}. Stopping this source.")
                return processed, False
            progress = new_progress
            cursor_after = discord.Object(id=progress["last_message_id"])
            retries = 0

        except discord.Forbidden:
            logger.error(f"Forbidden error in {format_channel_name(channel)}. Skipping.")
            return processed, None
        except (discord.HTTPException, asyncio.TimeoutError, OSError) as e:
            retries += 1
            progress = await load_progress(pool, channel.id)
            if progress and progress["last_message_id"]:
                cursor_after = discord.Object(id=progress["last_message_id"])
            if retries > MAX_SOURCE_RETRIES:
                logger.error(f"Giving up {format_channel_name(channel)} after {retries} retries: {e}")
                return processed, False
            wait_seconds = min(60, 5 * retries)
            logger.warning(f"Temporary error in {format_channel_name(channel)}: {e}. Retry {retries}/{MAX_SOURCE_RETRIES} after {wait_seconds}s.")
            await asyncio.sleep(wait_seconds)
        except Exception as e:
            logger.error(f"Error scanning {format_channel_name(channel)}: {e}")
            return processed, False

async def scan_message_source_once(pool, channel, after_date, before_date):
    batch_messages = []
    user_data = {}
    channel_count = 0

    async for msg in channel.history(limit=None, after=after_date, before=before_date, oldest_first=True):
        if msg.author.id in config.EXCLUDED_USER_IDS:
            continue

        batch_messages.append((
            msg.id,
            msg.author.id,
            msg.channel.id,
            msg.guild.id,
            msg.created_at,
            msg.author.bot,
            len(msg.content)
        ))

        if msg.author.id not in user_data:
            avatar = str(msg.author.display_avatar.url) if msg.author.display_avatar else None
            user_data[msg.author.id] = (
                msg.author.id,
                msg.author.display_name,
                msg.author.name,
                avatar
            )

        if len(batch_messages) >= BATCH_SIZE:
            await save_to_db(pool, batch_messages, user_data)
            await save_progress(pool, msg.channel.id, format_channel_name(msg.channel), msg.id, msg.created_at)
            channel_count += len(batch_messages)
            batch_messages = []
            user_data = {}
            await asyncio.sleep(0.5)

    if batch_messages or user_data:
        last_message = batch_messages[-1] if batch_messages else None
        await save_to_db(pool, batch_messages, user_data)
        if last_message:
            await save_progress(pool, channel.id, format_channel_name(channel), last_message[0], last_message[4])
        channel_count += len(batch_messages)

    return channel_count, True

async def load_progress(pool, source_id):
    async with pool.acquire() as conn:
        return await conn.fetchrow("SELECT last_message_id, last_created_at FROM backfill_progress WHERE source_id = $1", source_id)

async def reset_progress(pool):
    async with pool.acquire() as conn:
        await conn.execute("TRUNCATE TABLE backfill_progress")
    logger.info("Cleared backfill progress.")

async def save_progress(pool, source_id, source_name, message_id, created_at):
    async with pool.acquire() as conn:
        await conn.execute('''
            INSERT INTO backfill_progress (source_id, source_name, last_message_id, last_created_at, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (source_id) DO UPDATE
            SET source_name = EXCLUDED.source_name,
                last_message_id = EXCLUDED.last_message_id,
                last_created_at = EXCLUDED.last_created_at,
                updated_at = CURRENT_TIMESTAMP
        ''', source_id, source_name, message_id, created_at)

def format_channel_name(channel):
    parent = getattr(channel, "parent", None)
    if isinstance(channel, discord.Thread) and parent:
        return f"{parent.name} / {channel.name}"
    return channel.name

async def save_channels(pool, channels, mark_missing_inactive=False):
    channel_data = []
    for channel in channels:
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
        channel_data.append((channel.id, format_channel_name(channel), cat_name, cat_id, sort_position, True))

    async with pool.acquire() as conn:
        async with conn.transaction():
            if mark_missing_inactive:
                await conn.execute("UPDATE channels SET is_active = FALSE")
            if channel_data:
                await conn.executemany('''
                    INSERT INTO channels (channel_id, name, category_name, category_id, position, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (channel_id) DO UPDATE
                    SET name = EXCLUDED.name,
                        category_name = EXCLUDED.category_name,
                        category_id = EXCLUDED.category_id,
                        position = EXCLUDED.position,
                        is_active = EXCLUDED.is_active
                ''', channel_data)
    logger.info(f"Synced {len(channel_data)} channels.")

async def save_to_db(pool, messages, users):
    filtered_users = [u for u in users.values() if u[0] not in config.EXCLUDED_USER_IDS] if users else []
    filtered_messages = [m for m in messages if m[1] not in config.EXCLUDED_USER_IDS] if messages else []

    async with pool.acquire() as conn:
        async with conn.transaction():
            if filtered_users:
                await conn.executemany('''
                    INSERT INTO users (user_id, display_name, username, avatar_url)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (user_id) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        username = EXCLUDED.username,
                        avatar_url = EXCLUDED.avatar_url
                ''', filtered_users)
            
            if filtered_messages:
                await conn.executemany('''
                    INSERT INTO messages (message_id, user_id, channel_id, guild_id, created_at, is_bot, char_count)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (message_id) DO UPDATE SET
                        user_id = EXCLUDED.user_id,
                        channel_id = EXCLUDED.channel_id,
                        guild_id = EXCLUDED.guild_id,
                        created_at = EXCLUDED.created_at,
                        is_bot = EXCLUDED.is_bot,
                        char_count = EXCLUDED.char_count
                ''', filtered_messages)

@client.event
async def on_ready():
    logger.info(f"Logged in as {client.user}")
    try:
        await backfill()
    finally:
        logger.info("Closing client...")
        await client.close()

if __name__ == "__main__":
    BACKFILL_ARGS = parse_args()
    if not config.TOKEN:
        logger.error("DISCORD_TOKEN is missing in .env")
    else:
        try:
            client.run(config.TOKEN)
        except Exception as e:
            logger.error(f"Bot execution error: {e}")
            sys.exit(1)
