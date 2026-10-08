SCHEMA = '''
CREATE TABLE IF NOT EXISTS admin_login_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_login_limits_expiry ON admin_login_limits (expires_at);
'''

QUERY = '''
INSERT INTO admin_login_limits (key, attempts, expires_at)
VALUES ($1, 1, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) + $3::double precision)
ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
                    THEN 1 ELSE admin_login_limits.attempts + 1 END,
    expires_at = CASE WHEN admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
                     THEN EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) + $3::double precision ELSE admin_login_limits.expires_at END
WHERE admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
   OR admin_login_limits.attempts < $2
RETURNING attempts
'''


async def initialize_login_limits(pool) -> None:
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute('SELECT pg_advisory_xact_lock(2026100801)')
            await connection.execute(SCHEMA)


async def consume_login_limits(pool, client_key: str, per_client: int, total: int, window: int) -> bool:
    if min(per_client, total, window) < 1:
        return False
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute('DELETE FROM admin_login_limits WHERE expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)')
            for key, limit in ((f'client:{client_key}', per_client), ('global', total)):
                if await connection.fetchrow(QUERY, key, limit, window) is None:
                    return False
    return True
