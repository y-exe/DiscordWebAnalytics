CREATE TABLE IF NOT EXISTS monthly_role_runs (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    report_year INTEGER NOT NULL,
    report_month INTEGER NOT NULL CHECK (report_month BETWEEN 1 AND 12),
    winner_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, role_id, report_year, report_month)
);
