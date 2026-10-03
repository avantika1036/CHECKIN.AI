"""Shared test setup. Tests run against a REAL Postgres (database 'checkin_test'),
because our safety claims (transactions, locks, triggers, pg_trgm) only mean something there."""
import os

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/checkin_test"
)
os.environ["LLM_PROVIDER"] = "none"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-0123456789"

import pytest

from app.db import make_pool, migrate


@pytest.fixture(scope="session")
def pool():
    p = make_pool()
    p.open()
    with p.connection() as conn:                      # start every test session from an empty schema
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    migrate(p)
    yield p
    p.close()


@pytest.fixture()
def clean(pool):
    """Empty all data tables (keeps the schema) so each test starts fresh."""
    with pool.connection() as conn:
        conn.execute("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change")
        conn.execute("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate")
        conn.execute(
            "TRUNCATE notifications, visits, visitors, blacklist, hosts, users, "
            "audit_log, audit_heads, tenants CASCADE"
        )
        conn.execute("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change")
        conn.execute("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate")
    return pool


@pytest.fixture()
def seeded(clean):
    from app.seed import seed
    seed(clean)
    return clean
