"""Run once, with your own key, to confirm the real Gemini connection works:

    python scripts/smoke_llm.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.grounding import check                      # noqa: E402
from app.llm.gemini import GeminiProvider            # noqa: E402
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
    s = get_settings()
    provider = GeminiProvider(s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds)
    print("model:", provider.name)
    for text in SENTENCES:
        u = understand(provider, text, now=datetime.now(timezone.utc))
        c = check(u, text)
        print("\n>", text, "\n  intent:", u.intent.value, "\n  fields:", c.fields,
              "\n  flagged:", c.flagged or "-")
