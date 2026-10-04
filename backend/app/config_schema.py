"""The per-organisation configuration: the thing that makes checkIn.ai a *platform*.

A config is plain JSON stored in the `tenants` table. It is validated here when it is
loaded, so a typo (an unknown rule type, a broken regex, a bad time zone) is rejected
immediately instead of silently disabling a rule.
"""
import re
from typing import Annotated, Literal, Union
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator, model_validator

Field_ = Literal["name", "phone", "host", "purpose"]
Severity = Literal["block", "needs_approval", "warn"]   # what happens when a rule FAILS
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class _Rule(BaseModel):
    id: str
    severity: Severity
    message: str


class RegexRule(_Rule):
    type: Literal["regex"]
    field: Field_
    pattern: str                      # value must match

    @field_validator("pattern")
    @classmethod
    def _compiles(cls, v: str) -> str:
        try:
            re.compile(v)
        except re.error as e:
            raise ValueError(f"invalid regex: {e}")
        return v


class EnumRule(_Rule):
    type: Literal["enum"]
    field: Field_
    allowed: list[str]                # value must be one of these (case-insensitive)


class BlacklistRule(_Rule):
    type: Literal["blacklist"]        # phone must not be on the blacklist table


class HostMustExistRule(_Rule):
    type: Literal["host_must_exist"]  # the person to meet must be found, unambiguously


class TimeWindowRule(_Rule):
    type: Literal["time_window"]      # arrival must fall inside [start, end] local time
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("time must look like HH:MM")
        return v


class PurposeTriggerRule(_Rule):
    type: Literal["purpose_triggers"]  # FAILS when the purpose contains any of these words
    keywords: list[str]


Rule = Annotated[
    Union[RegexRule, EnumRule, BlacklistRule, HostMustExistRule, TimeWindowRule, PurposeTriggerRule],
    Field(discriminator="type"),
]


class TenantConfig(BaseModel):
    display_name: str
    timezone: str = "Asia/Kolkata"
    host_label: str = "Person to meet"
    required_fields: list[Field_] = ["name", "phone", "host", "purpose"]
    rules: list[Rule] = []
    autoclose_time: str | None = None          # 'HH:MM' local; open visits are closed after this

    @field_validator("autoclose_time")
    @classmethod
    def _autoclose_time(cls, v: str | None) -> str | None:
        if v is not None and not _HHMM.match(v):
            raise ValueError("autoclose_time must look like HH:MM")
        return v

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError(f"unknown time zone: {v}")
        return v

    @model_validator(mode="after")
    def _unique_ids(self):
        ids = [r.id for r in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule ids must be unique")
        return self
