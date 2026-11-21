"""Environment-driven configuration (no secrets are ever logged)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

_TRUE = {"1", "true", "yes", "on"}


def _bool(value: Optional[str], default: bool = False) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in _TRUE


def _split(value: Optional[str]) -> tuple:
    return tuple(p.strip() for p in (value or "").split(",") if p.strip())


def _num(value: Optional[str], default, cast):
    try:
        return cast(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    api_keys: tuple = ()
    model: str = "gemini/gemini-2.0-flash"
    fallback_models: tuple = ()
    database_url: str = "sqlite:////data/app.db"
    allowed_origins: tuple = ("http://localhost:3000", "http://127.0.0.1:3000")
    enable_failure_simulation: bool = False
    cache_enabled: bool = True
    default_system_prompt: str = "You are a helpful, concise assistant."
    temperature: float = 0.0
    max_tokens: int = 1024
    timeout_seconds: float = 30.0
    max_history_messages: int = 40
    rate_limit_per_minute: int = 120
    max_body_bytes: int = 65536
    # Test/dev only: makes LiteLLM return a canned reply without any network call.
    mock_response: Optional[str] = None

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        origins = tuple(o.rstrip("/") for o in _split(e("ALLOWED_ORIGINS")))
        db_env = (e("DATABASE_URL") or "").strip()
        if db_env:
            db_url = db_env
        elif os.path.isdir("/data"):
            db_url = "sqlite:////data/app.db"
        else:
            db_url = "sqlite:///app.db"

        return cls(
            api_keys=_split(e("LLM_API_KEYS")),
            model=(e("LLM_MODEL") or "gemini/gemini-2.0-flash").strip(),
            fallback_models=_split(e("LLM_FALLBACK_MODELS")),
            database_url=db_url,
            allowed_origins=origins or cls.allowed_origins,
            enable_failure_simulation=_bool(e("ENABLE_FAILURE_SIMULATION"), False),
            cache_enabled=_bool(e("CACHE_ENABLED"), True),
            default_system_prompt=(e("DEFAULT_SYSTEM_PROMPT") or "").strip()
            or cls.default_system_prompt,
            temperature=_num(e("LLM_TEMPERATURE"), 0.0, float),
            max_tokens=_num(e("LLM_MAX_TOKENS"), 1024, int),
            timeout_seconds=_num(e("LLM_TIMEOUT_SECONDS"), 30.0, float),
            max_history_messages=_num(e("MAX_HISTORY_MESSAGES"), 40, int),
            rate_limit_per_minute=_num(e("RATE_LIMIT_PER_MINUTE"), 120, int),
            max_body_bytes=_num(e("MAX_BODY_BYTES"), 65536, int),
            mock_response=(e("LLM_MOCK_RESPONSE") or None),
        )

    @property
    def db_path(self) -> str:
        prefix = "sqlite:///"
        url = self.database_url
        return url[len(prefix):] if url.startswith(prefix) else url
