"""Small helpers shared by tests, evaluation scripts and setup scripts.

The most important rule lives here: tests and evaluations may EMPTY tables, so they must never
run against your real/demo database. `test_database_url()` always returns a database whose name
ends in `_test`, derived from the DATABASE_URL in your environment or backend/.env.
"""
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

DEFAULT_URL = "postgresql://postgres:postgres@localhost:5432/checkin"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _read_dotenv_value(key: str) -> str | None:
    try:
        from dotenv import dotenv_values
        return dotenv_values(ENV_FILE).get(key)
    except Exception:
        return None


def dev_database_url() -> str:
    return os.environ.get("DATABASE_URL") or _read_dotenv_value("DATABASE_URL") or DEFAULT_URL


def with_database_name(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + name, parts.query, parts.fragment))


def database_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


def test_database_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    url = explicit or with_database_name(dev_database_url(), "checkin_test")
    if not database_name(url).endswith("_test"):
        raise SystemExit(f"Refusing to use '{database_name(url)}' for tests: the name must end in _test "
                         "(tests delete data).")
    return url


def use_test_database() -> str:
    """Point this process at the test database (call before anything reads settings)."""
    url = test_database_url()
    os.environ["DATABASE_URL"] = url
    from .settings import get_settings
    get_settings.cache_clear()
    return url


def mask(url: str) -> str:
    parts = urlsplit(url)
    if parts.password:
        netloc = parts.netloc.replace(":" + parts.password + "@", ":****@")
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return url
