"""Passwords (bcrypt) and login tokens (JWT)."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .settings import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_token(username: str, tenant_id: str, role: str) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_ttl_minutes)
    return jwt.encode({"sub": username, "tenant": tenant_id, "role": role, "exp": exp}, s.jwt_secret, "HS256")


def decode_token(token: str) -> dict:
    """Raises jwt.InvalidTokenError (expired, tampered, wrong secret...)."""
    return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
