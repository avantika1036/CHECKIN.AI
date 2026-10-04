"""All configuration comes from environment variables (see .env.example).

Why: secrets (API keys, JWT secret) must never be written in code or committed to git.
pydantic-settings reads the environment, validates types, and gives us one typed object.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/checkin"
    jwt_secret: str = "dev-only-secret-change-me-before-any-real-use-0123456789"
    jwt_ttl_minutes: int = 480

    # Which model(s) to use, in priority order, comma separated: "groq,gemini" (Groq first, Gemini as backup),
    # "groq", "gemini", or "none" (no AI: every sentence goes to the plain form).
    llm_provider: str = "groq,gemini"
    llm_timeout_seconds: int = 10           # per call; a slow provider is abandoned after this
    llm_max_attempts: int = 2
    llm_cooldown_seconds: int = 30          # a provider that just failed is skipped for this long

    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"       # verify the current list in the Groq console
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_reasoning_effort: str = ""         # only for reasoning models such as openai/gpt-oss-20b: low|medium|high

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"  # verify the current name in Google AI Studio

    pending_expiry_minutes: int = 10        # an unconfirmed proposal is thrown away after this
    max_edit_rounds: int = 3                # after this many edits we send the guard to the plain form
    cors_origins: str = "http://localhost:5173"
    seed_password: str = "changeme123"      # password for the demo users created by the seed
    auto_seed: bool = False                 # true = load the demo organisations/users at startup (Docker uses this)


@lru_cache
def get_settings() -> Settings:
    return Settings()
