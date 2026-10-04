"""Groq adapter, failover chain and provider selection. No internet: HTTP is replaced by a scripted transport."""
import json

import httpx
import pytest

from app.llm.base import LLMError, LLMUnavailable
from app.llm.chain import HARD_ERROR_COOLDOWN, ChainProvider
from app.llm.factory import build_provider
from app.llm.fake import FakeProvider
from app.llm.openai_compat import groq_provider
from app.settings import Settings
from app.understanding import Intent, Understanding, understand
from datetime import datetime, timezone

OK_JSON = {"intent": "register_visitor", "name": {"value": "Rahul", "evidence": "Rahul"}}


def reply(content=None, status=200, headers=None, body=None, usage=None):
    def handler(request: httpx.Request) -> httpx.Response:
        handler.seen.append(request)
        if body is not None:
            return httpx.Response(status, json=body, headers=headers)
        return httpx.Response(status, headers=headers, json={
            "choices": [{"message": {"content": content}}], "usage": usage or {"total_tokens": 321}})
    handler.seen = []
    return handler


def groq(handler, **kw):
    return groq_provider("test-key", "llama-3.3-70b-versatile", transport=httpx.MockTransport(handler), **kw)


# ------------------------------------------------------------------ the Groq adapter
def test_request_is_what_groq_expects():
    h = reply(json.dumps(OK_JSON))
    out = groq(h).generate_json("SYS prompt with JSON", "the sentence", Understanding)
    assert json.loads(out) == OK_JSON
    req = h.seen[0]
    assert str(req.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer test-key"
    body = json.loads(req.content)
    assert body["model"] == "llama-3.3-70b-versatile" and body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "reasoning_effort" not in body                       # only sent when configured
    assert body["max_completion_tokens"] <= 500                 # short answers = fast answers


def test_reasoning_effort_only_when_configured():
    h = reply("{}")
    groq(h, reasoning_effort="low").generate_json("s", "u", Understanding)
    assert json.loads(h.seen[0].content)["reasoning_effort"] == "low"


def test_tokens_are_counted():
    p = groq(reply("{}", usage={"total_tokens": 700}))
    p.generate_json("s", "u", Understanding); p.generate_json("s", "u", Understanding)
    assert p.total_tokens == 1400 and p.calls == 2


def test_the_real_prompt_mentions_json_and_the_shape():
    """Groq's JSON mode refuses prompts that never say 'JSON'; our prompt must also show the exact shape."""
    from app.understanding import SYSTEM_PROMPT
    assert "JSON" in SYSTEM_PROMPT and '"intent"' in SYSTEM_PROMPT and '"evidence"' in SYSTEM_PROMPT


@pytest.mark.parametrize("status,headers,retry", [(429, {"retry-after": "7"}, 7.0), (429, {}, None),
                                                   (500, {}, None), (503, {}, None), (413, {}, None)])
def test_busy_or_rate_limited_is_retryable(status, headers, retry):
    h = reply(status=status, headers=headers, body={"error": {"message": "slow down"}})
    with pytest.raises(LLMUnavailable) as e:
        groq(h).generate_json("s", "u", Understanding)
    assert e.value.retry_after == retry


def test_broken_json_from_the_model_is_retryable():
    h = reply(status=400, body={"error": {"message": "bad", "code": "json_validate_failed"}})
    with pytest.raises(LLMUnavailable):
        groq(h).generate_json("s", "u", Understanding)


@pytest.mark.parametrize("status", [401, 403, 404, 400])
def test_wrong_key_unknown_model_or_bad_request_is_not_retryable(status):
    h = reply(status=status, body={"error": {"message": "nope"}})
    with pytest.raises(LLMError) as e:
        groq(h).generate_json("s", "u", Understanding)
    assert not isinstance(e.value, LLMUnavailable)


def test_timeout_and_connection_failures_are_retryable():
    def slow(request): raise httpx.ReadTimeout("too slow")
    def down(request): raise httpx.ConnectError("no wifi")
    for fn in (slow, down):
        with pytest.raises(LLMUnavailable):
            groq(fn).generate_json("s", "u", Understanding)


def test_empty_or_odd_answers_are_retryable():
    for h in (reply(""), reply(None), reply(status=200, body={"unexpected": True})):
        with pytest.raises(LLMUnavailable):
            groq(h).generate_json("s", "u", Understanding)


def test_missing_key_is_refused_immediately():
    with pytest.raises(LLMError):
        groq_provider("", "m")


def test_works_through_the_real_understanding_step():
    u = understand(groq(reply(json.dumps(OK_JSON))), "Rahul is here", now=datetime.now(timezone.utc))
    assert u.intent == Intent.register_visitor and u.name.value == "Rahul"


# ------------------------------------------------------------------ the failover chain
class Clock:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


def make_chain(script_a, script_b, cooldown=30):
    a, b = FakeProvider(script_a), FakeProvider(script_b)
    a.name, b.name = "groq:x", "gemini:y"
    clock = Clock()
    return ChainProvider([a, b], cooldown_seconds=cooldown, clock=clock), a, b, clock


def test_first_provider_is_used_when_healthy():
    chain, a, b, _ = make_chain(["A1", "A2"], ["B1"])
    assert chain.generate_json("s", "u", Understanding) == "A1" and chain.name == "groq:x" and not b.calls


def test_falls_back_immediately_when_the_first_is_down():
    chain, a, b, _ = make_chain([LLMUnavailable("down")], ["B1"])
    assert chain.generate_json("s", "u", Understanding) == "B1" and chain.name == "gemini:y"


def test_a_failed_provider_is_skipped_during_cooldown_then_tried_again():
    chain, a, b, clock = make_chain([LLMUnavailable("down"), "A-back"], ["B1", "B2", "B3"])
    chain.generate_json("s", "u", Understanding)                 # a fails, b answers
    assert len(a.calls) == 1
    chain.generate_json("s", "u", Understanding)                 # a is cooling down: NOT asked again
    assert len(a.calls) == 1 and len(b.calls) == 2
    clock.t += 31                                                # cooldown over
    assert chain.generate_json("s", "u", Understanding) == "A-back" and len(a.calls) == 2


def test_provider_supplied_retry_after_sets_the_cooldown():
    chain, a, b, clock = make_chain([LLMUnavailable("rate limited", retry_after=90), "A"], ["B1", "B2"], cooldown=5)
    chain.generate_json("s", "u", Understanding)
    clock.t += 60                                                # beyond our default 5s, inside the 90s asked for
    chain.generate_json("s", "u", Understanding)
    assert len(a.calls) == 1


def test_wrong_key_fails_over_and_is_not_retried_for_a_long_time():
    chain, a, b, clock = make_chain([LLMError("bad key")], ["B1", "B2", "B3"])
    chain.generate_json("s", "u", Understanding)
    clock.t += HARD_ERROR_COOLDOWN - 1
    chain.generate_json("s", "u", Understanding)
    assert len(a.calls) == 1


def test_when_everything_is_down_it_says_so_and_still_tries_again_later():
    chain, a, b, clock = make_chain([LLMUnavailable("a down"), "A-ok"], [LLMUnavailable("b down")])
    with pytest.raises(LLMUnavailable) as e:
        chain.generate_json("s", "u", Understanding)
    assert "groq:x" in str(e.value) and "gemini:y" in str(e.value)
    assert chain.generate_json("s", "u", Understanding) == "A-ok"   # all cooling -> try all rather than give up


def test_all_hard_errors_raise_a_hard_error():
    chain, *_ = make_chain([LLMError("bad key")], [LLMError("bad key")])
    with pytest.raises(LLMError) as e:
        chain.generate_json("s", "u", Understanding)
    assert not isinstance(e.value, LLMUnavailable)


# ------------------------------------------------------------------ choosing providers from settings
def settings(**kw):
    return Settings(_env_file=None, **kw)


def test_factory_variants():
    assert build_provider(settings(llm_provider="none", groq_api_key="k")) is None
    assert build_provider(settings(llm_provider="groq,gemini")) is None                       # no keys at all
    only = build_provider(settings(llm_provider="groq,gemini", groq_api_key="k"))
    assert only.name.startswith("groq:")                                                      # missing Gemini key is skipped
    both = build_provider(settings(llm_provider="groq,gemini", groq_api_key="k", gemini_api_key="g"))
    assert isinstance(both, ChainProvider) and [p.name.split(":")[0] for p in both.providers] == ["groq", "gemini"]
    swapped = build_provider(settings(llm_provider="gemini,groq", groq_api_key="k", gemini_api_key="g"))
    assert swapped.providers[0].name.startswith("gemini")


def test_factory_rejects_a_typo():
    with pytest.raises(ValueError):
        build_provider(settings(llm_provider="gorq", groq_api_key="k"))


def test_defaults_favour_speed_and_groq_first(monkeypatch):
    for var in ("LLM_PROVIDER", "LLM_TIMEOUT_SECONDS", "LLM_MAX_ATTEMPTS"):
        monkeypatch.delenv(var, raising=False)            # the test suite sets LLM_PROVIDER=none; look at the real default
    s = settings()
    assert s.llm_provider == "groq,gemini" and s.llm_timeout_seconds <= 10 and s.llm_max_attempts == 2
