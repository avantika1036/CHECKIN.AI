"""Fault injection: how many WRONG records reach the database when the model is wrong?

We take clean model outputs (the `oracle`), deliberately corrupt them in ways real models do
(invent a phone number, invent a person, mis-copy a digit...), and push each corrupted answer through
  (A) a NAIVE pipeline that trusts the model and writes straight to the database, and
  (B) OUR pipeline (grounding + cross-checks + rule engine + commit re-check),
counting "bad records" = a visit saved whose name/phone/host/purpose differ from the truth.

Two kinds of guard are simulated for (B):
  * rubber-stamp: presses Confirm on every card that allows it (worst case, no human help)
  * attentive   : cancels when the card flags any field as unverified/ungrounded

    python -m eval.fault_injection
"""
import copy
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from langgraph.checkpoint.postgres import PostgresSaver

from app.db import make_pool, migrate
from app.directory import resolve_host
from app.graph import build_graph, resume_run, start_run
from app.llm.fake import FakeProvider
from app.seed import seed
from app.settings import get_settings
from app.textnorm import norm_text, normalize_phone

from .dataset import load

IST = ZoneInfo("Asia/Kolkata")
NOW = datetime(2026, 10, 5, 11, 0, tzinfo=IST)
TENANT = "uiet"


def _set(o, field, value, evidence):
    o[field] = {"value": value, "evidence": evidence}


def c_invent_phone(o, case):      _set(o, "phone", "9811122233", "98111 22233")
def c_wrong_digit(o, case):       o["phone"]["value"] = o["phone"]["value"][:-1] + str((int(o["phone"]["value"][-1]) + 3) % 10)
def c_drop_phone(o, case):        o["phone"] = {"value": None, "evidence": None}
def c_invent_purpose(o, case):    _set(o, "purpose", "urgent audit", "urgent audit")
def c_unknown_host(o, case):      _set(o, "host", "Dr Mahesh Bansal", "Dr Mahesh Bansal")
def c_invent_other_host(o, case): _set(o, "host", "Harpreet Singh" if "Harpreet" not in case["gold"]["host_name"] else "Sunita Verma", "Dr Someone")
def c_intent_flip(o, case):       o["intent"] = "checkout_visitor"
def c_wrong_name(o, case):        o["name"]["value"] = "Rohit Kumar"
def c_swap_name_host(o, case):
    n, h = copy.deepcopy(o["name"]), copy.deepcopy(o["host"])
    o["name"], o["host"] = h, n


CORRUPTIONS = {"none (control)": lambda o, c: None, "invent_phone": c_invent_phone, "wrong_digit": c_wrong_digit,
               "drop_phone": c_drop_phone, "invent_purpose": c_invent_purpose, "unknown_host": c_unknown_host,
               "invent_other_host": c_invent_other_host, "intent_flip": c_intent_flip,
               "wrong_name (grounded)": c_wrong_name, "swap_name_host (grounded)": c_swap_name_host}


def is_bad(row: dict, gold: dict) -> bool:
    return not (norm_text(row["name"]) == norm_text(gold["name"]) and row["phone"] == gold["phone"]
                and row["host"] == gold["host_name"] and norm_text(row["purpose"]) == norm_text(gold["purpose"]))


def fetch_visits(pool):
    with pool.connection() as c:
        return c.execute("SELECT v.name, v.phone, h.name AS host, vi.purpose FROM visits vi "
                         "JOIN visitors v ON v.id = vi.visitor_id JOIN hosts h ON h.id = vi.host_id").fetchall()


def reset_activity(pool):
    with pool.connection() as c:
        c.execute("TRUNCATE notifications, visits, visitors CASCADE")


