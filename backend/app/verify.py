"""Turns a *proposal* (fields + optional chosen host) into a rule verdict.

Used twice on purpose: once by the pipeline to show the guard a card, and AGAIN inside
the commit transaction. The commit step never trusts that the pipeline checked.
"""
from datetime import datetime, timezone

from . import directory
from .config_schema import TenantConfig
from .rules import Facts, RuleReport, evaluate
from .textnorm import normalize_phone


class UnknownTenant(Exception):
    pass


def load_config(conn, tenant_id: str) -> tuple[TenantConfig, int]:
    row = conn.execute("SELECT config, config_version FROM tenants WHERE id = %s", (tenant_id,)).fetchone()
    if not row:
        raise UnknownTenant(tenant_id)
    return TenantConfig.model_validate(row["config"]), row["config_version"]


def clean_fields(fields: dict) -> dict:
    """Trim text; turn the phone into E.164 when it is valid (otherwise keep what was typed)."""
    out = {k: (str(v).strip() or None) if v is not None else None
           for k, v in fields.items() if k in ("name", "phone", "host", "purpose")}
    for k in ("name", "phone", "host", "purpose"):
        out.setdefault(k, None)
    if out["phone"]:
        out["phone"] = normalize_phone(out["phone"]) or out["phone"]
    return out


def authorize(conn, tenant_id: str, fields: dict, host_id: str | None,
              now: datetime | None = None) -> tuple[RuleReport, dict]:
    """Returns (rule report, context). Context carries the host and visitor lookups for the UI."""
    config, version = load_config(conn, tenant_id)
    fields = clean_fields(fields)
    now = now or datetime.now(timezone.utc)

    host = None
    candidates: list[dict] = []
    if host_id:
        host = directory.get_host(conn, tenant_id, host_id)
        host_status = "resolved" if host else "not_found"
    else:
        res = directory.resolve_host(conn, tenant_id, fields["host"])
        host_status, candidates, host = res.status, res.candidates, res.chosen

    phone_valid = fields["phone"] if (fields["phone"] or "").startswith("+91") else None
    facts = Facts(fields=fields, host_status=host_status, now=now,
                  blacklisted_reason=directory.blacklist_reason(conn, tenant_id, phone_valid))
    report = evaluate(config, facts)

    returning = directory.find_visitor_by_phone(conn, tenant_id, phone_valid) if phone_valid else None
    similar = []
    if fields["name"] and not returning:
        similar = directory.similar_visitors(conn, tenant_id, fields["name"])
    ctx = {"fields": fields, "host": host, "host_status": host_status, "host_candidates": candidates,
           "returning_visitor": returning, "similar_visitors": similar,
           "config_version": version, "host_label": config.host_label}
    return report, ctx
