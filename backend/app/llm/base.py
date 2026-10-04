"""The ONLY thing the rest of the app knows about language models.

Swapping Gemini for another model means writing one more small class with this one method.
"""
from typing import Protocol

from pydantic import BaseModel


class LLMError(Exception):
    """The model could not give a usable answer (after retries)."""


class LLMUnavailable(LLMError):
    """Network down, timeout, rate limit, server error: worth retrying (or trying another provider)."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after          # seconds the provider asked us to wait, if it said


class LLMProvider(Protocol):
    name: str

    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        """Return the model's answer as JSON text that should match `schema`."""
        ...
