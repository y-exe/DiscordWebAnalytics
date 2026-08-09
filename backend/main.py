from fastapi import FastAPI, HTTPException, Response, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
import aiohttp
import os
import sys
import asyncio
import time
import tempfile
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import List, Optional, Any, Tuple
from pathlib import Path
from datetime import datetime
import socket
import logging
import base64
import hashlib
import hmac
from zoneinfo import ZoneInfo

try:
    from .safe_cache import SafeDiskCache
except ImportError:
    from safe_cache import SafeDiskCache

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("ymkw-api")

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

load_dotenv()
raw_dsn = os.getenv("DB_DSN")
API_SECRET = os.getenv("API_SECRET", "").strip()
ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "").strip()

if not raw_dsn:
    BASE_DIR = Path(__file__).resolve().parent
    ENV_PATH = BASE_DIR.parent / "Bot" / ".env"
    if not ENV_PATH.exists():
        ENV_PATH = BASE_DIR.parent / "bot" / ".env"
    load_dotenv(dotenv_path=ENV_PATH)
    raw_dsn = os.getenv("DB_DSN")
    API_SECRET = os.getenv("API_SECRET", "").strip()
    ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "").strip()

if not raw_dsn:
    sys.exit("ERROR: DB_DSN not found.")
if len(API_SECRET) < 32:
    sys.exit("ERROR: API_SECRET must be set to at least 32 characters.")
if len(ADMIN_SESSION_SECRET) < 32:
    sys.exit("ERROR: ADMIN_SESSION_SECRET must be set to at least 32 characters.")

def adjust_db_dsn(dsn: str) -> str:
    in_container = os.path.exists('/.dockerenv')
    if not in_container:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(dsn)
        if parsed.hostname == "postgres-db":
            port = os.getenv("LOCAL_DB_PORT", "5433")
            userinfo = parsed.netloc.rsplit("@", 1)[0] + "@" if "@" in parsed.netloc else ""
            return urlunparse(parsed._replace(netloc=f"{userinfo}localhost:{port}"))
        return dsn.replace("localhost", "127.0.0.1") if "localhost" in dsn else dsn
    
    if "localhost" in dsn or "127.0.0.1" in dsn:
        try:
            socket.gethostbyname('host.docker.internal')
            new_dsn = dsn.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
            logger.info("Detected container environment. Using 'host.docker.internal' for database connection.")
            return new_dsn
        except socket.gaierror:
            logger.warning("Running in container but 'host.docker.internal' is not resolvable. Keeping original DSN.")
            pass
    return dsn

DB_DSN = adjust_db_dsn(raw_dsn)

app = FastAPI()

ALLOWED_ORIGINS = [
    "https://ymkw.top",
    "https://www.ymkw.top",
    "http://localhost:4321",
    "http://127.0.0.1:4321",
]

WHITELIST_CHANNEL_IDS = [
    1355425464729993367,
    1355073969199382530,
    1357298745506791574,
    1450890768255422595,
    1373320764945858740,
    1356324385983697098,
    1355497603910865046,
    1355552587394449589,
    1371391700131647491,
    1355546326657667150,
    1399071027925094617,
    1355810985356689547,
    1360622424579899524,
    1356237901645746348,
    1406033558757314752,
    1383029750166982656,
    1355570062378930317,
    1355546503048859840,
    1361713489990779172,
]

PRIVATE_CHAT_CHANNEL_ID = -1
PRIVATE_CHAT_CATEGORY_IDS = [
    1355470118003540048,
    1356573392181919794,
    1355760969187463378,
    1355073969199382528,
    1355438544273019022,
    1356237701178982501,
    1411004698944602187,
    1508697019223375882,
    1371108563384012922,
]
BOTTOM_CHANNEL_CATEGORY_IDS = {1355760969187463378}

pool = None
cache_dir = os.path.join(tempfile.gettempdir(), "ymkw_api_diskcache_v14")
cache = SafeDiskCache(cache_dir, size_limit=int(os.getenv("CACHE_SIZE_LIMIT_BYTES", str(256 * 1024 * 1024))))

def get_cache(key: str):
    return cache.get(key)

def set_cache(key: str, data: Any, ttl: int = 600):
    cache.set(key, data, expire=ttl)

