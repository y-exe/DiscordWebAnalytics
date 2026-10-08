import os
import time
import unittest
import tempfile
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch, AsyncMock

from starlette.requests import Request


os.environ["DB_DSN"] = "postgresql://user:password@127.0.0.1:5432/test"
os.environ["API_SECRET"] = "a" * 32
os.environ["ADMIN_SESSION_SECRET"] = "b" * 32
os.environ["ADMIN_PASSWORD_HASH"] = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

from backend import main
from backend.safe_cache import SafeDiskCache


def make_request(peer_ip: str, headers=None) -> Request:
    raw_headers = [
        (name.lower().encode("ascii"), value.encode("ascii"))
        for name, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": raw_headers,
            "client": (peer_ip, 12345),
            "server": ("testserver", 443),
        }
    )


class AdminSecurityTests(unittest.TestCase):
    def test_docs_are_disabled_by_default(self):
        self.assertIsNone(main.app.docs_url)
        self.assertIsNone(main.app.openapi_url)

    def test_rate_limit_is_atomic_across_cache_instances(self):
        with tempfile.TemporaryDirectory() as directory:
            stores = [SafeDiskCache(directory, 1024 * 1024) for _ in range(2)]
            with ThreadPoolExecutor(max_workers=8) as executor:
                allowed = list(executor.map(lambda index: stores[index % 2].consume_limit('login', 5, 600), range(40)))
            self.assertEqual(sum(allowed), 5)

    def test_cache_eviction_does_not_remove_security_counters(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SafeDiskCache(directory, 1024 * 1024)
            self.assertTrue(store.consume_limit('login', 1, 600))
            store.set('large-cache-value', 'x' * (2 * 1024 * 1024))
            self.assertFalse(store.consume_limit('login', 1, 600))

    def test_rate_window_resets_at_expiry_and_invalid_limits_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SafeDiskCache(directory, 1024 * 1024)
            with patch.object(main.time, 'time', return_value=1000):
                self.assertTrue(store.consume_limit('login', 1, 600))
                self.assertFalse(store.consume_limit('login', 1, 600))
                self.assertFalse(store.consume_limit('invalid', 0, 600))
            with patch.object(main.time, 'time', return_value=1600):
                self.assertTrue(store.consume_limit('login', 1, 600))
    def test_database_host_rewrite_preserves_credentials_and_query(self):
        dsn = 'postgresql://localhost-user:localhost-pass@localhost:5432/localhost-db?application_name=localhost'
        with patch.object(main.os.path, 'exists', return_value=False):
            self.assertEqual(main.adjust_db_dsn(dsn), dsn.replace('@localhost:', '@127.0.0.1:'))
        with patch.object(main.os.path, 'exists', return_value=True), patch.object(main.socket, 'gethostbyname', return_value='192.0.2.1'):
            self.assertEqual(main.adjust_db_dsn(dsn), dsn.replace('@localhost:', '@host.docker.internal:'))

    def test_non_ascii_api_key_is_rejected_without_an_exception(self):
        request = make_request('203.0.113.10')
        request.scope['headers'] = [(b'x-api-key', b'\xff')]
        self.assertFalse(main.is_api_client(request))

    def test_admin_session_round_trip_and_tampering(self):
        now = int(time.time())
        with patch.object(main.time, "time", return_value=now):
            token = main.create_admin_session()
            self.assertTrue(main.verify_admin_session(token))
            self.assertFalse(main.verify_admin_session(token[:-1] + ("A" if token[-1] != "A" else "B")))
            self.assertFalse(main.verify_admin_session(None))

    def test_admin_origin_requires_an_allowed_origin(self):
        self.assertFalse(main.admin_origin_allowed(make_request("203.0.113.10")))
        self.assertFalse(
            main.admin_origin_allowed(
                make_request("203.0.113.10", {"Origin": "https://attacker.example"})
            )
        )
        self.assertTrue(
            main.admin_origin_allowed(
                make_request("203.0.113.10", {"Origin": "https://ymkw.top"})
            )
        )

    def test_cf_connecting_ip_requires_a_trusted_peer(self):
        trusted_networks = main.parse_trusted_proxy_cidrs("192.0.2.0/24, 2001:db8::/32")
        with (
            patch.object(main, "TRUST_CLOUDFLARE_PROXY", True),
            patch.object(main, "CLOUDFLARE_TRUSTED_PROXY_CIDRS", trusted_networks),
        ):
            spoofed = make_request("198.51.100.7", {"CF-Connecting-IP": "203.0.113.8"})
            proxied = make_request("192.0.2.7", {"CF-Connecting-IP": "203.0.113.8"})
            malformed = make_request("192.0.2.7", {"CF-Connecting-IP": "not-an-ip"})
            self.assertEqual(main.get_client_ip(spoofed), "198.51.100.7")
            self.assertEqual(main.get_client_ip(proxied), "203.0.113.8")
            self.assertEqual(main.get_client_ip(malformed), "192.0.2.7")


class LoginLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_startup_preserves_database_tls_configuration(self):
        with patch.object(main.asyncpg, 'create_pool', new_callable=AsyncMock) as create_pool, \
             patch.object(main, 'initialize_login_limits', new_callable=AsyncMock), \
             patch.object(main, 'warm_total_cache_loop', new_callable=AsyncMock):
            await main.startup()
            self.assertNotIn('ssl', create_pool.call_args.kwargs)
            self.assertEqual(create_pool.call_args.args[0], main.DB_DSN)

    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = SafeDiskCache(self.directory.name, 1024 * 1024)
        self.cache_patch = patch.object(main, 'cache', self.store)
        self.cache_patch.start()
        async def consume_limits(pool, key, per_client, total, window):
            return self.store.consume_limit('client:' + key, per_client, window) and self.store.consume_limit('global', total, window)
        self.limit_patch = patch.object(main, 'consume_login_limits', side_effect=consume_limits)
        self.limit_patch.start()
        self.pool_patch = patch.object(main, 'pool', object())
        self.pool_patch.start()
        self.password_patch = patch.object(main, 'verify_admin_password', return_value=False)
        self.verify = self.password_patch.start()

    async def asyncTearDown(self):
        self.password_patch.stop()
        self.limit_patch.stop()
        self.pool_patch.stop()
        self.cache_patch.stop()
        self.directory.cleanup()

    def login_request(self, ip, body=None):
        request = make_request(ip, {'Origin': 'https://ymkw.top'})
        request.scope['method'] = 'POST'
        async def receive():
            return {'type': 'http.request', 'body': body if body is not None else json.dumps({'password': 'wrong'}).encode(), 'more_body': False}
        return Request(request.scope, receive)

    async def test_sixth_attempt_is_rejected_before_password_hashing(self):
        for attempt in range(6):
            with self.assertRaises(main.HTTPException) as caught:
                await main.admin_login(self.login_request('203.0.113.10'))
            self.assertEqual(caught.exception.status_code, 401 if attempt < 5 else 429)
        self.assertEqual(self.verify.call_count, 5)

    async def test_rotating_peer_addresses_still_hit_global_limit(self):
        with patch.object(main, 'ADMIN_LOGIN_GLOBAL_LIMIT', 3):
            for attempt in range(4):
                with self.assertRaises(main.HTTPException) as caught:
                    await main.admin_login(self.login_request(f'203.0.113.{attempt + 1}'))
                self.assertEqual(caught.exception.status_code, 401 if attempt < 3 else 429)
        self.assertEqual(self.verify.call_count, 3)

    async def test_oversized_login_body_does_not_reach_password_hashing(self):
        with self.assertRaises(main.HTTPException) as caught:
            await main.admin_login(self.login_request('203.0.113.10', b'x' * 2049))
        self.assertEqual(caught.exception.status_code, 413)
        self.verify.assert_not_called()

    async def test_shared_limiter_failure_does_not_allow_login(self):
        with patch.object(main, 'consume_login_limits', side_effect=RuntimeError('database unavailable')):
            with self.assertRaises(main.HTTPException) as caught:
                await main.admin_login(self.login_request('203.0.113.10'))
            self.assertEqual(caught.exception.status_code, 503)
            self.verify.assert_not_called()

if __name__ == '__main__':
    unittest.main()
