-- ドメイン登録フロー (フェーズ7) 用の列を追加する。
-- source: ドメインの種類 ('primary'=既定ギルドの代表ドメイン, 'invite'=サブドメイン, 'custom'=独自ドメイン)
-- invite_code: サブドメインの元になった招待コード (失効チェック用)
-- is_active: 失効した招待に紐づくサブドメインを無効化するフラグ
ALTER TABLE guild_domains
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS invite_code TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 既存の primary フラグを source に反映する
UPDATE guild_domains SET source = 'primary' WHERE is_primary AND source = 'custom';
