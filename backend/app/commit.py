"""The ONLY place that writes visit data. Plain code, one transaction per action.

Properties we rely on (and test):
  * the AI has no path to the database except through these functions;
  * every function re-checks the rules itself (never trusts the caller);
  * visit + notification + audit row succeed or fail TOGETHER (one transaction);
  * repeating the same action with the same idempotency key is harmless.
"""
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from . import audit, directory
from .verify import authorize


class CommitRefused(Exception):
    def __init__(self, outcome: str, messages: list[str]):
        super().__init__(f"{outcome}: {'; '.join(messages)}")
        self.outcome, self.messages = outcome, messages


def commit_registration(pool, *, tenant_id: str, actor: str, fields: dict, host_id: str,
                        idempotency_key: str, link_visitor_id: str | None = None,
                        raw_text: str | None = None, now: datetime | None = None) -> dict:
    refusal: CommitRefused | None = None
    result: dict = {}
    with pool.connection() as conn:                      # <- one transaction
        existing = conn.execute("SELECT id::text AS id, status FROM visits WHERE idempotency_key = %s",
                                (idempotency_key,)).fetchone()
        if existing:
            return {"visit_id": existing["id"], "status": existing["status"], "already_done": True}

        report, ctx = authorize(conn, tenant_id, fields, host_id, now)
        f = ctx["fields"]
        if not report.can_commit:
            msgs = [r.message for r in report.failures] + [f"missing: {m}" for m in report.missing_fields]
            audit.append(conn, tenant_id, actor, "commit.refused",
                         {"outcome": report.outcome, "messages": msgs, "fields": f})
            refusal = CommitRefused(report.outcome, msgs)
        else:
            visitor_id = _resolve_visitor(conn, tenant_id, f, link_visitor_id)
            status = "pending_approval" if report.outcome == "needs_approval" else "checked_in"
            warnings = [r.message for r in report.failures]
            row = conn.execute(
                "INSERT INTO visits (tenant_id, visitor_id, host_id, purpose, status, idempotency_key, "
                "config_version, created_by, warnings) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text AS id",
                (tenant_id, visitor_id, ctx["host"]["id"], f["purpose"], status, idempotency_key,
                 ctx["config_version"], actor, Jsonb(warnings))).fetchone()
            if row is None:                              # a parallel request won the race
                again = conn.execute("SELECT id::text AS id, status FROM visits WHERE idempotency_key = %s",
                                     (idempotency_key,)).fetchone()
                return {"visit_id": again["id"], "status": again["status"], "already_done": True}
            if status == "checked_in":
                _queue_host_notice(conn, tenant_id, row["id"], ctx["host"], f)
            audit.append(conn, tenant_id, actor, "visit.registered", {
                "visit_id": row["id"], "visitor_id": visitor_id, "host_id": ctx["host"]["id"],
                "status": status, "outcome": report.outcome, "warnings": warnings,
                "config_version": ctx["config_version"], "idempotency_key": idempotency_key,
                "fields": f, "raw_text": raw_text})
            result = {"visit_id": row["id"], "status": status, "visitor_id": visitor_id,
                      "warnings": warnings, "already_done": False}
    if refusal:
        raise refusal
    return result


def _resolve_visitor(conn, tenant_id: str, f: dict, link_visitor_id: str | None) -> str:
    if link_visitor_id:
        row = conn.execute("UPDATE visitors SET last_seen_at = now() WHERE id = %s AND tenant_id = %s "
                           "RETURNING id::text AS id", (link_visitor_id, tenant_id)).fetchone()
        if row:
            return row["id"]
    if f["phone"] and f["phone"].startswith("+91"):
        return conn.execute(
            "INSERT INTO visitors (tenant_id, name, phone) VALUES (%s,%s,%s) "
            "ON CONFLICT (tenant_id, phone) DO UPDATE SET last_seen_at = now() RETURNING id::text AS id",
            (tenant_id, f["name"], f["phone"])).fetchone()["id"]
    return conn.execute("INSERT INTO visitors (tenant_id, name, phone) VALUES (%s,%s,NULL) "
                        "RETURNING id::text AS id", (tenant_id, f["name"])).fetchone()["id"]


def _queue_host_notice(conn, tenant_id: str, visit_id: str, host: dict, f: dict) -> None:
    conn.execute(
        "INSERT INTO notifications (tenant_id, visit_id, channel, recipient, body) VALUES (%s,%s,'log',%s,%s)",
        (tenant_id, visit_id, host.get("email") or host["name"],
         f"{f['name']} has arrived to meet you ({f['purpose']})."))


def decide_visit(pool, *, tenant_id: str, actor: str, visit_id: str, approve: bool) -> dict:
    """Admin approves or rejects a visit that is waiting for approval."""
    with pool.connection() as conn:
        new_status = "checked_in" if approve else "rejected"
        row = conn.execute(
            "UPDATE visits SET status = %s, decided_by = %s, decided_at = now() "
            "WHERE id = %s AND tenant_id = %s AND status = 'pending_approval' RETURNING id::text AS id, "
            "host_id::text AS host_id, visitor_id::text AS visitor_id, purpose",
            (new_status, actor, visit_id, tenant_id)).fetchone()
        if not row:
            raise CommitRefused("not_pending", ["this visit is not waiting for approval"])
        if approve:
            host = directory.get_host(conn, tenant_id, row["host_id"]) or {"name": "host", "email": None}
            v = conn.execute("SELECT name FROM visitors WHERE id = %s", (row["visitor_id"],)).fetchone()
            _queue_host_notice(conn, tenant_id, visit_id, host, {"name": v["name"], "purpose": row["purpose"]})
        audit.append(conn, tenant_id, actor, "visit.approved" if approve else "visit.rejected",
                     {"visit_id": visit_id, "status": new_status})
    return {"visit_id": visit_id, "status": new_status}


def commit_checkout(pool, *, tenant_id: str, actor: str, visit_id: str) -> dict:
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE visits SET status = 'checked_out', checked_out_at = now() "
            "WHERE id = %s AND tenant_id = %s AND status = 'checked_in' RETURNING id::text AS id",
            (visit_id, tenant_id)).fetchone()
        if not row:
            cur = conn.execute("SELECT status FROM visits WHERE id = %s AND tenant_id = %s",
                               (visit_id, tenant_id)).fetchone()
            if cur and cur["status"] == "checked_out":
                return {"visit_id": visit_id, "status": "checked_out", "already_done": True}
            raise CommitRefused("not_open", ["no open visit with that id"])
        audit.append(conn, tenant_id, actor, "visit.checked_out", {"visit_id": visit_id})
    return {"visit_id": visit_id, "status": "checked_out", "already_done": False}


def autoclose_open_visits(pool, *, tenant_id: str, actor: str = "system") -> dict:
    """Close every visit still marked checked-in (guards forget to check people out)."""
    with pool.connection() as conn:
        rows = conn.execute(
            "UPDATE visits SET status = 'auto_closed', checked_out_at = now() "
            "WHERE tenant_id = %s AND status = 'checked_in' RETURNING id::text AS id", (tenant_id,)).fetchall()
        ids = [r["id"] for r in rows]
        if ids:
            audit.append(conn, tenant_id, actor, "visits.auto_closed", {"visit_ids": ids})
    return {"closed": len(ids), "visit_ids": ids}
