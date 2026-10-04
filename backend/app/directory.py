"""Lookups in the database that the pipeline needs: hosts, returning visitors, blacklist.

The AI never decides who the host is. It only reports the words it heard ("Dr Aggarwal");
this module finds the real person with fuzzy text matching (pg_trgm) and says honestly
when it is not sure (several matches, or none).
"""
from dataclasses import dataclass, field

from .indic import NAME_TOKEN, SEARCH_TOKEN, skeleton_tokens, tokens_match_score
from .textnorm import norm_text, strip_titles

CANDIDATE_MIN = 0.40     # below this a host is not even offered in the "pick one" list
RESOLVE_MIN = 0.90       # to be chosen AUTOMATICALLY every word must match closely (strict sound match)
RESOLVE_GAP = 0.15       # ...and beat the runner-up by at least this much


@dataclass
class HostResolution:
    status: str                                   # resolved | ambiguous | not_found | missing
    candidates: list[dict] = field(default_factory=list)
    chosen: dict | None = None


_HOST_SQL = """
SELECT id::text AS id, name, department, email, aliases,
       GREATEST(
         word_similarity(%(q)s, norm(name)), word_similarity(norm(name), %(q)s),
         COALESCE((SELECT max(GREATEST(word_similarity(%(q)s, norm(a)), word_similarity(norm(a), %(q)s)))
                   FROM unnest(aliases) a), 0)
       )::float AS trigram
FROM hosts
WHERE tenant_id = %(t)s AND active
"""


def resolve_host(conn, tenant_id: str, spoken: str | None) -> HostResolution:
    """Find the real person for the words the guard used.

    Two independent scores, the better one counts:
      * trigram similarity of the spelling (good for English typos), computed by PostgreSQL;
      * sound similarity (indic.py): 'Agrawal', 'अग्रवाल' and 'ਅਗਰਵਾਲ' all match 'Aggarwal'.
    Aliases ('aggarwal sir', 'flat A-101', or the name in Hindi/Punjabi) are compared too.
    """
    q = strip_titles(spoken) or norm_text(spoken)
    if not q:
        return HostResolution("missing")
    wanted = skeleton_tokens(spoken)
    scored = []
    for r in conn.execute(_HOST_SQL, {"q": q, "t": tenant_id}).fetchall():
        labels = [skeleton_tokens(x) for x in [r["name"], *r["aliases"]]]
        strict = max((tokens_match_score(wanted, t, NAME_TOKEN) for t in labels), default=0.0)
        lenient = max((tokens_match_score(wanted, t, SEARCH_TOKEN) for t in labels), default=0.0)
        scored.append({"id": r["id"], "name": r["name"], "department": r["department"], "email": r["email"],
                       "score": max(r["trigram"], lenient, strict), "certain": strict})
    # Why two scores: "Gurpreet Singh" is SIMILAR to staff member "Harpreet Singh" - good enough to OFFER in a
    # list, never good enough to pick silently (that would notify the wrong person).
    rows = sorted((r for r in scored if r["score"] >= CANDIDATE_MIN), key=lambda r: (-r["score"], r["name"]))[:5]
    if not rows:
        return HostResolution("not_found")
    by_certainty = sorted(rows, key=lambda r: -r["certain"])
    top = by_certainty[0]
    runner_up = by_certainty[1]["certain"] if len(by_certainty) > 1 else 0.0
    public = [{k: v for k, v in r.items() if k != "certain"} for r in rows]
    if top["certain"] >= RESOLVE_MIN and top["certain"] - runner_up >= RESOLVE_GAP:
        chosen = next(r for r in public if r["id"] == top["id"])
        return HostResolution("resolved", public, chosen)
    return HostResolution("ambiguous", public)


def get_host(conn, tenant_id: str, host_id: str) -> dict | None:
    return conn.execute(
        "SELECT id::text AS id, name, department, email FROM hosts "
        "WHERE tenant_id = %s AND id = %s AND active", (tenant_id, host_id)).fetchone()


def find_visitor_by_phone(conn, tenant_id: str, phone: str) -> dict | None:
    return conn.execute(
        "SELECT v.id::text AS id, v.name, v.phone, "
        "(SELECT count(*) FROM visits x WHERE x.visitor_id = v.id) AS visit_count "
        "FROM visitors v WHERE v.tenant_id = %s AND v.phone = %s", (tenant_id, phone)).fetchone()


def similar_visitors(conn, tenant_id: str, name: str, exclude_id: str | None = None) -> list[dict]:
    """People with a similar name (possible duplicates). Only ever a *suggestion*."""
    return conn.execute(
        "SELECT id::text AS id, name, phone, similarity(lower(name), %s)::float AS score "
        "FROM visitors WHERE tenant_id = %s AND similarity(lower(name), %s) >= 0.6 "
        "AND (%s::uuid IS NULL OR id <> %s::uuid) ORDER BY score DESC LIMIT 3",
        (name.lower(), tenant_id, name.lower(), exclude_id, exclude_id)).fetchall()


def blacklist_reason(conn, tenant_id: str, phone: str | None) -> str | None:
    if not phone:
        return None
    row = conn.execute("SELECT reason FROM blacklist WHERE tenant_id = %s AND phone = %s",
                       (tenant_id, phone)).fetchone()
    return row["reason"] if row else None


def open_visits_matching(conn, tenant_id: str, name: str | None, phone: str | None) -> list[dict]:
    """Checked-in visits that could be the one the guard means (for check-out)."""
    return conn.execute(
        "SELECT vi.id::text AS id, v.name, v.phone, h.name AS host, vi.arrived_at, "
        "GREATEST(similarity(lower(v.name), %(n)s), (v.phone = %(p)s)::int)::float AS score "
        "FROM visits vi JOIN visitors v ON v.id = vi.visitor_id JOIN hosts h ON h.id = vi.host_id "
        "WHERE vi.tenant_id = %(t)s AND vi.status = 'checked_in' "
        "AND (v.phone = %(p)s OR word_similarity(%(n)s, lower(v.name)) >= 0.5) "
        "ORDER BY score DESC, vi.arrived_at DESC LIMIT 5",
        {"t": tenant_id, "n": (name or "").lower(), "p": phone}).fetchall()
