import psycopg
import pytest


def test_migrations_applied(pool):
    with pool.connection() as c:
        names = [r["name"] for r in c.execute("SELECT name FROM schema_migrations")]
    assert "001_init.sql" in names


def test_pg_trgm_fuzzy_match_works(pool):
    with pool.connection() as c:
        row = c.execute("SELECT word_similarity('aggarwal', 'dr. naveen aggarwal') AS s").fetchone()
    assert row["s"] > 0.9


def test_audit_log_cannot_be_edited(clean):
    with clean.connection() as c:
        c.execute("INSERT INTO tenants (id, name, config) VALUES ('t', 'T', '{}')")
        c.execute(
            "INSERT INTO audit_log (tenant_id, seq, ts, actor, event_type, payload, prev_hash, hash) "
            "VALUES ('t', 1, now(), 'x', 'e', '{}', 'p', 'h')"
        )
    with pytest.raises(psycopg.errors.RaiseException):
        with clean.connection() as c:
            c.execute("UPDATE audit_log SET actor = 'hacker'")
    with pytest.raises(psycopg.errors.RaiseException):
        with clean.connection() as c:
            c.execute("DELETE FROM audit_log")