def cors_json_response(request: Request, status_code: int, content: dict, block_reason: Optional[str] = None):
    response = JSONResponse(status_code=status_code, content=content)
    if block_reason:
        response.headers["X-Debug-Block"] = block_reason
    return response

PUBLIC_PATHS = {"/", "/health", "/docs", "/openapi.json", "/favicon.ico"}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
DB_HEAVY_PREFIXES = ("/ranking", "/stats", "/users")

RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "10"))
MAX_REQUESTS = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "180"))
BOT_MAX_REQUESTS = int(os.getenv("RATE_LIMIT_BOT_MAX_REQUESTS", "900"))
DB_RATE_LIMIT_WINDOW = int(os.getenv("DB_RATE_LIMIT_WINDOW", "60"))
DB_MAX_REQUESTS = int(os.getenv("DB_RATE_LIMIT_MAX_REQUESTS", "135"))
DB_BOT_MAX_REQUESTS = int(os.getenv("DB_RATE_LIMIT_BOT_MAX_REQUESTS", "540"))
BLOCK_DURATION = int(os.getenv("RATE_LIMIT_BLOCK_DURATION", "600"))
TRUST_CLOUDFLARE_PROXY = os.getenv("TRUST_CLOUDFLARE_PROXY", "false").lower() == "true"
LIVE_TOTAL_CACHE_TTL = 1800
TOTAL_CACHE_WARM_INTERVAL = 600
ADMIN_COOKIE_NAME = "__Secure-ymkw_admin"
ADMIN_SESSION_MAX_AGE = 60 * 60 * 24

def get_client_ip(request: Request) -> str:
    if TRUST_CLOUDFLARE_PROXY:
        cloudflare_ip = request.headers.get("CF-Connecting-IP", "").strip()
        if cloudflare_ip:
            return cloudflare_ip
    return request.client.host if request.client else "unknown"

def is_api_client(request: Request) -> bool:
    supplied_key = request.headers.get("X-API-KEY", "")
    return bool(supplied_key) and hmac.compare_digest(supplied_key, API_SECRET)

def verify_admin_session(token: Optional[str]) -> bool:
    if not token:
        return False
    try:
        version, expires_raw, supplied_signature = token.split(".", 2)
        if version != "v1" or len(expires_raw) != 10 or not expires_raw.isdigit():
            return False
        expires_at = int(expires_raw)
        now = int(time.time())
        if expires_at <= now or expires_at > now + ADMIN_SESSION_MAX_AGE + 60:
            return False
        payload = f"{version}.{expires_raw}"
        signature = hmac.new(ADMIN_SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).digest()
        expected_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        return hmac.compare_digest(supplied_signature, expected_signature)
    except (ValueError, TypeError):
        return False

def require_month_access(request: Request, year: int, month: int) -> bool:
    now = datetime.now(ZoneInfo("Asia/Tokyo"))
    is_restricted = (year, month) >= (now.year, now.month)
    if is_restricted and not (is_api_client(request) or verify_admin_session(request.cookies.get(ADMIN_COOKIE_NAME))):
        raise HTTPException(status_code=403, detail="This month's report is not public yet.")
    return is_restricted

def set_month_cache_control(response: Response, is_restricted: bool) -> None:
    response.headers["Cache-Control"] = "private, no-store" if is_restricted else "public, max-age=600"

def is_db_heavy_path(path: str) -> bool:
    return path.startswith(DB_HEAVY_PREFIXES)

def rate_limit_check(client_ip: str, scope: str, limit: int, window: int) -> bool:
    count_key = f"rate_limit:{scope}:{client_ip}"
    current_data = cache.get(count_key)
    now = time.time()

    if current_data:
        first_req_time, count = current_data
        if now - first_req_time < window:
            new_count = count + 1
            if new_count > limit:
                return False
            ttl = max(1, window - (now - first_req_time))
            cache.set(count_key, (first_req_time, new_count), expire=ttl)
            return True

    cache.set(count_key, (now, 1), expire=window)
    return True

