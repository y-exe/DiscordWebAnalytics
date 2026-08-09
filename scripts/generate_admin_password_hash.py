import base64
import getpass
import hashlib
import secrets


ITERATIONS = 600_000
SALT_LENGTH = 16


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def main() -> None:
    password = getpass.getpass("管理者パスワード: ")
    if not password:
        raise SystemExit("パスワードを空にはできません。")
    salt = secrets.token_bytes(SALT_LENGTH)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, dklen=32)
    print(f"pbkdf2-sha256${ITERATIONS}${base64url(salt)}${base64url(password_hash)}")


if __name__ == "__main__":
    main()
