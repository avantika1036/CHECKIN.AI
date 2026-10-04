"""Any server that speaks the common "OpenAI chat completions" protocol - Groq is the one we use.

Why plain `httpx` instead of a vendor SDK: one small, readable file; one kept-alive connection (no new
TLS handshake per call, which matters for speed); and we can test every failure without the internet.

JSON handling: most Groq models cannot enforce a JSON *schema*, but all support "JSON mode"
(`response_format: json_object`, which needs the word JSON in the prompt - ours has it, plus the exact
shape). Anything malformed is caught by our own validation + retry in `understanding.py`.
"""
import httpx
from pydantic import BaseModel

from .base import LLMError, LLMUnavailable


class OpenAICompatProvider:
    def __init__(self, *, name: str, api_key: str, model: str, base_url: str, timeout_seconds: float = 10,
                 reasoning_effort: str = "", max_output_tokens: int = 400,
                 transport: httpx.BaseTransport | None = None):
        if not api_key:
            raise LLMError(f"{name}: API key is not set")
        self.name = f"{name}:{model}"
        self._provider = name
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._max_output_tokens = max_output_tokens
        self.total_tokens = 0                # running total, so the evaluation can report tokens per sentence
        self.calls = 0
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(timeout_seconds, connect=min(5.0, timeout_seconds)),
            transport=transport)

    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> str:
        body = {
            "model": self._model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_completion_tokens": self._max_output_tokens,
            "response_format": {"type": "json_object"},
        }
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort
        try:
            resp = self._client.post("/chat/completions", json=body)
        except httpx.TimeoutException as e:
            raise LLMUnavailable(f"{self._provider} timed out ({type(e).__name__})") from e
        except httpx.HTTPError as e:
            raise LLMUnavailable(f"could not reach {self._provider}: {type(e).__name__}") from e
        if resp.status_code != 200:
            self._raise_for(resp)
        try:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMUnavailable(f"{self._provider} sent an unexpected response") from e
        self.calls += 1
        self.total_tokens += int((data.get("usage") or {}).get("total_tokens") or 0)
        if not content or not content.strip():
            raise LLMUnavailable(f"{self._provider} returned an empty answer")
        return content

    def _raise_for(self, resp: httpx.Response) -> None:
        code = resp.status_code
        try:
            detail = (resp.json().get("error") or {}).get("message", "")
        except ValueError:
            detail = resp.text[:120]
        detail = (detail or "").strip()[:160]
        retry_after = None
        try:
            retry_after = min(float(resp.headers.get("retry-after", "")), 120.0)
        except ValueError:
            pass
        if code in (408, 413, 429) or code >= 500:                 # busy, rate-limited or too many tokens/minute
            raise LLMUnavailable(f"{self._provider} temporary error {code}: {detail}", retry_after)
        if code == 400 and "json_validate_failed" in resp.text:     # the model produced broken JSON: try again
            raise LLMUnavailable(f"{self._provider} produced invalid JSON", retry_after)
        if code in (401, 403):
            raise LLMError(f"{self._provider} rejected the API key ({code})")
        if code == 404:
            raise LLMError(f"{self._provider}: model '{self._model}' not found - check the model name")
        raise LLMError(f"{self._provider} rejected the request ({code}): {detail}")

    def close(self) -> None:
        self._client.close()


def groq_provider(api_key: str, model: str, *, base_url: str = "https://api.groq.com/openai/v1",
                  timeout_seconds: float = 10, reasoning_effort: str = "",
                  transport: httpx.BaseTransport | None = None) -> OpenAICompatProvider:
    return OpenAICompatProvider(name="groq", api_key=api_key, model=model, base_url=base_url,
                                timeout_seconds=timeout_seconds, reasoning_effort=reasoning_effort,
                                transport=transport)
