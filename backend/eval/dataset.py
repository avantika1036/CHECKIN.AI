"""Synthetic evaluation set (v1): 100 sentences in English, Hinglish, Hindi and Punjabi.

IMPORTANT HONESTY NOTE: template sentences are EASIER than real speech. Use this set to catch
regressions and to compare configurations; do not quote it as real-world accuracy. Add real,
human-written and ASR-noisy sentences to eval/data/human_v1.jsonl (see README in that folder).

Each case also carries `oracle`: the output a perfect model would give. We use it to test the
harness itself and as the clean starting point for fault injection.

Run:  python -m eval.dataset      (rewrites eval/data/synthetic_v1.jsonl)
"""
import json
import random
from pathlib import Path

DATA = Path(__file__).parent / "data" / "synthetic_v1.jsonl"

NAMES = [("Rahul Sharma", "राहुल शर्मा", "ਰਾਹੁਲ ਸ਼ਰਮਾ"), ("Amit Kumar", "अमित कुमार", "ਅਮਿਤ ਕੁਮਾਰ"),
         ("Simran Kaur", "सिमरन कौर", "ਸਿਮਰਨ ਕੌਰ"), ("Gurpreet Singh", "गुरप्रीत सिंह", "ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ"),
         ("Neha Gupta", "नेहा गुप्ता", "ਨੇਹਾ ਗੁਪਤਾ"), ("Vikas Mehta", "विकास मेहता", "ਵਿਕਾਸ ਮਹਿਤਾ"),
         ("Pooja Rani", "पूजा रानी", "ਪੂਜਾ ਰਾਣੀ"), ("Manpreet Gill", "मनप्रीत गिल", "ਮਨਪ੍ਰੀਤ ਗਿੱਲ"),
         ("Deepak Joshi", "दीपक जोशी", "ਦੀਪਕ ਜੋਸ਼ੀ"), ("Anjali Thakur", "अंजलि ठाकुर", "ਅੰਜਲੀ ਠਾਕੁਰ")]
# (name in the database, Latin spoken form, Hindi, Punjabi)
HOSTS = [("Dr. Naveen Aggarwal", "Naveen Aggarwal", "नवीन अग्रवाल", "ਨਵੀਨ ਅਗਰਵਾਲ"),
         ("Dr. Rajesh Aggarwal", "Rajesh Aggarwal", "राजेश अग्रवाल", "ਰਾਜੇਸ਼ ਅਗਰਵਾਲ"),
         ("Prof. Sunita Verma", "Sunita Verma", "सुनीता वर्मा", "ਸੁਨੀਤਾ ਵਰਮਾ"),
         ("Mr. Harpreet Singh", "Harpreet Singh", "हरप्रीत सिंह", "ਹਰਪ੍ਰੀਤ ਸਿੰਘ")]
# (English, Hinglish, Hindi, Punjabi)
PURPOSES = [("project discussion", "project discussion", "प्रोजेक्ट पर चर्चा", "ਪ੍ਰੋਜੈਕਟ ਬਾਰੇ ਚਰਚਾ"),
            ("admission enquiry", "admission ki jaankari", "एडमिशन की जानकारी", "ਦਾਖਲੇ ਬਾਰੇ ਪੁੱਛਗਿੱਛ"),
            ("fee payment", "fees jama karni hai", "फीस जमा करनी है", "ਫੀਸ ਜਮ੍ਹਾਂ ਕਰਵਾਉਣੀ"),
            ("document verification", "documents verify karwane", "दस्तावेज़ सत्यापन", "ਦਸਤਾਵੇਜ਼ ਤਸਦੀਕ"),
            ("scholarship form", "scholarship form", "छात्रवृत्ति फॉर्म", "ਵਜ਼ੀਫ਼ਾ ਫਾਰਮ")]
UNKNOWN = ["what is the weather today", "how many visitors came yesterday", "कैसे हो", "ਤੁਸੀਂ ਕੌਣ ਹੋ", "hello hello testing",
           "open the main gate", "when does the library close", "thanks"]