@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    is_bot = is_api_client(request)
    path = request.url.path
    is_public_path = path in PUBLIC_PATHS

    if request.method in WRITE_METHODS and not is_bot and not is_public_path:
        return cors_json_response(request, status_code=401, content={"detail": "API key required."}, block_reason="write-api-key-required")

    client_ip = get_client_ip(request)
    
    block_key = f"blocked:{client_ip}"
    if cache.get(block_key):
        return cors_json_response(request, status_code=429, content={"detail": "Too Many Requests. Blocked for 10 minutes."}, block_reason="rate-limit-active")

    request_limit = BOT_MAX_REQUESTS if is_bot else MAX_REQUESTS
    if not rate_limit_check(client_ip, "request", request_limit, RATE_LIMIT_WINDOW):
        cache.set(block_key, True, expire=BLOCK_DURATION)
        return cors_json_response(request, status_code=429, content={"detail": "Too Many Requests. Blocked for 10 minutes."}, block_reason="rate-limit-exceeded")

    if not is_public_path and is_db_heavy_path(path):
        db_limit = DB_BOT_MAX_REQUESTS if is_bot else DB_MAX_REQUESTS
        if not rate_limit_check(client_ip, "db", db_limit, DB_RATE_LIMIT_WINDOW):
            cache.set(block_key, True, expire=BLOCK_DURATION)
            return cors_json_response(request, status_code=429, content={"detail": "Too Many Requests. Blocked for 10 minutes."}, block_reason="db-rate-limit-exceeded")

    try:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response
    except Exception as e:
        logger.error(f"Unhandled exception during request: {request.method} {request.url.path}", exc_info=True)
        return cors_json_response(request, status_code=500, content={"detail": "Internal Server Error", "error_type": type(e).__name__}, block_reason="internal-error")

@app.on_event("startup")
async def startup():
    async def heartbeat_loop():
        push_url = os.getenv("WATCHER_PUSH_URL")
        if not push_url:
            logger.warning("WATCHER_PUSH_URL not set. Heartbeat disabled.")
            return
        
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    async with session.get(push_url) as resp:
                        if resp.status == 200:
                            logger.info(f"Heartbeat sent successfully to {push_url}")
                        else:
                            logger.warning(f"Heartbeat failed with status {resp.status}")
                except Exception as e:
                    logger.error(f"Heartbeat error: {e}")
                await asyncio.sleep(60)

    asyncio.create_task(heartbeat_loop())

    global pool
    try:
        from urllib.parse import urlparse
        parsed = urlparse(DB_DSN)
        safe_dsn = f"{parsed.scheme}://{parsed.username}:****@{parsed.hostname}:{parsed.port}{parsed.path}"
        logger.info(f"Connecting to database at {safe_dsn}")
        
        pool = await asyncpg.create_pool(DB_DSN, min_size=10, max_size=50, ssl=False, command_timeout=60)
        logger.info("Database connection pool created (size: 10-50).")
        await pool.execute("ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id BIGINT")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_channels_category_id ON channels (category_id)")
        asyncio.create_task(warm_total_cache_loop())
    except Exception as e:
        logger.error(f"Failed to create database pool: {e}")
        raise e

@app.on_event("shutdown")
async def shutdown():
    if pool: await pool.close()
    cache.close()

class ChannelItem(BaseModel):
    id: str
    name: str
    category: str

class RankingItem(BaseModel):
    user_id: str
    display_name: str
    username: str
    avatar: Optional[str]
    count: int
    char_count: int

def format_ranking_response(rows):
    return [{"user_id": str(r["user_id"]), "display_name": r["display_name"] or "Unknown", "username": r["username"] or "unknown", "avatar": r["avatar_url"], "count": r["c"], "char_count": r["chars"] or 0} for r in rows]

def format_user_rank_response(row):
    if not row:
        return None
    return {
        "user_id": str(row["user_id"]),
        "display_name": row["display_name"] or "Unknown",
        "username": row["username"] or "unknown",
        "avatar": row["avatar_url"],
        "count": row["c"],
        "char_count": row["chars"] or 0,
        "rank": row["rank"],
    }

def get_month_bounds(year: int, month: int) -> Tuple[datetime, datetime]:
    if year < 2020 or year > 2100:
        raise HTTPException(status_code=400, detail="year must be between 2020 and 2100")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    start = datetime(year, month, 1)
    if month == 12:
        return start, datetime(year + 1, 1, 1)
    return start, datetime(year, month + 1, 1)

def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

