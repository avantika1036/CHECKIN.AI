"""Build the model(s) the settings ask for. Returns None when no AI is configured (plain-form mode)."""
from ..settings import Settings
from .chain import ChainProvider
from .gemini import GeminiProvider
from .openai_compat import groq_provider


def build_provider(s: Settings):
    names = [n.strip().lower() for n in s.llm_provider.split(",") if n.strip()]
    built = []
    for n in names:
        if n == "none":
            return None
        if n == "groq":
            if s.groq_api_key:
                built.append(groq_provider(s.groq_api_key, s.groq_model, base_url=s.groq_base_url,
                                           timeout_seconds=s.llm_timeout_seconds,
                                           reasoning_effort=s.groq_reasoning_effort))
        elif n == "gemini":
            if s.gemini_api_key:
                built.append(GeminiProvider(s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds))
        else:
            raise ValueError(f"unknown LLM_PROVIDER entry '{n}' (use groq, gemini or none)")
    if not built:
        return None                                  # no key for any listed provider
    return built[0] if len(built) == 1 else ChainProvider(built, s.llm_cooldown_seconds)
