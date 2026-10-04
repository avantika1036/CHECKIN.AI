"""Use several providers as one: try the first, and if it is down or slow, use the next - at once.

The important part is the COOLDOWN. If Groq just timed out, the next guard should not wait for it to time
out again: for a short while we skip it and go straight to the backup. After the cooldown it gets another go.
"""
import time

from pydantic import BaseModel

from .base import LLMError, LLMProvider, LLMUnavailable

HARD_ERROR_COOLDOWN = 300       # wrong API key / unknown model: do not keep retrying every request


class ChainProvider:
    def __init__(self, providers: list[LLMProvider], cooldown_seconds: float = 30, clock=time.monotonic):
        if not providers:
            raise ValueError("ChainProvider needs at least one provider")
        self.providers = providers
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._skip_until: dict[str, float] = {}
        self._last_ok: str | None = None

    @property
    def label(self) -> str:
        return " > ".join(p.name for p in self.providers)

    @property
    def name(self) -> str:                       # shown in the trace: which model really answered
        return self._last_ok or self.label

    @property
    def total_tokens(self) -> int:
        return sum(getattr(p, "total_tokens", 0) for p in self.providers)

    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        now = self._clock()
        ready = [p for p in self.providers if self._skip_until.get(p.name, 0) <= now]
        order = ready or self.providers          # everyone is cooling down: try them all rather than give up
        problems: list[str] = []
        hard_only = True
        for p in order:
            try:
                out = p.generate_json(system, user, schema)
                self._last_ok = p.name
                return out
            except LLMUnavailable as e:
                hard_only = False
                wait = e.retry_after if e.retry_after is not None else self.cooldown_seconds
                self._skip_until[p.name] = self._clock() + max(wait, 1)
                problems.append(f"{p.name}: {e}")
            except LLMError as e:
                self._skip_until[p.name] = self._clock() + HARD_ERROR_COOLDOWN
                problems.append(f"{p.name}: {e}")
        message = "all providers failed - " + " | ".join(problems)
        raise (LLMError(message) if hard_only else LLMUnavailable(message))
