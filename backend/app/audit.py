"""Tamper-evident audit log: a hash chain, one chain per organisation.

Every row stores the hash of the row before it. Changing or deleting any old row
breaks every hash after it, which `verify_chain` detects. It makes tampering
DETECTABLE (not impossible: a database owner could rewrite the whole chain).

Concurrency: two guards saving at the same instant must not fork the chain. We lock
the organisation's `audit_heads` row (SELECT ... FOR UPDATE) inside the caller's
transaction, so appends happen strictly one after another, and an audit row is
committed or rolled back together with the business change it describes.
"""
import hashlib
import json
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

GENESIS = "0" * 64


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _ts_str(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat(timespec="microseconds")


def compute_hash(tenant_id: str, seq: int, ts: datetime, actor: str, event_type: str,
                 payload: dict, prev_hash: str) -> str:
    body = canonical({"tenant": tenant_id, "seq": seq, "ts": _ts_str(ts), "actor": actor,
                      "event": event_type, "payload": payload, "prev": prev_hash})
    return hashlib.sha256(body.encode()).hexdigest()


def append(conn, tenant_id: str, actor: str, event_type: str, payload: dict) -> dict:
    """Add one event. `conn` must be inside a transaction owned by the caller."""
    clean = json.loads(canonical(payload))          # what we hash == what Postgres stores
    conn.execute(
        "INSERT INTO audit_heads (tenant_id, last_seq, last_hash) VALUES (%s, 0, %s) "
        "ON CONFLICT (tenant_id) DO NOTHING", (tenant_id, GENESIS))
    head = conn.execute(
        "SELECT last_seq, last_hash FROM audit_heads WHERE tenant_id = %s FOR UPDATE",
        (tenant_id,)).fetchone()
    seq, prev = head["last_seq"] + 1, head["last_hash"]
    ts = datetime.now(timezone.utc)
    h = compute_hash(tenant_id, seq, ts, actor, event_type, clean, prev)
    conn.execute(
        "INSERT INTO audit_log (tenant_id, seq, ts, actor, event_type, payload, prev_hash, hash) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (tenant_id, seq, ts, actor, event_type, Jsonb(clean), prev, h))
    conn.execute("UPDATE audit_heads SET last_seq = %s, last_hash = %s WHERE tenant_id = %s",
                 (seq, h, tenant_id))
    return {"seq": seq, "hash": h}


def verify_chain(conn, tenant_id: str) -> dict:
    """Recompute every hash. Returns {ok, checked, broken_at, reason}."""
    rows = conn.execute(
        "SELECT seq, ts, actor, event_type, payload, prev_hash, hash FROM audit_log "
        "WHERE tenant_id = %s ORDER BY seq", (tenant_id,)).fetchall()
    prev, expected_seq = GENESIS, 1
    for r in rows:
        if r["seq"] != expected_seq:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": expected_seq,
                    "reason": "missing or reordered row"}
        if r["prev_hash"] != prev:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": r["seq"],
                    "reason": "previous-hash link broken"}
        if compute_hash(tenant_id, r["seq"], r["ts"], r["actor"], r["event_type"],
                        r["payload"], r["prev_hash"]) != r["hash"]:
            return {"ok": False, "checked": expected_seq - 1, "broken_at": r["seq"],
                    "reason": "row content changed"}
        prev, expected_seq = r["hash"], expected_seq + 1
    head = conn.execute("SELECT last_seq, last_hash FROM audit_heads WHERE tenant_id = %s",
                        (tenant_id,)).fetchone()
    if head and (head["last_seq"] != expected_seq - 1 or head["last_hash"] != prev):
        return {"ok": False, "checked": len(rows), "broken_at": None,
                "reason": "rows were removed from the end of the log"}
    return {"ok": True, "checked": len(rows), "broken_at": None, "reason": None}
