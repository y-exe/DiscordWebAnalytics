CREATE TABLE IF NOT EXISTS messages (
    message_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    channel_id BIGINT NOT NULL,
    guild_id BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_bot BOOLEAN DEFAULT FALSE,
    char_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    display_name TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS channels (
    channel_id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    category_name TEXT,
    category_id BIGINT,
    position INTEGER,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS backfill_progress (
    source_id BIGINT PRIMARY KEY,
    source_name TEXT NOT NULL,
    last_message_id BIGINT,
    last_created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_human_created_user
    ON messages (created_at, user_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_channel_created_user
    ON messages (channel_id, created_at, user_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_user_created
    ON messages (user_id, created_at) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_guild_channel_created_user
    ON messages (guild_id, channel_id, created_at, user_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_created_channel
    ON messages (created_at, channel_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_guild_created_user
    ON messages (guild_id, created_at, user_id) WHERE is_bot = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_human_channel_created
    ON messages (channel_id, created_at) WHERE is_bot = FALSE;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm
    ON users USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm
    ON users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_channels_category_id ON channels (category_id);
