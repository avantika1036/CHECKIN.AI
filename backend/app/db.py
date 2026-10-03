"""Database access: two connection pools and a tiny migration runner.

Why two pools?  LangGraph's Postgres checkpointer needs connections in autocommit mode
with dict rows; the rest of our code wants normal transactions. Keeping them separate
avoids one style breaking the other.

Why plain SQL migrations instead of Alembic?  We have ~10 tables and one team; numbered
.sql files are easy to read and to explain. If the schema grows, Alembic is the upgrade.
"""
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .settings import get_settings

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def make_pool(autocommit: bool = False) -> ConnectionPool:
    s = get_settings()
    return ConnectionPool(
        s.database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row, "autocommit": autocommit},
        open=False,
    )


def migrate(pool: ConnectionPool) -> list[str]:
    """Apply every NNN_*.sql file that has not been applied yet. Returns the names applied."""
    applied_now: list[str] = []
    with pool.connection() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            applied_now.append(path.name)
    return applied_now
