"""Run once, with your own keys in .env, to confirm the real connection works AND how fast it is:

    python scripts/smoke_llm.py
"""
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.grounding import check                      # noqa: E402
from app.llm.factory import build_provider           # noqa: E402
from app.settings import get_settings                # noqa: E402
from app.understanding import understand             # noqa: E402

SENTENCES = [
    "Rahul Sharma, 98765 43210, here to meet Dr Aggarwal for a project discussion",
    "राहुल शर्मा मिलने आए हैं प्रोफेसर वर्मा से, फोन ९८७६५४३२१०, एडमिशन के बारे में",
    "ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ ਹਰਪ੍ਰੀਤ ਸਿੰਘ ਨੂੰ ਮਿਲਣ ਆਇਆ ਹੈ, ਨੰਬਰ 9123456789",
    "Rahul Sharma has left",
    "what is the weather today",
]

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    s = get_settings()
    provider = build_provider(s)
    if provider is None:
        sys.exit("No AI configured. Put GROQ_API_KEY (and/or GEMINI_API_KEY) in backend/.env, and check LLM_PROVIDER.")
    print("configured:", getattr(provider, "label", provider.name), "| timeout", s.llm_timeout_seconds, "s\n")
    times = []
    for text in SENTENCES:
        t0 = time.perf_counter()
        u = understand(provider, text, now=datetime.now(timezone.utc), max_attempts=s.llm_max_attempts)
        ms = (time.perf_counter() - t0) * 1000
        times.append(ms)
        c = check(u, text)
        print(f"> {text}\n  answered by: {provider.name}   time: {ms:.0f} ms\n  intent: {u.intent.value}"
              f"\n  fields: {c.fields}\n  flagged: {c.flagged or '-'}\n")
    print(f"median {statistics.median(times):.0f} ms, slowest {max(times):.0f} ms "
          "(the first call is slower: it opens the connection).")
