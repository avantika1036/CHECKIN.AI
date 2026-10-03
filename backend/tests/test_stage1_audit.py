import threading

import pytest

from app import audit


def _make_tenant(pool):
    with pool.connection() as c:
        c.execute("INSERT INTO tenants (id, name, config) VALUES ('t', 'T', '{}')")


def test_chain_grows_and_verifies(clean):
    _make_tenant(clean)
    with clean.connection() as c:
        for i in range(5):
            audit.append(c, "t", "guard", "demo", {"i": i, "nested": {"a": [1, 2]}})
    with clean.connection() as c:
        r = audit.verify_chain(c, "t")
    assert r == {"ok": True, "checked": 5, "broken_at": None, "reason": None}


def _tamper(pool, sql, params=()):
    with pool.connection() as c:
        c.execute("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change")
        c.execute(sql, params)
        c.execute("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change")


@pytest.mark.parametrize("sql,reason", [
    ("UPDATE audit_log SET payload = '{\"i\": 99}' WHERE seq = 2", "row content changed"),
    ("UPDATE audit_log SET actor = 'mallory' WHERE seq = 3", "row content changed"),
    ("DELETE FROM audit_log WHERE seq = 2", "missing or reordered row"),
    ("DELETE FROM audit_log WHERE seq = 5", "rows were removed from the end of the log"),
])
def test_tampering_is_detected(clean, sql, reason):
    _make_tenant(clean)
    with clean.connection() as c:
        for i in range(5):
            audit.append(c, "t", "guard", "demo", {"i": i})
    _tamper(clean, sql)
    with clean.connection() as c:
        r = audit.verify_chain(c, "t")
    assert r["ok"] is False and r["reason"] == reason


def test_parallel_writers_do_not_fork_the_chain(clean):
    """Many threads appending at once: sequence numbers stay unique and the chain stays valid."""
    _make_tenant(clean)
    errors = []

    def worker(n):
        try:
            for i in range(10):
                with clean.connection() as c:
                    audit.append(c, "t", f"w{n}", "demo", {"n": n, "i": i})
        except Exception as e:                      # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    with clean.connection() as c:
        r = audit.verify_chain(c, "t")
    assert r["ok"] and r["checked"] == 60


def test_rolled_back_transaction_leaves_no_audit_row(clean):
    _make_tenant(clean)
    with pytest.raises(RuntimeError):
        with clean.connection() as c:
            audit.append(c, "t", "guard", "demo", {"x": 1})
            raise RuntimeError("boom")
    with clean.connection() as c:
        assert c.execute("SELECT count(*) AS n FROM audit_log").fetchone()["n"] == 0
        assert audit.verify_chain(c, "t")["ok"]
