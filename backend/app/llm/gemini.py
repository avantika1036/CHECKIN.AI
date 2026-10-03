"""Gemini through Google's `google-genai` SDK, asked to answer in a fixed JSON shape.

NOTE: this class is the one part of the project that talks to the internet. Our automated
tests use a fake provider instead; run `python scripts/smoke_llm.py` once with your own key
to confirm it works end to end.
"""
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from .base import LLMError, LLMUnavailable


class GeminiProvider:
    def __init__(self, api_key: str, model: str, timeout_seconds: int = 20):
        if not api_key:
            raise LLMError("GEMINI_API_KEY is not set")
        self.name = f"gemini:{model}"
        self._model = model
        self._client = genai.Client(api_key=api_key,
                                    http_options=types.HttpOptions(timeout=timeout_seconds * 1000))

    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        try:
            resp = self._client.models.generate_content(
                model=self._model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0,                                  # same input -> (almost) same output
                    response_mime_type="application/json",
                    response_schema=schema,                         # model is forced into our shape
                ),
            )
        except errors.APIError as e:
            code = getattr(e, "code", None)
            if code in (408, 429) or (isinstance(code, int) and code >= 500):
                raise LLMUnavailable(f"Gemini temporary error {code}") from e
            raise LLMError(f"Gemini rejected the request ({code}): {e}") from e
        except Exception as e:                                      # timeouts, DNS, connection resets
            raise LLMUnavailable(f"could not reach Gemini: {type(e).__name__}") from e
        text = resp.text
        if not text:
            raise LLMUnavailable("Gemini returned an empty answer")
        return text