async def get_channel_scope_ids(channel_id: Optional[int]) -> Optional[List[int]]:
    if not channel_id:
        return None

    if channel_id != PRIVATE_CHAT_CHANNEL_ID and channel_id not in WHITELIST_CHANNEL_IDS:
        raise HTTPException(status_code=404, detail="Channel not found")

    if channel_id == PRIVATE_CHAT_CHANNEL_ID:
        rows = await pool.fetch(
            """
            SELECT channel_id
            FROM channels
            WHERE is_active = TRUE
              AND (
                  (category_id IS NULL AND category_name = '未分類')
                  OR (category_id IS NOT NULL AND NOT (category_id = ANY($1::bigint[])))
              )
            """,
            PRIVATE_CHAT_CATEGORY_IDS,
        )
        return [r["channel_id"] for r in rows]

    channel = await pool.fetchrow("SELECT name FROM channels WHERE channel_id = $1", channel_id)
    if not channel:
        return [channel_id]

    child_prefix = f"{escape_like(channel['name'])} / %"
    rows = await pool.fetch(
        """
        SELECT channel_id
        FROM channels
        WHERE channel_id = $1 OR name LIKE $2 ESCAPE '\\'
        """,
        channel_id,
        child_prefix,
    )
    return [r["channel_id"] for r in rows] or [channel_id]

def add_channel_scope_filter(params: List[Any], filters: List[str], column: str, channel_ids: Optional[List[int]]) -> None:
    if channel_ids is not None:
        params.append(channel_ids)
        filters.append(f"{column} = ANY(${len(params)}::bigint[])")

DELETED_USER_FILTER = "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')"

@app.get("/")
async def root():
    return PlainTextResponse("ymkw.top API by yexe")

@app.get("/health")
async def health():
    return PlainTextResponse("ok")

@app.get("/channels", response_model=List[ChannelItem])
async def get_channels(response: Response):
    ckey = "channels_list"
    cached = get_cache(ckey)
    response.headers["Cache-Control"] = "public, max-age=3600"
    if cached: return cached
    
    rows = await pool.fetch("SELECT * FROM channels WHERE is_active = TRUE ORDER BY position ASC")
    
    visible_rows = [r for r in rows if r["channel_id"] in WHITELIST_CHANNEL_IDS]
    visible_rows.sort(key=lambda r: (r["category_id"] in BOTTOM_CHANNEL_CATEGORY_IDS, r["position"] or 999999))

    res = [{
        "id": str(PRIVATE_CHAT_CHANNEL_ID),
        "name": "プラチャ総合",
        "category": "プラチャ",
    }]
    res.extend([
        {"id": str(r["channel_id"]), "name": r["name"], "category": r["category_name"] if r["category_name"] else "未分類"}
        for r in visible_rows
    ])
    
    set_cache(ckey, res, ttl=3600)
    return res

@app.get("/users/search")
async def search_users(q: str = Query(..., min_length=1, max_length=64)):
    search_query = q.strip()
    if not search_query: return []
    query = f"SELECT user_id, display_name, username, avatar_url FROM users u WHERE (display_name ILIKE $1 OR username ILIKE $1) AND {DELETED_USER_FILTER} LIMIT 10"
    rows = await pool.fetch(query, f"%{search_query}%")
    return [{"user_id": str(r['user_id']), "display_name": r['display_name'], "username": r['username'], "avatar": r['avatar_url']} for r in rows]

@app.get("/ranking/monthly/{year}/{month}", response_model=List[RankingItem])
async def get_monthly_ranking(year: int, month: int, response: Response, request: Request, channel_id: Optional[int] = Query(None)):
    is_restricted = require_month_access(request, year, month)
    ckey = f"rank_m_{year}_{month}_{channel_id}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached: return cached
    start_date, end_date = get_month_bounds(year, month)
    channel_ids = await get_channel_scope_ids(channel_id)
    p = [start_date, end_date]
    f = ["m.created_at >= $1", "m.created_at < $2", "m.is_bot = FALSE", DELETED_USER_FILTER]
    add_channel_scope_filter(p, f, "m.channel_id", channel_ids)
    query = f"SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE {' AND '.join(f)} GROUP BY m.user_id, u.display_name, u.username, u.avatar_url ORDER BY c DESC LIMIT 100"
    rows = await pool.fetch(query, *p)
    res = format_ranking_response(rows)
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/ranking/total", response_model=List[RankingItem])
async def get_total_ranking(response: Response, channel_id: Optional[int] = Query(None), end_date: Optional[datetime] = Query(None)):
    ckey = f"rank_t_{channel_id}_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached: return cached
    p = []; f = ["m.is_bot = FALSE", DELETED_USER_FILTER]
    add_channel_scope_filter(p, f, "m.channel_id", await get_channel_scope_ids(channel_id))
    if end_date: p.append(end_date); f.append(f"m.created_at <= ${len(p)}")
    query = f"SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE {' AND '.join(f)} GROUP BY m.user_id, u.display_name, u.username, u.avatar_url ORDER BY c DESC LIMIT 100"
    rows = await pool.fetch(query, *p)
    res = format_ranking_response(rows)
    set_cache(ckey, res, ttl=ttl)
    return res

