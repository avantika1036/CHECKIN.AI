from collections import defaultdict

from app.grounding import check
from app.textnorm import norm_text
from app.understanding import Understanding
from eval import accuracy, fault_injection
from eval.dataset import build, load


def test_dataset_shape_and_consistency():
    cases = load("all")
    assert len(cases) == 100
    styles = defaultdict(int)
    for c in cases:
        styles[c["style"]] += 1
    assert dict(styles) == {"en": 30, "hinglish": 20, "hi": 15, "pa": 15, "checkout": 12, "unknown": 8}
    assert sum(c["split"] == "test" for c in cases) == 40
    assert build() == cases                                       # the file on disk is exactly what the generator makes
    phones = [c["gold"]["phone"] for c in cases if "phone" in c["gold"]]
    assert len(phones) == len(set(phones))
    for c in cases:                                               # every evidence string really is in its sentence
        for f in ("name", "phone", "host", "purpose"):
            ev = c["oracle"].get(f, {}).get("evidence")
            if ev:
                assert ev in c["text"], (c["id"], f)


def test_a_perfect_model_passes_the_grounding_layer_untouched():
    for c in load("all"):
        if c["gold"]["intent"] != "register_visitor":
            continue
        got = check(Understanding.model_validate(c["oracle"]), c["text"])
        assert got.fields["phone"] == c["gold"]["phone"], c["id"]
        assert norm_text(got.fields["name"]) == norm_text(c["gold"]["name"]), c["id"]
        assert not [f for f, v in got.checks.items() if v["status"] == "ungrounded"]


def test_oracle_scores_100_percent(seeded):
    cases = load("all")
    summary, _ = accuracy.run(accuracy.oracle_provider(cases), cases, seeded)
    assert summary["intent_accuracy"] == summary["registration_fully_correct"] == 1.0
    assert summary["model_errors"] == 0


def test_phone_typos_by_the_model_are_repaired_by_code(seeded):
    """A model that mis-copies a digit 40% of the time: pattern matcher keeps phone accuracy at 100%."""
    cases = load("all")
    summary, _ = accuracy.run(accuracy.oracle_provider(cases, noise=0.4), cases, seeded)
    assert summary["phone_accuracy"] == 1.0
    assert summary["avg_fields_flagged_for_review"] > 0.37          # ...and the disagreements were flagged


def test_fault_injection_headline_results(seeded):
    cases = []
    seen = set()
    for c in load("all"):
        if c["gold"]["intent"] == "register_visitor" and c["style"] not in seen:
            seen.add(c["style"]); cases.append(c)
    stats = fault_injection.run(seeded, cases)
    safe = ["invent_phone", "wrong_digit", "drop_phone", "invent_purpose", "unknown_host",
            "invent_other_host", "intent_flip"]
    for k in safe:
        assert stats[k]["rubber_bad"] == 0, k                      # even a guard who approves everything
    for k in ("invent_phone", "wrong_digit", "drop_phone", "invent_purpose", "invent_other_host"):
        assert stats[k]["naive_bad"] == stats[k]["n"], k           # a naive system saves wrong data every time
    assert stats["none (control)"]["rubber_bad"] == 0
    assert stats["none (control)"]["rubber_saved_correct"] == stats["none (control)"]["n"]   # no false rejections
    assert stats["wrong_name (grounded)"]["attentive_bad"] == 0
    # KNOWN LIMITATION, asserted so it can never be forgotten: a wrong name in Hindi/Punjabi cannot be proven
    # wrong by code, so a guard who approves blindly lets it through.
    assert stats["wrong_name (grounded)"]["rubber_bad"] > 0
