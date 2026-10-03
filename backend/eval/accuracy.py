"""How well does the understanding step read sentences? (needs a model; `oracle` and `noisy` are fakes)

    python -m eval.accuracy --provider oracle              # proves the harness: must score 100%
    python -m eval.accuracy --provider gemini --split dev  # the real thing (needs GEMINI_API_KEY, uses quota)

Reports intent accuracy, per-field accuracy, how often the safety layer dropped or flagged something,
and latency. Tune prompts on `dev`; look at `test` only for the final number.
"""
import argparse
import copy
import json
import random
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone

from app.db import make_pool, migrate
from app.directory import resolve_host
from app.grounding import check
from app.llm.base import LLMError
from app.llm.fake import FakeProvider
from app.seed import seed
from app.textnorm import norm_text
from app.understanding import understand

from .dataset import load

TENANT = "uiet"


def oracle_provider(cases, noise: float = 0.0, seed_: int = 1):
    by_text = {c["text"]: c["oracle"] for c in cases}
    rng = random.Random(seed_)

    def answer(user_prompt: str):
        text = user_prompt.split("<sentence>\n", 1)[1].rsplit("\n</sentence>", 1)[0]
        out = copy.deepcopy(by_text[text])
        if noise and rng.random() < noise and out.get("phone", {}).get("value"):
            out["phone"]["value"] = out["phone"]["value"][:-1] + str((int(out["phone"]["value"][-1]) + 1) % 10)
        return out
    return FakeProvider(answer)


def score_case(provider, conn, case) -> dict:
    t0 = time.perf_counter()
    row = {"id": case["id"], "style": case["style"], "error": False}
    try:
        u = understand(provider, case["text"], now=datetime.now(timezone.utc), max_attempts=2, sleep=lambda s: None)
    except LLMError as e:
        return {**row, "error": True, "ms": (time.perf_counter() - t0) * 1000, "note": str(e)[:80]}
    row["ms"] = (time.perf_counter() - t0) * 1000
    gold, c = case["gold"], check(u, case["text"])
    row["intent_ok"] = u.intent.value == gold["intent"]
    row["flagged"], row["dropped"] = len(c.flagged), sum(v["status"] == "ungrounded" for v in c.checks.values())
    if gold["intent"] != "unknown" and "name" in gold:
        row["name_ok"] = norm_text(c.fields["name"]) == norm_text(gold["name"])
    if gold["intent"] == "register_visitor":
        res = resolve_host(conn, TENANT, c.fields["host"])
        row["phone_ok"] = c.fields["phone"] == gold["phone"]
        row["host_ok"] = res.status == "resolved" and res.chosen["name"] == gold["host_name"]
        row["purpose_present"] = bool(c.fields["purpose"])
        row["all_ok"] = all([row["intent_ok"], row["name_ok"], row["phone_ok"], row["host_ok"], row["purpose_present"]])
    return row


def summarise(rows: list[dict]) -> dict:
    def rate(key, subset=None):
        vals = [r[key] for r in (subset or rows) if key in r]
        return round(sum(vals) / len(vals), 3) if vals else None
    reg = [r for r in rows if "all_ok" in r]
    lat = sorted(r["ms"] for r in rows)
    return {"cases": len(rows), "model_errors": sum(r["error"] for r in rows),
            "intent_accuracy": rate("intent_ok"), "name_accuracy": rate("name_ok"),
            "phone_accuracy": rate("phone_ok"), "host_resolved_correctly": rate("host_ok"),
            "purpose_present": rate("purpose_present"), "registration_fully_correct": rate("all_ok", reg),
            "avg_fields_dropped_as_ungrounded": round(statistics.mean(r.get("dropped", 0) for r in rows), 3),
            "avg_fields_flagged_for_review": round(statistics.mean(r.get("flagged", 0) for r in rows), 3),
            "latency_ms_median": round(statistics.median(lat)), "latency_ms_p95": round(lat[int(len(lat) * .95) - 1])}


def by_style(rows):
    groups = defaultdict(list)
    for r in rows:
        groups[r["style"]].append(r)
    return {s: summarise(g)["registration_fully_correct"] if any("all_ok" in r for r in g)
            else summarise(g)["intent_accuracy"] for s, g in sorted(groups.items())}


def run(provider, cases, pool) -> tuple[dict, list[dict]]:
    with pool.connection() as conn:
        rows = [score_case(provider, conn, c) for c in cases]
    return summarise(rows), rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["oracle", "noisy", "gemini"], default="oracle")
    ap.add_argument("--split", choices=["dev", "test", "all"], default="dev")
    ap.add_argument("--sleep", type=float, default=0.0, help="seconds between calls (free-tier rate limits)")
    a = ap.parse_args()
    cases = load(a.split)
    pool = make_pool(); pool.open(); migrate(pool); seed(pool)
    if a.provider == "gemini":
        from app.llm.gemini import GeminiProvider
        from app.settings import get_settings
        s = get_settings()
        g = GeminiProvider(s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds)

        class Throttled:                                   # waits between calls to respect free-tier limits
            name = g.name

            def generate_json(self, system, user, schema):
                time.sleep(a.sleep)
                return g.generate_json(system, user, schema)
        provider = Throttled()
        print("model:", g.name)
    else:
        provider = oracle_provider(cases, noise=0.15 if a.provider == "noisy" else 0.0)
    summary, rows = run(provider, cases, pool)
    print(json.dumps(summary, indent=2))
    print("registration fully correct, by style:", by_style(rows))
    pool.close()
