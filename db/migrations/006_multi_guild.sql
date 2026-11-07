-- マルチサーバー対応: ギルド設定・ドメイン・ギルド別メンバー表示名
CREATE TABLE IF NOT EXISTS guilds (
    guild_id BIGINT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    icon_url TEXT,
    announce_channel_id BIGINT,
    king_role_id BIGINT,
    excluded_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
    display_config JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guild_domains (
    domain TEXT PRIMARY KEY,
    guild_id BIGINT NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guild_members (
    guild_id BIGINT NOT NULL REFERENCES guilds (guild_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

-- 既存のメッセージから実在ギルドを登録する (名前・アイコンはBotの同期で埋まる)
INSERT INTO guilds (guild_id)
SELECT DISTINCT m.guild_id
FROM messages m
ON CONFLICT (guild_id) DO NOTHING;

-- メッセージが1件も無い環境でも既定ギルドを登録する
INSERT INTO guilds (guild_id)
VALUES (1355073968532619376)
ON CONFLICT (guild_id) DO NOTHING;

-- 既定ギルドの設定を環境変数・定数から移行する
UPDATE guilds SET
    king_role_id = 1503873180362739834,
    excluded_channel_ids = ARRAY[1406033558757314752::BIGINT],
    display_config = '{"whitelistChannelIds":["1355425464729993367","1355073969199382530","1357298745506791574","1450890768255422595","1373320764945858740","1356324385983697098","1355497603910865046","1355552587394449589","1371391700131647491","1355546326657667150","1399071027925094617","1355810985356689547","1360622424579899524","1356237901645746348","1406033558757314752","1383029750166982656","1355570062378930317","1355546503048859840","1361713489990779172"],"privateChatCategoryIds":["1355470118003540048","1356573392181919794","1355760969187463378","1355073969199382528","1355438544273019022","1356237701178982501","1411004698944602187","1508697019223375882","1371108563384012922"],"bottomChannelCategoryIds":["1355760969187463378"]}'::JSONB
WHERE guild_id = 1355073968532619376;

INSERT INTO guild_domains (domain, guild_id)
VALUES
    ('ymkw.top', 1355073968532619376),
    ('www.ymkw.top', 1355073968532619376)
ON CONFLICT (domain) DO NOTHING;

-- 既存データからギルド別メンバー表示名を復元する (最新名はBotの同期で更新される)
INSERT INTO guild_members (guild_id, user_id, display_name, avatar_url)
SELECT d.guild_id, u.user_id, u.display_name, u.avatar_url
FROM (
    SELECT DISTINCT guild_id, user_id
    FROM messages
    WHERE is_bot = FALSE
) d
JOIN users u ON u.user_id = d.user_id
ON CONFLICT (guild_id, user_id) DO NOTHING;

-- channels に所属ギルドを追加し、既存データをメッセージから復元する
ALTER TABLE channels ADD COLUMN IF NOT EXISTS guild_id BIGINT;

UPDATE channels c
SET guild_id = m.guild_id
FROM (
    SELECT channel_id, min(guild_id) AS guild_id
    FROM messages
    GROUP BY channel_id
) m
WHERE c.guild_id IS NULL AND c.channel_id = m.channel_id;

-- メッセージが1件も無いチャンネルは所属ギルドを復元できないため削除する (同期で再作成される)
DELETE FROM channels
WHERE guild_id IS NULL;

ALTER TABLE channels ALTER COLUMN guild_id SET NOT NULL;

ALTER TABLE channels
    ADD CONSTRAINT channels_guild_id_fkey
    FOREIGN KEY (guild_id) REFERENCES guilds (guild_id) ON DELETE CASCADE;
