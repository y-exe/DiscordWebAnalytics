-- migrate: no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channels_guild
    ON channels (guild_id);
