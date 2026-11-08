-- ユーザープロフィール詳細 (バナー・装飾・ネームプレート・サーバータグ) と
-- ギルドメンバー情報 (ギルドバナー・参加日・ブースト開始日) を追加する。
-- 値はBotの同期時にCDN URLとして保存する。
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS banner_url TEXT,
    ADD COLUMN IF NOT EXISTS accent_color TEXT,
    ADD COLUMN IF NOT EXISTS avatar_decoration_url TEXT,
    ADD COLUMN IF NOT EXISTS nameplate_asset TEXT,
    ADD COLUMN IF NOT EXISTS nameplate_palette TEXT,
    ADD COLUMN IF NOT EXISTS primary_guild_tag TEXT,
    ADD COLUMN IF NOT EXISTS primary_guild_badge_url TEXT;

ALTER TABLE guild_members
    ADD COLUMN IF NOT EXISTS banner_url TEXT,
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ;
