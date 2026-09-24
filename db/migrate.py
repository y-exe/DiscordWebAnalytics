"""Apply versioned PostgreSQL schema migrations from db/migrations."""

import asyncio
import hashlib
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import asyncpg
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def get_dsn() -> str:
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "Bot" / ".env")
    load_dotenv(ROOT / "backend" / ".env")
    dsn = os.getenv("DB_DSN")
    if not dsn:
        raise SystemExit("DB_DSN is required (environment, Bot/.env, or backend/.env).")

    if not Path("/.dockerenv").exists():
        parsed = urlparse(dsn)
        if parsed.hostname == "postgres-db":
            port = os.getenv("LOCAL_DB_PORT", "5433")
            userinfo = parsed.netloc.rsplit("@", 1)[0] + "@" if "@" in parsed.netloc else ""
            return urlunparse(parsed._replace(netloc=f"{userinfo}127.0.0.1:{port}"))
        if parsed.hostname == "localhost":
            dsn = dsn.replace("localhost", "127.0.0.1")
    return dsn


async def migrate() -> None:
    connection = await asyncpg.connect(get_dsn())
    try:
        await connection.execute("SELECT pg_advisory_lock(hashtext('ymkw-top-schema-migrations'))")
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        applied = {
            row["filename"]: row["checksum"]
            for row in await connection.fetch("SELECT filename, checksum FROM schema_migrations")
        }
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            sql = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
            previous_checksum = applied.get(path.name)
            if previous_checksum:
                if previous_checksum != checksum:
                    raise RuntimeError(f"Applied migration was edited: {path.name}")
                continue

            async with connection.transaction():
                await connection.execute(sql)
                await connection.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
                    path.name,
                    checksum,
                )
            print(f"Applied {path.name}")
    finally:
        try:
            await connection.execute("SELECT pg_advisory_unlock(hashtext('ymkw-top-schema-migrations'))")
        finally:
            await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
