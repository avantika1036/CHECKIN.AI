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

    llm_provider: str = "gemini"            # "gemini" (real) or "none" (tests inject a fake)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"  # verify the current name in Google AI Studio
    llm_timeout_seconds: int = 20
    llm_max_attempts: int = 3

    pending_expiry_minutes: int = 10        # an unconfirmed proposal is thrown away after this
    max_edit_rounds: int = 3                # after this many edits we send the guard to the plain form
    cors_origins: str = "http://localhost:5173"
    seed_password: str = "changeme123"      # password for the demo users created by the seed


@lru_cache
def get_settings() -> Settings:
    return Settings()
