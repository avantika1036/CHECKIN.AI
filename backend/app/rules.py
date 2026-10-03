"""The Business Rule Engine. PURE: no database, no AI, no network.

Input : the organisation's config + a `Facts` object (what we know about this proposal).
Output: a `RuleReport` with one result per rule and one overall outcome.

Because it is a pure function it is trivial to test, and it cannot be talked into
anything by a clever sentence. This is the safety core of the project.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from .config_schema import (BlacklistRule, EnumRule, HostMustExistRule, PurposeTriggerRule,
                            RegexRule, TenantConfig, TimeWindowRule)

HostStatus = Literal["resolved", "ambiguous", "not_found", "missing"]
Outcome = Literal["block", "incomplete", "needs_approval", "warn", "pass"]


@dataclass
class Facts:
    fields: dict[str, str | None]              # name, phone (E.164), host (text), purpose
    host_status: HostStatus
    now: datetime                              # timezone-aware
    blacklisted_reason: str | None = None


class RuleResult(BaseModel):
    rule_id: str
    status: Literal["pass", "fail", "skip"]    # skip = the field it checks is empty
    severity: str
    message: str


class RuleReport(BaseModel):
    outcome: Outcome
    missing_fields: list[str]
    results: list[RuleResult]

    @property
    def failures(self) -> list[RuleResult]:
        return [r for r in self.results if r.status == "fail"]

    @property
    def can_commit(self) -> bool:
        return self.outcome in ("pass", "warn", "needs_approval")


def _in_window(now_local: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= now_local <= end
    return now_local >= start or now_local <= end      # window that crosses midnight


def _hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def _check(rule, facts: Facts, tz: ZoneInfo) -> bool | None:
    """True = passed, False = failed, None = not applicable (skipped)."""
    if isinstance(rule, (RegexRule, EnumRule)):
        value = facts.fields.get(rule.field)
        if not value:
            return None
        if isinstance(rule, RegexRule):
            return re.fullmatch(rule.pattern, value) is not None
        return value.strip().casefold() in {a.casefold() for a in rule.allowed}
    if isinstance(rule, BlacklistRule):
        return facts.blacklisted_reason is None
    if isinstance(rule, HostMustExistRule):
        if facts.host_status == "missing":
            return None
        return facts.host_status == "resolved"
    if isinstance(rule, TimeWindowRule):
        local = facts.now.astimezone(tz).time()
        return _in_window(local, _hhmm(rule.start), _hhmm(rule.end))
    if isinstance(rule, PurposeTriggerRule):
        purpose = (facts.fields.get("purpose") or "").casefold()
        if not purpose:
            return None
        return not any(k.casefold() in purpose for k in rule.keywords)
    raise TypeError(f"unknown rule type {type(rule)}")        # unreachable: config is validated


def evaluate(config: TenantConfig, facts: Facts) -> RuleReport:
    tz = ZoneInfo(config.timezone)
    results: list[RuleResult] = []
    for rule in config.rules:
        verdict = _check(rule, facts, tz)
        status = "skip" if verdict is None else ("pass" if verdict else "fail")
        message = rule.message
        if isinstance(rule, BlacklistRule) and status == "fail" and facts.blacklisted_reason:
            message = f"{rule.message} ({facts.blacklisted_reason})"
        results.append(RuleResult(rule_id=rule.id, status=status, severity=rule.severity, message=message))

    missing = [f for f in config.required_fields if not facts.fields.get(f)]
    failed = {r.severity for r in results if r.status == "fail"}

    if "block" in failed:
        outcome: Outcome = "block"
    elif missing:
        outcome = "incomplete"
    elif "needs_approval" in failed:
        outcome = "needs_approval"
    elif "warn" in failed:
        outcome = "warn"
    else:
        outcome = "pass"
    return RuleReport(outcome=outcome, missing_fields=missing, results=results)