@app.get("/users/{user_id}/rank/monthly/{year}/{month}")
async def get_monthly_user_rank(user_id: int, year: int, month: int, response: Response, request: Request, channel_id: Optional[int] = Query(None)):
    is_restricted = require_month_access(request, year, month)
    ckey = f"user_rank_m_{user_id}_{year}_{month}_{channel_id}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached is not None:
        return cached

    start_date, end_date = get_month_bounds(year, month)
    p = [start_date, end_date]
    f = ["m.created_at >= $1", "m.created_at < $2", "m.is_bot = FALSE", DELETED_USER_FILTER]
    add_channel_scope_filter(p, f, "m.channel_id", await get_channel_scope_ids(channel_id))
    p.append(user_id)
    target_param = f"${len(p)}"

    query = f"""
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE {' AND '.join(f)}
            GROUP BY m.user_id
        ),
        target AS (
            SELECT user_id, c, chars
            FROM counts
            WHERE user_id = {target_param}
        )
        SELECT
            t.user_id,
            t.c,
            t.chars,
            u.display_name,
            u.username,
            u.avatar_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    """
    row = await pool.fetchrow(query, *p)
    res = format_user_rank_response(row)
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/users/{user_id}/rank/total")
async def get_total_user_rank(user_id: int, response: Response, channel_id: Optional[int] = Query(None), end_date: Optional[datetime] = Query(None)):
    ckey = f"user_rank_t_{user_id}_{channel_id}_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached is not None:
        return cached

    p = []
    f = ["m.is_bot = FALSE", DELETED_USER_FILTER]
    add_channel_scope_filter(p, f, "m.channel_id", await get_channel_scope_ids(channel_id))
    if end_date:
        p.append(end_date)
        f.append(f"m.created_at <= ${len(p)}")
    p.append(user_id)
    target_param = f"${len(p)}"

    query = f"""
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE {' AND '.join(f)}
            GROUP BY m.user_id
        ),
        target AS (
            SELECT user_id, c, chars
            FROM counts
            WHERE user_id = {target_param}
        )
        SELECT
            t.user_id,
            t.c,
            t.chars,
            u.display_name,
            u.username,
            u.avatar_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    """
    row = await pool.fetchrow(query, *p)
    res = format_user_rank_response(row)
    set_cache(ckey, res, ttl=ttl)
    return res

