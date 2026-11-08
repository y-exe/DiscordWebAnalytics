-- メインギルドのダッシュボード専用ドメイン (案内サイト ymkw.top とは分離)
-- is_primary: ギルドのダッシュボードを表す代表ドメイン (ランキングメッセージのボタン等のリンク先)
ALTER TABLE guild_domains ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO guild_domains (domain, guild_id, is_primary)
VALUES ('analytics.ymkw.top', 1355073968532619376, TRUE)
ON CONFLICT (domain) DO NOTHING;

UPDATE guild_domains SET is_primary = TRUE WHERE domain = 'analytics.ymkw.top';
