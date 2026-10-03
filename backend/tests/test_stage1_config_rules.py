from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.config_schema import TenantConfig
from app.rules import Facts, evaluate
from app.seed import GREENVIEW, UIET

IST = ZoneInfo("Asia/Kolkata")
UIET_CFG, GV_CFG = TenantConfig.model_validate(UIET), TenantConfig.model_validate(GREENVIEW)
GOOD = {"name": "Rahul Sharma", "phone": "+919876543210", "host": "Dr Aggarwal", "purpose": "project discussion"}


def facts(fields=None, host="resolved", hour=11, black=None):
    return Facts(fields={**GOOD, **(fields or {})}, host_status=host,
                 now=datetime(2026, 10, 5, hour, 0, tzinfo=IST), blacklisted_reason=black)


# ---- config validation: typos are rejected at load time, not silently ignored
def test_both_seed_configs_are_valid():
    assert UIET_CFG.rules and GV_CFG.rules


@pytest.mark.parametrize("patch", [
    {"timezone": "Mars/Base"},
    {"rules": [{"id": "x", "type": "teleport", "severity": "block", "message": "m"}]},
    {"rules": [{"id": "x", "type": "regex", "field": "phone", "pattern": "(", "severity": "block", "message": "m"}]},
    {"rules": [{"id": "x", "type": "time_window", "start": "8am", "end": "18:00", "severity": "warn", "message": "m"}]},
    {"rules": [{"id": "a", "type": "blacklist", "severity": "block", "message": "m"},
               {"id": "a", "type": "blacklist", "severity": "block", "message": "m"}]},
])
def test_bad_configs_are_rejected(patch):
    with pytest.raises(ValidationError):
        TenantConfig.model_validate({**UIET, **patch})


# ---- the rule engine
def test_clean_proposal_passes():
    assert evaluate(UIET_CFG, facts()).outcome == "pass"


def test_missing_required_field_is_incomplete():
    r = evaluate(UIET_CFG, facts({"purpose": None}))
    assert r.outcome == "incomplete" and r.missing_fields == ["purpose"]


def test_bad_phone_blocks():
    assert evaluate(UIET_CFG, facts({"phone": "12345"})).outcome == "block"


def test_blacklisted_blocks_and_says_why():
    r = evaluate(UIET_CFG, facts(black="Banned: repeated trespassing"))
    assert r.outcome == "block" and "trespassing" in r.failures[0].message


def test_unknown_or_ambiguous_host_blocks():
    assert evaluate(UIET_CFG, facts(host="not_found")).outcome == "block"
    assert evaluate(UIET_CFG, facts(host="ambiguous")).outcome == "block"


def test_after_hours_needs_approval():
    assert evaluate(UIET_CFG, facts(hour=20)).outcome == "needs_approval"


def test_purpose_keyword_needs_approval():
    assert evaluate(UIET_CFG, facts({"purpose": "Vendor demo"})).outcome == "needs_approval"


def test_warn_rule_only_warns():
    r = evaluate(UIET_CFG, facts({"name": "R2D2"}))
    assert r.outcome == "pass" or r.outcome == "warn"
    assert evaluate(UIET_CFG, facts({"name": "1234"})).outcome == "warn"


def test_block_beats_everything():
    r = evaluate(UIET_CFG, facts({"phone": "12", "purpose": "vendor"}, hour=22))
    assert r.outcome == "block"


def test_same_input_different_config_different_verdict():
    """THE configurability claim: identical facts, two organisations, two outcomes."""
    f = facts({"phone": None}, hour=23)
    assert evaluate(UIET_CFG, f).outcome == "incomplete"        # university: phone required
    assert evaluate(GV_CFG, f).outcome == "needs_approval"      # society: phone optional, late visit needs OK
    assert evaluate(GV_CFG, facts({"purpose": "marketing pitch"})).outcome == "block"


def test_window_crossing_midnight():
    cfg = TenantConfig.model_validate({**UIET, "rules": [
        {"id": "night", "type": "time_window", "start": "22:00", "end": "06:00",
         "severity": "warn", "message": "m"}]})
    assert evaluate(cfg, facts(hour=23)).outcome == "pass"
    assert evaluate(cfg, facts(hour=12)).outcome == "warn"