@app.get("/stats/history/{year}/{month}")
async def get_daily_history(year: int, month: int, response: Response, request: Request, channel_id: Optional[int] = Query(None), user_id: Optional[List[str]] = Query(None)):
    is_restricted = require_month_access(request, year, month)
    if user_id and len(user_id) > 5:
        raise HTTPException(status_code=400, detail="At most 5 user_id values are allowed")
    ckey = f"hist_m_{year}_{month}_{channel_id}_{user_id}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached: return cached
    start_date, end_date = get_month_bounds(year, month)
    params = [start_date, end_date]
    f = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"]
    add_channel_scope_filter(params, f, "channel_id", await get_channel_scope_ids(channel_id))
    where = " AND ".join(f)
    t_rows = await pool.fetch(f"SELECT DATE(created_at) as d, count(*) as c FROM messages WHERE {where} GROUP BY DATE(created_at) ORDER BY d", *params)
    top_where = where.replace('channel_id', 'm.channel_id').replace('created_at', 'm.created_at').replace('is_bot', 'm.is_bot')
    top_u_sql = f"SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE {top_where} AND {DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100"
    top_u = await pool.fetch(top_u_sql, *params)
    target_ids = [str(r['user_id']) for r in top_u]
    if user_id:
        for uid in user_id:
            if uid.isdigit() and uid not in target_ids: target_ids.append(uid)
    data_map = {r['d'].strftime("%Y-%m-%d"): {"date": r['d'].strftime("%Y-%m-%d"), "total": r['c']} for r in t_rows}
    u_details = {}
    if target_ids:
        ids_plist = [int(i) for i in target_ids]
        f_params = params + [ids_plist]
        p_idx = f"${len(f_params)}"
        rows = await pool.fetch(f"SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE {where} AND user_id = ANY({p_idx}::bigint[]) GROUP BY DATE(created_at), user_id ORDER BY d", *f_params)
        for r in rows:
            d = r['d'].strftime("%Y-%m-%d")
            if d not in data_map: data_map[d] = {"date": d, "total": 0}
            data_map[d][str(r['user_id'])] = r['c']
        u_rows = await pool.fetch("SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])", ids_plist)
        for r in u_rows: u_details[str(r['user_id'])] = {"name": r['display_name'], "username": r['username'], "avatar": r['avatar_url']}
    res = {"chart_data": sorted(list(data_map.values()), key=lambda x: x['date']), "users": u_details, "top_user_id": str(top_u[0]['user_id']) if top_u else None}
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/stats/history/total")
async def get_total_history(response: Response, channel_id: Optional[int] = Query(None), user_id: Optional[List[str]] = Query(None), end_date: Optional[datetime] = Query(None)):
    if user_id and len(user_id) > 5:
        raise HTTPException(status_code=400, detail="At most 5 user_id values are allowed")
    ckey = f"hist_t_{channel_id}_{user_id}_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached: return cached
    p = []; f = ["is_bot = FALSE"]
    add_channel_scope_filter(p, f, "channel_id", await get_channel_scope_ids(channel_id))
    if end_date: p.append(end_date); f.append(f"created_at <= ${len(p)}")
    t_rows = await pool.fetch(f"SELECT DATE(created_at) as d, count(*) as c FROM messages WHERE {' AND '.join(f)} GROUP BY DATE(created_at) ORDER BY d", *p)
    line_f = (" AND ".join(f)).replace('channel_id', 'm.channel_id').replace('created_at', 'm.created_at')
    top_u = await pool.fetch(f"SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE {line_f} AND {DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100", *p)
    target_ids = [str(r['user_id']) for r in top_u]
    if user_id:
        for uid in user_id:
            if uid.isdigit() and uid not in target_ids: target_ids.append(uid)
    data_map = {r['d'].strftime("%Y-%m-%d"): {"date": r['d'].strftime("%Y-%m-%d"), "total": r['c']} for r in t_rows}
    u_details = {}
    if target_ids:
        ids_plist = [int(i) for i in target_ids]
        up = p + [ids_plist]
        rows = await pool.fetch(f"SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE {' AND '.join(f)} AND user_id = ANY(${len(up)}::bigint[]) GROUP BY DATE(created_at), user_id ORDER BY d", *up)
        for r in rows:
            d = r['d'].strftime("%Y-%m-%d")
            if d not in data_map: data_map[d] = {"date": d, "total": 0}
            data_map[d][str(r['user_id'])] = r['c']
        u_rows = await pool.fetch("SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])", ids_plist)
        for r in u_rows: u_details[str(r['user_id'])] = {"name": r['display_name'], "username": r['username'], "avatar": r['avatar_url']}
    res = {"chart_data": sorted(list(data_map.values()), key=lambda x: x['date']), "users": u_details, "top_user_id": str(top_u[0]['user_id']) if top_u else None}
    set_cache(ckey, res, ttl=ttl)
    return res

