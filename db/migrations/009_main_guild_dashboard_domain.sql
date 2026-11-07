-- メインギルドのダッシュボード専用ドメイン (案内サイト ymkw.top とは分離)
INSERT INTO guild_domains (domain, guild_id)
VALUES ('analytics.ymkw.top', 1355073968532619376)
ON CONFLICT (domain) DO NOTHING;
