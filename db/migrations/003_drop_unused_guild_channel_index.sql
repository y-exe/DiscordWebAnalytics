-- migrate: no-transaction
DROP INDEX CONCURRENTLY IF EXISTS idx_messages_human_guild_channel_created_user;