@app.get("/stats/heatmap/{year}/{month}")
async def get_monthly_heatmap(year: int, month: int, response: Response, request: Request, channel_id: Optional[int] = Query(None)):
    is_restricted = require_month_access(request, year, month)
    ckey = f"heat_m_{year}_{month}_{channel_id}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached: return cached
    start_date, end_date = get_month_bounds(year, month)
    p = [start_date, end_date]; f = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"]
    add_channel_scope_filter(p, f, "channel_id", await get_channel_scope_ids(channel_id))
    rows = await pool.fetch(f"SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE {' AND '.join(f)} GROUP BY dow, hour ORDER BY dow, hour", *p)
    res = [{"dow": int(r['dow']), "hour": int(r['hour']), "count": r['count']} for r in rows]
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/stats/heatmap/total")
async def get_total_heatmap(response: Response, channel_id: Optional[int] = Query(None), end_date: Optional[datetime] = Query(None)):
    ckey = f"heat_t_{channel_id}_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached: return cached
    p = []; f = ["is_bot = FALSE"]
    add_channel_scope_filter(p, f, "channel_id", await get_channel_scope_ids(channel_id))
    if end_date: p.append(end_date); f.append(f"created_at <= ${len(p)}")
    rows = await pool.fetch(f"SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE {' AND '.join(f)} GROUP BY dow, hour ORDER BY dow, hour", *p)
    res = [{"dow": int(r['dow']), "hour": int(r['hour']), "count": r['count']} for r in rows]
    set_cache(ckey, res, ttl=ttl)
    return res

@app.get("/stats/channels_distribution/{year}/{month}")
async def get_monthly_channel_distribution(year: int, month: int, response: Response, request: Request):
    is_restricted = require_month_access(request, year, month)
    ckey = f"pie_m_{year}_{month}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached: return cached
    start_date, end_date = get_month_bounds(year, month)
    rows = await pool.fetch(
        """
        SELECT
            CASE
                WHEN c.category_id = ANY($3::bigint[]) THEN c.name
                ELSE 'プラチャ'
            END AS name,
            count(*) AS count
        FROM messages m
        JOIN channels c ON m.channel_id = c.channel_id
        WHERE m.created_at >= $1 AND m.created_at < $2 AND m.is_bot = FALSE
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10
        """,
        start_date,
        end_date,
        PRIVATE_CHAT_CATEGORY_IDS,
    )
    res = [{"name": r['name'], "value": r['count']} for r in rows]
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/stats/channels_distribution/total")
async def get_total_channel_distribution(response: Response, end_date: Optional[datetime] = Query(None)):
    ckey = f"pie_t_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached: return cached
    p = [PRIVATE_CHAT_CATEGORY_IDS]; f = ["m.is_bot = FALSE"]
    if end_date: p.append(end_date); f.append(f"m.created_at <= ${len(p)}")
    rows = await pool.fetch(
        f"""
        SELECT
            CASE
                WHEN c.category_id = ANY($1::bigint[]) THEN c.name
                ELSE 'プラチャ'
            END AS name,
            count(*) AS count
        FROM messages m
        JOIN channels c ON m.channel_id = c.channel_id
        WHERE {' AND '.join(f)}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10
        """,
        *p,
    )
    res = [{"name": r['name'], "value": r['count']} for r in rows]
    set_cache(ckey, res, ttl=ttl)
    return res

@app.get("/stats/analysis/{year}/{month}")
async def get_monthly_analysis(year: int, month: int, response: Response, request: Request, channel_id: Optional[int] = Query(None), user_id: Optional[str] = Query(None, max_length=20)):
    is_restricted = require_month_access(request, year, month)
    ckey = f"ana_m_{year}_{month}_{channel_id}_{user_id}"
    cached = get_cache(ckey)
    set_month_cache_control(response, is_restricted)
    if cached: return cached
    start_date, end_date = get_month_bounds(year, month)
    p = [start_date, end_date]; f = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"]
    add_channel_scope_filter(p, f, "channel_id", await get_channel_scope_ids(channel_id))
    if user_id and user_id.isdigit(): p.append(int(user_id)); f.append(f"user_id = ${len(p)}")
    where = " AND ".join(f)
    count = await pool.fetchrow(f"SELECT count(*) as total FROM messages WHERE {where}", *p)
    if not count or count['total'] == 0: return {"total": 0}
    unique_where = where.replace('channel_id', 'm.channel_id').replace('created_at', 'm.created_at').replace('is_bot', 'm.is_bot').replace('user_id', 'm.user_id')
    unique_users = await pool.fetchval(
        f"""
        SELECT count(DISTINCT m.user_id)
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.user_id
        WHERE {unique_where}
          AND {DELETED_USER_FILTER}
        """,
        *p,
    )
    max_d = await pool.fetchrow(f"SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE {where} GROUP BY d ORDER BY c DESC LIMIT 1", *p)
    max_w = await pool.fetchrow(f"SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE {where} GROUP BY dow ORDER BY c DESC LIMIT 1", *p)
    max_h = await pool.fetchrow(f"SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE {where} GROUP BY h ORDER BY c DESC LIMIT 1", *p)
    res = {"total": count['total'], "unique_users": unique_users or 0, "max_date": {"date": max_d['d'].strftime("%Y-%m-%d"), "count": max_d['c']} if max_d else None, "max_dow": {"dow": int(max_w['dow']), "count": max_w['c']} if max_w else None, "max_hour": {"hour": int(max_h['h']), "count": max_h['c']} if max_h else None}
    set_cache(ckey, res, ttl=600)
    return res

