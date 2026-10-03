"""Step 2: do not believe the model. Check its output against the sentence, with plain code.

Three ideas:
  * EVIDENCE CHECK  - every value must come with words that really exist in the sentence;
                      a value with invented evidence is thrown away.
  * PHONE CROSS-CHECK - a regular expression finds phone numbers on its own; code beats the model.
  * HONEST UNCERTAINTY - when we cannot verify something (a name transliterated from Hindi, a number
                      spoken in words) we keep it but flag it, so the guard looks at it.

Status per field: ok | unverified | ungrounded (dropped) | missing
"""
from dataclasses import dataclass

from .textnorm import find_phones, has_digits, norm_text, normalize_phone, script_of
from .understanding import Evidenced, Understanding

FIELDS = ("name", "phone", "host", "purpose")


@dataclass
class Checked:
    fields: dict[str, str | None]
    checks: dict[str, dict]            # field -> {"status", "note", "evidence"}

    @property
    def flagged(self) -> list[str]:
        return [f for f, c in self.checks.items() if c["status"] in ("unverified", "ungrounded")]


def _evidence_in_text(ev: Evidenced, text: str) -> bool:
    return bool(ev.evidence) and bool(norm_text(ev.evidence)) and norm_text(ev.evidence) in norm_text(text)


def _check_name(ev: Evidenced, text: str) -> tuple[str | None, str, str]:
    if not ev.value:
        return None, "missing", ""
    if not _evidence_in_text(ev, text):
        return None, "ungrounded", "the name is not in your sentence"
    v, e = norm_text(ev.value), norm_text(ev.evidence)
    if script_of(ev.evidence) not in ("latin", "none"):
        return ev.value.strip(), "unverified", "written in another script - check the spelling"
    if v in e or e in v:
        return ev.value.strip(), "ok", ""
    # same script but different words: the model changed the name. The sentence's own words win.
    return ev.evidence.strip(), "unverified", "model changed the spelling - using the words from your sentence"


def _check_phone(ev: Evidenced, text: str) -> tuple[str | None, str, str]:
    in_text = find_phones(text)                               # independent, no AI involved
    model_phone = None
    model_note = ""
    if ev.value:
        if not _evidence_in_text(ev, text):
            model_note = "the model's number is not in your sentence"
        else:
            model_phone = normalize_phone(ev.value)
    if in_text:
        if model_phone in in_text:
            return model_phone, "ok", ""
        if len(in_text) == 1:
            note = "number found by pattern matching" if not ev.value else "model and pattern matcher disagreed - check"
            return in_text[0], "ok" if not ev.value else "unverified", note
        return in_text[0], "unverified", "several numbers in the sentence - check which one"
    if ev.value and not model_note:                           # no digits found: spoken in words?
        if has_digits(ev.evidence):
            return ev.value.strip(), "unverified", "number looks incomplete or invalid"
        return model_phone or ev.value.strip(), "unverified", "number was spoken in words - check every digit"
    if ev.value:
        return None, "ungrounded", model_note
    return None, "missing", ""


def _check_free_text(ev: Evidenced, text: str) -> tuple[str | None, str, str]:
    if not ev.value:
        return None, "missing", ""
    if not _evidence_in_text(ev, text):
        return None, "ungrounded", "not found in your sentence"
    return ev.value.strip(), "ok", ""


def check(u: Understanding, text: str) -> Checked:
    fn = {"name": _check_name, "phone": _check_phone, "host": _check_free_text, "purpose": _check_free_text}
    fields, checks = {}, {}
    for f in FIELDS:
        ev: Evidenced = getattr(u, f)
        value, status, note = fn[f](ev, text)
        fields[f] = value
        checks[f] = {"status": status, "note": note, "evidence": ev.evidence}
    return Checked(fields, checks)