def naive_pipeline(pool, output: dict):
    """Trust the model completely: no evidence check, no rules, no confirmation."""
    if output["intent"] != "register_visitor":
        return
    f = {k: output.get(k, {}).get("value") for k in ("name", "phone", "host", "purpose")}
    with pool.connection() as c:
        res = resolve_host(c, TENANT, f["host"])
        top = (res.chosen or (res.candidates[0] if res.candidates else None))
        if not (f["name"] and top and f["purpose"]):
            return                                           # the database would reject a missing NOT NULL value
        phone = normalize_phone(f["phone"]) or f["phone"]
        vid = c.execute("INSERT INTO visitors (tenant_id, name, phone) VALUES (%s,%s,%s) RETURNING id",
                        (TENANT, f["name"], phone)).fetchone()["id"]
        c.execute("INSERT INTO visits (tenant_id, visitor_id, host_id, purpose, status, idempotency_key, "
                  "config_version, created_by) VALUES (%s,%s,%s,%s,'checked_in',gen_random_uuid()::text,1,'naive')",
                  (TENANT, vid, top["id"], f["purpose"]))


def our_pipeline(graph, case, output, attentive: bool, run_id: str):
    r = start_run(graph, run_id, {"tenant_id": TENANT, "actor": "eval", "mode": "text", "text": case["text"]})
    if r["status"] != "awaiting" or r["card"]["kind"] != "register":
        return
    card = r["card"]
    flagged = any(c["status"] in ("unverified", "ungrounded") for c in card["checks"].values())
    if card["can_confirm"] and not (attentive and flagged):
        resume_run(graph, run_id, {"action": "confirm"})
    else:
        resume_run(graph, run_id, {"action": "cancel"})


def run(pool, cases) -> dict:
    cp = make_pool(autocommit=True); cp.open()
    saver = PostgresSaver(cp); saver.setup()
    stats = defaultdict(lambda: defaultdict(int))
    registrations = [c for c in cases if c["gold"]["intent"] == "register_visitor"]
    try:
        for cname, corrupt in CORRUPTIONS.items():
            for case in registrations:
                output = copy.deepcopy(case["oracle"])
                corrupt(output, case)
                s = stats[cname]
                s["n"] += 1
                reset_activity(pool)
                naive_pipeline(pool, output)
                rows = fetch_visits(pool)
                s["naive_bad"] += any(is_bad(r, case["gold"]) for r in rows)
                for mode in ("rubber", "attentive"):
                    reset_activity(pool)
                    graph = build_graph(pool, saver, FakeProvider(lambda _u, o=output: o), get_settings(),
                                        clock=lambda: NOW)
                    our_pipeline(graph, case, output, mode == "attentive", f"{cname}-{case['id']}-{mode}")
                    rows = fetch_visits(pool)
                    bad = any(is_bad(r, case["gold"]) for r in rows)
                    s[f"{mode}_bad"] += bad
                    s[f"{mode}_saved_correct"] += bool(rows) and not bad
                    s[f"{mode}_stopped"] += not rows
    finally:
        cp.close()
    return {k: dict(v) for k, v in stats.items()}


def format_table(stats: dict) -> str:
    head = f"{'corruption':28} {'n':>3} | {'naive bad':>9} | {'ours bad (rubber-stamp)':>24} | {'ours bad (attentive)':>21} | {'stopped(att)':>12} | {'saved correct(att)':>18}"
    lines = [head, "-" * len(head)]
    for k, s in stats.items():
        lines.append(f"{k:28} {s['n']:>3} | {s['naive_bad']:>9} | {s['rubber_bad']:>24} | {s['attentive_bad']:>21} | "
                     f"{s['attentive_stopped']:>12} | {s['attentive_saved_correct']:>18}")
    return "\n".join(lines)


if __name__ == "__main__":
    pool = make_pool(); pool.open(); migrate(pool); seed(pool)
    cases = [c for c in load("all") if c["gold"]["intent"] == "register_visitor"]
    # one representative per (style) mix keeps the run short; use all of them with --all
    import sys
    if "--all" not in sys.argv:
        seen, picked = defaultdict(int), []
        for c in cases:
            if seen[c["style"]] < 4:
                seen[c["style"]] += 1
                picked.append(c)
        cases = picked
    print(f"{len(cases)} registration sentences x {len(CORRUPTIONS)} kinds of model mistake\n")
    print(format_table(run(pool, cases)))
    pool.close()