@app.get("/stats/analysis/total")
async def get_total_analysis(response: Response, channel_id: Optional[int] = Query(None), user_id: Optional[str] = Query(None), end_date: Optional[datetime] = Query(None)):
    ckey = f"ana_t_{channel_id}_{user_id}_{end_date}"
    cached = get_cache(ckey)
    ttl = 86400 if end_date else LIVE_TOTAL_CACHE_TTL
    response.headers["Cache-Control"] = f"public, max-age={ttl}"
    if cached: return cached
    p = []; f = ["is_bot = FALSE"]
    add_channel_scope_filter(p, f, "channel_id", await get_channel_scope_ids(channel_id))
    if user_id and user_id.isdigit(): p.append(int(user_id)); f.append(f"user_id = ${len(p)}")
    if end_date: p.append(end_date); f.append(f"created_at <= ${len(p)}")
    where = " AND ".join(f)
    count = await pool.fetchrow(f"SELECT count(*) as total FROM messages WHERE {where}", *p)
    if not count or count['total'] == 0: return {"total": 0}
    unique_where = where.replace('channel_id', 'm.channel_id').replace('created_at', 'm.created_at').replace('is_bot', 'm.is_bot').replace('user_id', 'm.user_id')
    unique_users = await pool.fetchval(
        f"""
        SELECT count(DISTINCT m.user_id)
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.user_id
        WHERE {unique_where}
          AND {DELETED_USER_FILTER}
        """,
        *p,
    )
    max_d = await pool.fetchrow(f"SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE {where} GROUP BY d ORDER BY c DESC LIMIT 1", *p)
    max_w = await pool.fetchrow(f"SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE {where} GROUP BY dow ORDER BY c DESC LIMIT 1", *p)
    max_h = await pool.fetchrow(f"SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE {where} GROUP BY h ORDER BY c DESC LIMIT 1", *p)
    res = {"total": count['total'], "unique_users": unique_users or 0, "max_date": {"date": max_d['d'].strftime("%Y-%m-%d"), "count": max_d['c']} if max_d else None, "max_dow": {"dow": int(max_w['dow']), "count": max_w['c']} if max_w else None, "max_hour": {"hour": int(max_h['h']), "count": max_h['c']} if max_h else None}
    set_cache(ckey, res, ttl=ttl)
    return res

async def warm_total_cache_once():
    if not pool:
        return

    warmers = [
        ("ranking_total", lambda: get_total_ranking(Response(), channel_id=None, end_date=None)),
        ("history_total", lambda: get_total_history(Response(), channel_id=None, user_id=None, end_date=None)),
        ("heatmap_total", lambda: get_total_heatmap(Response(), channel_id=None, end_date=None)),
        ("channels_total", lambda: get_total_channel_distribution(Response(), end_date=None)),
        ("analysis_total", lambda: get_total_analysis(Response(), channel_id=None, user_id=None, end_date=None)),
    ]

    for name, warmer in warmers:
        started = time.perf_counter()
        try:
            await warmer()
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            logger.info(f"Warmed cache: {name} ({elapsed_ms}ms)")
        except Exception:
            logger.warning(f"Failed to warm cache: {name}", exc_info=True)

async def warm_total_cache_loop():
    await asyncio.sleep(10)
    while True:
        await warm_total_cache_once()
        await asyncio.sleep(TOTAL_CACHE_WARM_INTERVAL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    expose_headers=["X-Debug-Block"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8070)
