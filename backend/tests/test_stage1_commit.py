from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app import audit, commit, directory

IST = ZoneInfo("Asia/Kolkata")
DAY = datetime(2026, 10, 5, 11, 0, tzinfo=IST)
NIGHT = datetime(2026, 10, 5, 21, 0, tzinfo=IST)
FIELDS = {"name": "Rahul Sharma", "phone": "98765 43210", "host": "Naveen Aggarwal", "purpose": "project discussion"}


def host_id(pool, tenant, spoken):
    with pool.connection() as c:
        return directory.resolve_host(c, tenant, spoken).chosen["id"]


def register(pool, key="k1", tenant="uiet", fields=None, spoken="Naveen Aggarwal", now=DAY, **kw):
    return commit.commit_registration(
        pool, tenant_id=tenant, actor=f"guard_{tenant}", fields=fields or FIELDS,
        host_id=host_id(pool, tenant, spoken), idempotency_key=key, now=now, **kw)


def count(pool, table):
    with pool.connection() as c:
        return c.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]


def test_happy_path_writes_visit_notification_and_audit_together(seeded):
    r = register(seeded)
    assert r["status"] == "checked_in" and r["already_done"] is False
    assert count(seeded, "visits") == count(seeded, "notifications") == 1
    with seeded.connection() as c:
        assert audit.verify_chain(c, "uiet") == {"ok": True, "checked": 1, "broken_at": None, "reason": None}
        v = c.execute("SELECT phone FROM visitors").fetchone()
    assert v["phone"] == "+919876543210"                     # stored in normalised form


def test_double_confirm_is_harmless(seeded):
    a, b = register(seeded, key="same"), register(seeded, key="same")
    assert a["visit_id"] == b["visit_id"] and b["already_done"] is True
    assert count(seeded, "visits") == 1 and count(seeded, "notifications") == 1


def test_commit_refuses_what_the_rules_forbid_even_if_called_directly(seeded):
    """Defence in depth: the commit step does not trust that anyone checked first."""
    with pytest.raises(commit.CommitRefused) as e:
        register(seeded, fields={**FIELDS, "phone": "+919000000001"})        # blacklisted
    assert e.value.outcome == "block"
    with pytest.raises(commit.CommitRefused):
        register(seeded, fields={**FIELDS, "phone": "123"}, key="k2")        # invalid phone
    with pytest.raises(commit.CommitRefused) as e:
        register(seeded, fields={**FIELDS, "purpose": None}, key="k3")       # incomplete
    assert e.value.outcome == "incomplete"
    assert count(seeded, "visits") == 0
    with seeded.connection() as c:                                           # refusals are audited
        events = [r["event_type"] for r in c.execute("SELECT event_type FROM audit_log ORDER BY seq")]
        assert events == ["commit.refused"] * 3 and audit.verify_chain(c, "uiet")["ok"]


def test_after_hours_goes_to_pending_and_admin_can_approve(seeded):
    r = register(seeded, now=NIGHT)
    assert r["status"] == "pending_approval"
    assert count(seeded, "notifications") == 0                               # host not told yet
    out = commit.decide_visit(seeded, tenant_id="uiet", actor="admin_uiet", visit_id=r["visit_id"], approve=True)
    assert out["status"] == "checked_in" and count(seeded, "notifications") == 1
    with pytest.raises(commit.CommitRefused):                                # cannot decide twice
        commit.decide_visit(seeded, tenant_id="uiet", actor="admin_uiet", visit_id=r["visit_id"], approve=False)


def test_reject(seeded):
    r = register(seeded, now=NIGHT)
    assert commit.decide_visit(seeded, tenant_id="uiet", actor="a", visit_id=r["visit_id"], approve=False)["status"] == "rejected"
    assert count(seeded, "notifications") == 0


def test_returning_visitor_is_linked_by_phone_not_duplicated(seeded):
    register(seeded, key="a")
    register(seeded, key="b")
    assert count(seeded, "visitors") == 1 and count(seeded, "visits") == 2


def test_checkout_and_repeat(seeded):
    r = register(seeded)
    out = commit.commit_checkout(seeded, tenant_id="uiet", actor="g", visit_id=r["visit_id"])
    assert out["status"] == "checked_out" and out["already_done"] is False
    assert commit.commit_checkout(seeded, tenant_id="uiet", actor="g", visit_id=r["visit_id"])["already_done"] is True
    with pytest.raises(commit.CommitRefused):
        commit.commit_checkout(seeded, tenant_id="uiet", actor="g", visit_id="00000000-0000-0000-0000-000000000000")


def test_tenant_isolation_cannot_touch_other_orgs_visit(seeded):
    r = register(seeded)
    with pytest.raises(commit.CommitRefused):
        commit.commit_checkout(seeded, tenant_id="greenview", actor="g", visit_id=r["visit_id"])


def test_autoclose(seeded):
    register(seeded, key="a")
    register(seeded, key="b", fields={**FIELDS, "phone": "9123456789"})
    out = commit.autoclose_open_visits(seeded, tenant_id="uiet")
    assert out["closed"] == 2
    assert commit.autoclose_open_visits(seeded, tenant_id="uiet")["closed"] == 0


def test_same_input_two_organisations(seeded):
    """Society: phone optional, so this registration works there with no phone at all."""
    f = {"name": "Delivery Boy", "phone": None, "host": "flat A-101", "purpose": "parcel delivery"}
    assert register(seeded, tenant="greenview", fields=f, spoken="flat A-101")["status"] == "checked_in"
    with pytest.raises(commit.CommitRefused):                                # university needs a phone
        register(seeded, tenant="uiet", fields={**f, "host": "Naveen"}, spoken="Naveen", key="u")


def test_failed_audit_rolls_back_the_visit(seeded, monkeypatch):
    """Visit and audit row are one transaction: if the audit write explodes, no visit survives."""
    def boom(*a, **k):
        raise RuntimeError("audit down")
    monkeypatch.setattr(commit.audit, "append", boom)
    with pytest.raises(RuntimeError):
        register(seeded)
    assert count(seeded, "visits") == 0 and count(seeded, "visitors") == 0 and count(seeded, "notifications") == 0
