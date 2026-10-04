"""Small, deterministic text helpers: digits in any script, phone numbers, scripts, titles.

Why it exists: visitors speak or type in English, Hindi (Devanagari) or Punjabi (Gurmukhi),
and phone numbers can arrive as '98765 43210', '+91-98765-43210' or '९८७६५४३२१०'.
The AI must never be the only thing that understands a number, so plain code does it too.
"""
import re
import unicodedata

# Devanagari digits U+0966..U+096F and Gurmukhi digits U+0A66..U+0A6F -> ASCII digits
_DIGIT_MAP = {0x0966 + i: ord("0") + i for i in range(10)}
_DIGIT_MAP.update({0x0A66 + i: ord("0") + i for i in range(10)})

_PHONE_CANDIDATE = re.compile(r"\+?\d[\d\s\-]{8,16}\d")
_TITLE_WORDS = [
    "dr", "prof", "professor", "mr", "mrs", "ms", "miss", "sir", "madam", "maam", "mam", "shri", "sri", "smt", "ji",
    "डॉ", "डा", "डॉक्टर", "प्रो", "प्रोफेसर", "श्री", "श्रीमती", "सर", "मैडम", "मैम", "जी",          # Hindi
    "ਡਾ", "ਡਾਕਟਰ", "ਪ੍ਰੋ", "ਪ੍ਰੋਫੈਸਰ", "ਸ਼੍ਰੀ", "ਸ੍ਰੀ", "ਸ਼੍ਰੀਮਤੀ", "ਸ੍ਰੀਮਤੀ", "ਸਰ", "ਮੈਡਮ", "ਮੈਮ", "ਜੀ",  # Punjabi
]


def to_ascii_digits(text: str) -> str:
    return text.translate(_DIGIT_MAP)


def normalize_phone(raw: str | None) -> str | None:
    """Indian mobile number -> E.164 ('+91' + 10 digits), or None if it is not a valid one."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", to_ascii_digits(raw))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        return "+91" + digits
    return None


def find_phones(text: str) -> list[str]:
    """Every valid phone number that appears in the text (deduplicated, in order)."""
    found: list[str] = []
    for m in _PHONE_CANDIDATE.finditer(to_ascii_digits(text)):
        p = normalize_phone(m.group())
        if p and p not in found:
            found.append(p)
    return found


def has_digits(text: str | None) -> bool:
    return bool(text) and bool(re.search(r"\d", to_ascii_digits(text)))


def norm_text(text: str | None) -> str:
    """Lower-case, Unicode-normalised, punctuation-free, single-spaced. Used only for comparing."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text).casefold()
    # Keep letters, digits and COMBINING MARKS (Hindi/Punjabi vowel signs are marks: a plain \w filter
    # would cut 'राहुल' into pieces). Everything else (punctuation) becomes a space.
    t = "".join(ch if (ch.isalnum() or ch.isspace() or unicodedata.category(ch).startswith("M")) else " "
                for ch in t)
    return re.sub(r"\s+", " ", t).strip()


def script_of(text: str) -> str:
    """'latin' | 'devanagari' | 'gurmukhi' | 'mixed' | 'none'."""
    scripts = set()
    for ch in text:
        if not ch.isalpha():
            continue
        cp = ord(ch)
        if 0x0900 <= cp <= 0x097F:
            scripts.add("devanagari")
        elif 0x0A00 <= cp <= 0x0A7F:
            scripts.add("gurmukhi")
        elif ch.isascii() or 0x00C0 <= cp <= 0x024F:
            scripts.add("latin")
        else:
            scripts.add("other")
    if not scripts:
        return "none"
    return scripts.pop() if len(scripts) == 1 else "mixed"


def strip_titles(name: str | None) -> str:
    """'Dr. Aggarwal sir' -> 'aggarwal'. Titles are noise when matching people."""
    titles = {norm_text(t) for t in _TITLE_WORDS}
    return " ".join(w for w in norm_text(name).split() if w not in titles)
