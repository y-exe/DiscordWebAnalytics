import json
import os
import sqlite3
import threading
import time
from typing import Any, Optional


class SafeDiskCache:
    """Small process-safe SQLite cache that only serializes JSON values."""

    def __init__(self, directory: str, size_limit: int) -> None:
        os.makedirs(directory, mode=0o700, exist_ok=True)
        self.path = os.path.join(directory, "cache.sqlite3")
        self.size_limit = max(size_limit, 1024 * 1024)
        self._lock = threading.RLock()
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS cache_entries (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    expires_at REAL,
                    accessed_at REAL NOT NULL,
                    value_size INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries (expires_at)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_cache_accessed ON cache_entries (accessed_at)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=5)

    def get(self, key: str, default: Any = None) -> Any:
        now = time.time()
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT value, expires_at FROM cache_entries WHERE key = ?",
                (key,),
            ).fetchone()
            if not row:
                return default
            if row[1] is not None and row[1] <= now:
                connection.execute("DELETE FROM cache_entries WHERE key = ?", (key,))
                return default
            connection.execute(
                "UPDATE cache_entries SET accessed_at = ? WHERE key = ?",
                (now, key),
            )
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            with self._lock, self._connect() as connection:
                connection.execute("DELETE FROM cache_entries WHERE key = ?", (key,))
            return default

    def set(self, key: str, value: Any, expire: Optional[float] = None) -> None:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        encoded_size = len(encoded.encode("utf-8"))
        now = time.time()
        expires_at = now + expire if expire is not None else None

        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at <= ?",
                (now,),
            )
            connection.execute(
                """
                INSERT INTO cache_entries (key, value, expires_at, accessed_at, value_size)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    expires_at = excluded.expires_at,
                    accessed_at = excluded.accessed_at,
                    value_size = excluded.value_size
                """,
                (key, encoded, expires_at, now, encoded_size),
            )
            total_size = connection.execute(
                "SELECT COALESCE(SUM(value_size), 0) FROM cache_entries"
            ).fetchone()[0]
            while total_size > self.size_limit:
                removed = connection.execute(
                    """
                    DELETE FROM cache_entries
                    WHERE key IN (
                        SELECT key FROM cache_entries ORDER BY accessed_at ASC LIMIT 100
                    )
                    """
                ).rowcount
                if removed == 0:
                    break
                total_size = connection.execute(
                    "SELECT COALESCE(SUM(value_size), 0) FROM cache_entries"
                ).fetchone()[0]

    def close(self) -> None:
        return None
