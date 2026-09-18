import os
import socket
from urllib.parse import urlparse, urlunparse
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
raw_dsn = os.getenv("DB_DSN")

def adjust_db_dsn(dsn: str) -> str:
    if not dsn:
        return None
    
    in_container = os.path.exists('/.dockerenv')
    if not in_container:
        parsed = urlparse(dsn)
        if parsed.hostname == "postgres-db":
            port = os.getenv("LOCAL_DB_PORT", "5433")
            userinfo = parsed.netloc.rsplit("@", 1)[0] + "@" if "@" in parsed.netloc else ""
            return urlunparse(parsed._replace(netloc=f"{userinfo}localhost:{port}"))
        return dsn.replace("localhost", "127.0.0.1") if "localhost" in dsn else dsn
    
    if "localhost" in dsn or "127.0.0.1" in dsn:
        try:
            socket.gethostbyname('host.docker.internal')
            return dsn.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal").replace("postgres-db", "host.docker.internal")
        except socket.gaierror:
            return dsn.replace("127.0.0.1", "postgres-db").replace("localhost", "postgres-db")
    return dsn

DB_DSN = adjust_db_dsn(raw_dsn)

GUILD_ID = int(os.getenv("GUILD_ID", 0))
OWNER_ID = int(os.getenv("OWNER_ID", 0))
ADMIN_ROLE_ID = int(os.getenv("ADMIN_ROLE_ID", 0))

KING_ROLE_ID = int(os.getenv("KING_ROLE_ID", 0))
ANNOUNCE_CHANNEL_ID = int(os.getenv("ANNOUNCE_CHANNEL_ID", 0))

raw_excluded_users = os.getenv("EXCLUDED_USER_IDS", "1491111267522314442")
EXCLUDED_USER_IDS = set(int(uid.strip()) for uid in raw_excluded_users.split(",") if uid.strip().isdigit())

