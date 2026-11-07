-- migrate: no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_human_guild_created_user
    ON messages (guild_id, created_at, user_id) WHERE is_bot = FALSE;
