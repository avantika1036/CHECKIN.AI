"""Compare names BY SOUND across English, Hindi (Devanagari) and Punjabi (Gurmukhi). Plain code, no AI.

The problem: a guard types "राहुल शर्मा". The model answers "Rahul Sharma". Code cannot check that by
looking for the text. But both are the same sounds, so we reduce each spelling to its CONSONANT SKELETON:

    राहुल शर्मा  ->  r h l   s r m
    ਰਾਹੁਲ ਸ਼ਰਮਾ  ->  r h l   s r m
    Rahul Sharma ->  r h l   s r m          (vowels dropped, aspirated sounds merged: sh->s, kh->k ...)

Why consonants only: vowels are the least stable part of transliteration (Sharma / Sharmaa / Sarma),
consonants carry most of the identity. Why it is safe to trust: it is used only to (a) CONFIRM the model's
spelling or (b) fall back to the guard's own words. It is never used to invent anything.

Honest limits (tested): names that differ only in vowels (Rahul / Rohul) look identical; one changed final
consonant in a short name can pass (Simran / Simrat). The guard still sees the card.
"""
import re
import unicodedata
from difflib import SequenceMatcher

from .textnorm import norm_text, strip_titles, to_ascii_digits

# Sound classes. Aspirated/retroflex/voiced variants merge: Hindi and English spell them inconsistently.
_BRAHMI = {  # offset from the start of the script block -> class. Devanagari (0x900) and Gurmukhi (0xA00)
    0x15: "k", 0x16: "k", 0x17: "g", 0x18: "g", 0x19: "n", 0x1A: "c", 0x1B: "c", 0x1C: "j", 0x1D: "j", 0x1E: "n",
    0x1F: "t", 0x20: "t", 0x21: "d", 0x22: "d", 0x23: "n", 0x24: "t", 0x25: "t", 0x26: "d", 0x27: "d", 0x28: "n",
    0x29: "n", 0x2A: "p", 0x2B: "p", 0x2C: "b", 0x2D: "b", 0x2E: "m", 0x2F: "y", 0x30: "r", 0x31: "r", 0x32: "l",
    0x33: "l", 0x34: "l", 0x35: "v", 0x36: "s", 0x37: "s", 0x38: "s", 0x39: "h",
}
_NUKTA_FORMS = {  # precomposed nukta letters: क़ ख़ ग़ ज़ ड़ ढ़ फ़ (Devanagari) and ਖ਼ ਗ਼ ਜ਼ ਫ਼ ੜ (Gurmukhi)
    0x958: "k", 0x959: "k", 0x95A: "g", 0x95B: "j", 0x95C: "d", 0x95D: "d", 0x95E: "p", 0x95F: "y",
    0xA59: "k", 0xA5A: "g", 0xA5B: "j", 0xA5E: "p", 0xA5C: "d",
}
_NASAL_MARKS = {0x901, 0x902, 0xA01, 0xA02, 0xA70}      # chandrabindu, anusvara, bindi, tippi
_LATIN_DIGRAPHS = [("chh", "c"), ("ch", "c"), ("sh", "s"), ("kh", "k"), ("gh", "g"), ("jh", "j"), ("th", "t"),
                   ("dh", "d"), ("ph", "p"), ("bh", "b"), ("ngh", "ng"), ("ng", "ng")]
_LATIN_SINGLE = {"c": "k", "q": "k", "w": "v", "z": "j", "f": "p", "x": "ks"}
_LATIN_VOWELS = set("aeiou")
NAME_TOKEN = 0.85        # verifying a name: each word must sound (almost) the same - strict, wrong names are costly
SEARCH_TOKEN = 0.75      # looking someone up: more forgiving, because the guard still picks from a short list
NAME_SOUNDS_OK = 0.90    # a whole name is accepted as "matches by sound" at or above this


def _brahmic_word_skeleton(word: str) -> str:
    out: list[str] = []
    chars = list(word)
    for i, ch in enumerate(chars):
        cp = ord(ch)
        base = 0x900 if 0x900 <= cp <= 0x97F else 0xA00 if 0xA00 <= cp <= 0xA7F else None
        if base is None:
            continue
        if cp in _NUKTA_FORMS:
            out.append(_NUKTA_FORMS[cp])
        elif cp in _NASAL_MARKS:
            # Hindi spells Singh as सिंह (anusvara + ह at the end of the word): that is 'ng', not 'nh'
            if base == 0x900 and i + 2 == len(chars) and ord(chars[i + 1]) == 0x939:
                out.append("ng")
                chars[i + 1] = " "
            else:
                out.append("n")
        elif 0x15 <= cp - base <= 0x39 and (cp - base) in _BRAHMI:
            out.append(_BRAHMI[cp - base])
        # vowels, vowel signs, virama, nukta, addak: dropped
    return "".join(out)


def _latin_word_skeleton(word: str) -> str:
    w = re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", word.lower()))
    out, i = [], 0
    while i < len(w):
        for dg, cls in _LATIN_DIGRAPHS:
            if w.startswith(dg, i):
                out.append(cls); i += len(dg); break
        else:
            ch = w[i]
            if ch not in _LATIN_VOWELS:
                out.append(_LATIN_SINGLE.get(ch, ch))
            i += 1
    return "".join(out)


def _collapse(s: str) -> str:
    return re.sub(r"(.)\1+", r"\1", s)               # 'gg' -> 'g'  (Aggarwal), 'll' -> 'l'  (Gill)


def skeleton_tokens(text: str | None) -> list[str]:
    """One consonant skeleton per word, titles removed, digits kept ('a101' -> 'a', '101')."""
    tokens: list[str] = []
    for word in strip_titles(to_ascii_digits(text or "")).split():
        for piece in re.findall(r"\d+|[^\d]+", word):
            if piece.isdigit():
                tokens.append(piece)
                continue
            s = _brahmic_word_skeleton(piece) or _latin_word_skeleton(piece)
            s = _collapse(s)
            if s:
                tokens.append(s)
    return tokens


def token_similarity(a: str, b: str) -> float:
    if a.isdigit() or b.isdigit():
        return 1.0 if a == b else 0.0
    return SequenceMatcher(None, a, b).ratio()


def tokens_match_score(query: list[str], target: list[str], threshold: float = SEARCH_TOKEN) -> float:
    """How much of `query` is found in `target`: average, over query words, of the best word match."""
    if not query or not target:
        return 0.0
    total = 0.0
    for q in query:
        best = max(token_similarity(q, t) for t in target)
        total += best if best >= threshold else 0.0
    return total / len(query)


def name_sound_similarity(a: str | None, b: str | None) -> float:
    """0..1: do these two spellings sound like the same name? Symmetric; works across scripts."""
    ta, tb = skeleton_tokens(a), skeleton_tokens(b)
    if not ta or not tb:
        return 0.0
    return min(tokens_match_score(ta, tb, NAME_TOKEN), tokens_match_score(tb, ta, NAME_TOKEN))
