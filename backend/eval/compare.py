"""Which model should we use? Run the SAME sentences through several models and compare accuracy AND speed.

    python -m eval.compare --models llama-3.3-70b-versatile,llama-3.1-8b-instant,openai/gpt-oss-20b \\
                           --split dev --limit 4 --sleep 6

--limit 4  = 4 sentences per language/style (about 24 sentences) - enough to see a difference without
             burning the free-tier daily token allowance (each sentence costs roughly 700-900 tokens).
--sleep 6  = seconds between calls, so the per-minute token limit is not hit (not counted in the timings).

Read the 'hi' and 'pa' columns first: that is how well each model copes with Hindi and Punjabi.
Check the model names in your Groq console; they change over time.
"""
import argparse
import sys
from collections import defaultdict

from app.devtools import mask, use_test_database

from .accuracy import build_live_provider, by_style, run
from .dataset import load


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["groq", "gemini"], default="groq")
    ap.add_argument("--models", required=True, help="comma separated model names")
    ap.add_argument("--split", choices=["dev", "test", "all"], default="dev")
    ap.add_argument("--limit", type=int, default=4)
    ap.add_argument("--sleep", type=float, default=6.0)
    a = ap.parse_args()

    print("using database:", mask(use_test_database()))
    from app.db import make_pool, migrate
    from app.seed import seed
    cases, seen = [], defaultdict(int)
    for c in load(a.split):
        if seen[c["style"]] < a.limit:
            seen[c["style"]] += 1
            cases.append(c)
    print(f"{len(cases)} sentences x {len(a.models.split(','))} models; about {len(cases) * 800:,} tokens per model\\n")
    pool = make_pool(); pool.open(); migrate(pool); seed(pool)

    results = []
    for model in [m.strip() for m in a.models.split(",") if m.strip()]:
        print("running", model, "...", flush=True)
        provider = build_live_provider(a.provider, model)
        summary, rows = run(provider, cases, pool, a.sleep)
        results.append((model, summary, by_style(rows)))
    pool.close()

    styles = ["en", "hinglish", "hi", "pa", "checkout"]
    head = f"{'model':34}{'errors':>7}{'intent':>8}" + "".join(f"{s:>10}" for s in styles) + f"{'median ms':>11}{'p95 ms':>8}{'tok/sent':>9}"
    print("\\n" + head + "\\n" + "-" * len(head))
    for model, sm, st in results:
        line = f"{model:34}{sm['model_errors']:>7}{sm['intent_accuracy']:>8}"
        line += "".join(f"{st.get(s, '-')!s:>10}" for s in styles)
        print(line + f"{sm['latency_ms_median']:>11}{sm['latency_ms_p95']:>8}{sm.get('tokens_per_sentence', '-')!s:>9}")
    print("\\nColumns en..pa = share of registrations fully correct (name, phone, host, purpose) per language;"
          "\\n'errors' = calls that failed (rate limit, timeout...) - if high, raise --sleep before comparing accuracy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
