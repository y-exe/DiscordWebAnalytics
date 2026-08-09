import os
import time
import unittest
from unittest.mock import patch

from starlette.requests import Request


os.environ["DB_DSN"] = "postgresql://user:password@127.0.0.1:5432/test"
os.environ["API_SECRET"] = "a" * 32
os.environ["ADMIN_SESSION_SECRET"] = "b" * 32
os.environ["ADMIN_PASSWORD_HASH"] = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

from backend import main


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


if __name__ == "__main__":
    unittest.main()