_HI = str.maketrans("0123456789", "०१२३४५६७८९")
_PA = str.maketrans("0123456789", "੦੧੨੩੪੫੬੭੮੯")


def _phone(rng: random.Random, used: set) -> str:
    while True:
        p = str(rng.choice("6789")) + "".join(rng.choice("0123456789") for _ in range(9))
        if p not in used and not p.startswith("9000000"):
            used.add(p)
            return p


def _field(value, evidence):
    return {"value": value, "evidence": evidence} if value else {"value": None, "evidence": None}


def build() -> list[dict]:
    rng, used, cases = random.Random(7), set(), []
    plan = ["en"] * 30 + ["hinglish"] * 20 + ["hi"] * 15 + ["pa"] * 15 + ["checkout"] * 12 + ["unknown"] * 8
    for i, style in enumerate(plan):
        nm, hs, pu = rng.choice(NAMES), rng.choice(HOSTS), rng.choice(PURPOSES)
        ph = _phone(rng, used)
        e164 = "+91" + ph
        if style == "unknown":
            text = UNKNOWN[i % len(UNKNOWN)]
            oracle = {"intent": "unknown"}
            gold = {"intent": "unknown"}
        elif style == "checkout":
            kind = rng.choice(["en", "hi"])
            name_ev = nm[0] if kind == "en" else nm[1]
            text = f"{nm[0]} has left" if kind == "en" else f"{nm[1]} चले गए"
            oracle = {"intent": "checkout_visitor", "name": _field(nm[0], name_ev)}
            gold = {"intent": "checkout_visitor", "name": nm[0]}
        else:
            fmt = rng.choice([ph, f"{ph[:5]} {ph[5:]}", f"+91 {ph[:5]}-{ph[5:]}"])
            if style == "en":
                host_ev = f"Dr {hs[1]}" if rng.random() < .5 else hs[1]
                text = f"{nm[0]}, {fmt}, here to meet {host_ev} for {pu[0]}"
                ev = dict(name=nm[0], phone=fmt, host=host_ev, purpose=pu[0])
            elif style == "hinglish":
                text = f"{nm[0]} aaye hain {hs[1]} sir se milne, number {fmt}, {pu[1]}"
                ev = dict(name=nm[0], phone=fmt, host=hs[1], purpose=pu[1])
            elif style == "hi":
                p_hi = ph.translate(_HI)
                text = f"{nm[1]}, फोन {p_hi}, {hs[2]} से मिलने आए हैं, {pu[2]}"
                ev = dict(name=nm[1], phone=p_hi, host=hs[2], purpose=pu[2])
            else:
                p_pa = ph.translate(_PA)
                text = f"{nm[2]}, ਨੰਬਰ {p_pa}, {hs[3]} ਨੂੰ ਮਿਲਣ ਆਇਆ ਹੈ, {pu[3]}"
                ev = dict(name=nm[2], phone=p_pa, host=hs[3], purpose=pu[3])
            oracle = {"intent": "register_visitor", "name": _field(nm[0], ev["name"]),
                      "phone": _field(ph, ev["phone"]), "host": _field(hs[1], ev["host"]),
                      "purpose": _field(pu[0], ev["purpose"])}
            gold = {"intent": "register_visitor", "name": nm[0], "phone": e164, "host_name": hs[0],
                    "purpose": pu[0]}
        cases.append({"id": f"s{i:03d}", "style": style, "split": "test" if i % 5 in (0, 2) else "dev",
                      "text": text, "gold": gold, "oracle": oracle})
    rng.shuffle(cases)
    return cases


def load(split: str = "all", path: Path = DATA) -> list[dict]:
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [c for c in cases if split == "all" or c["split"] == split]


if __name__ == "__main__":
    cases = build()
    DATA.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n", encoding="utf-8")
    print(f"wrote {len(cases)} cases to {DATA}")
