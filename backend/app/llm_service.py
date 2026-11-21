"""LiteLLM gateway: built-in cache, key pool, failover and failure simulation."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from collections import OrderedDict

# Avoid a network fetch of the model-cost map and telemetry at startup (must be set before import).
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_TELEMETRY", "False")

from dataclasses import dataclass, field  # noqa: E402
from typing import Optional  # noqa: E402

import litellm  # noqa: E402
from litellm import Cache  # noqa: E402

from .config import Settings  # noqa: E402
from .errors import AllProvidersUnavailable  # noqa: E402

litellm.telemetry = False
litellm.suppress_debug_info = True
litellm.set_verbose = False

logger = logging.getLogger("app.llm")

SIMULATED_STATUSES = {429, 500, 502, 503}


def parse_failure_header(value: Optional[str]) -> dict:
    """'key_1=429,key_2=500' / '*=429' -> {'key_1': 429, ...}. Invalid pairs are ignored."""
    result: dict = {}
    if not value:
        return result
    for part in value.split(","):
        if "=" not in part:
            continue
        key, _, raw = part.partition("=")
        key, raw = key.strip(), raw.strip()
        try:
            status = int(raw)
        except ValueError:
            continue
        if key and status in SIMULATED_STATUSES:
            result[key] = status
    return result


def compute_cache_key(model: str, messages: list) -> str:
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class BoundedLatencyCache:
    def __init__(self, maxsize: int = 500) -> None:
        self.maxsize = maxsize
        self._cache: OrderedDict[str, int] = OrderedDict()

    def get(self, key: str) -> Optional[int]:
        return self._cache.get(key)

    def set(self, key: str, latency_ms: int) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = latency_ms
            return
        if len(self._cache) >= self.maxsize:
            self._cache.popitem(last=False)
        self._cache[key] = latency_ms

    def __len__(self) -> int:
        return len(self._cache)


def clean_reasoning(reply: str) -> str:
    """Strip <think>...</think> blocks (DOTALL) and trim; keep original if empty."""
    cleaned = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL).strip()
    return cleaned if cleaned else reply


@dataclass
class LLMResult:
    reply: str
    resolution_source: str
    model: str
    input_tokens: int
    output_tokens: int
    key_id: Optional[str]
    fallback_attempts: int
    attempts: list = field(default_factory=list)


class LLMService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.keys = tuple(settings.api_keys)
        self.fallback_models = tuple(settings.fallback_models)
        self.cache_enabled = bool(settings.cache_enabled)
        self.latency_cache = BoundedLatencyCache(maxsize=500)
        # LiteLLM built-in in-memory cache. Its key = model + messages + generation params
        # (api_key is NOT part of it, so a hit is shared across keys).
        litellm.cache = Cache(type="local") if self.cache_enabled else None
        if len(self.keys) < 2:
            logger.warning("Only %d API key(s) configured; failover needs at least 2", len(self.keys))

    def _kwargs(self, model: str, key: str, messages: list, use_cache: bool) -> dict:
        kwargs = dict(
            model=model,
            messages=messages,
            api_key=key,
            temperature=self.settings.temperature,
            max_tokens=self.settings.max_tokens,
            timeout=self.settings.timeout_seconds,
            num_retries=0,  # failover is handled here, not by LiteLLM retries
        )
        if self.cache_enabled:
            kwargs["caching"] = use_cache
        if self.settings.mock_response:
            kwargs["mock_response"] = self.settings.mock_response
        return kwargs

    @staticmethod
    def _extract(response, messages: list, model: str):
        reply = ""
        try:
            reply = (response.choices[0].message.content or "").strip()
        except (AttributeError, IndexError, TypeError):
            pass
        if not reply:
            raise ValueError("empty reply from provider")
        reply = clean_reasoning(reply)
        usage = getattr(response, "usage", None)
        prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion = int(getattr(usage, "completion_tokens", 0) or 0)
        if prompt == 0:
            try:
                prompt = int(litellm.token_counter(model=model, messages=messages))
            except Exception:  # noqa: BLE001
                prompt = 0
        if completion == 0:
            try:
                completion = int(litellm.token_counter(model=model, text=reply))
            except Exception:  # noqa: BLE001
                completion = 0
        hidden = getattr(response, "_hidden_params", None) or {}
        cache_hit = bool(hidden.get("cache_hit")) if isinstance(hidden, dict) else False
        return reply, prompt, completion, cache_hit

    async def complete(self, messages: list, simulate: Optional[dict] = None) -> LLMResult:
        simulate = simulate or {}
        failures = 0
        simulated_any = False
        attempts: list[dict] = []
        models_to_try = [self.settings.model, *self.settings.fallback_models]

        for current_model in models_to_try:
            for index, key in enumerate(self.keys, start=1):
                key_id = f"key_{index}"
                status = simulate.get(key_id, simulate.get("*"))
                if status is not None:
                    # Simulated provider failure: no network call, just count it and move on.
                    logger.warning("%s on %s: simulated failure status=%s", key_id, current_model, status)
                    failures += 1
                    simulated_any = True
                    attempts.append({
                        "key_id": key_id,
                        "model": current_model,
                        "outcome": "failed",
                        "reason": f"simulated_{status}",
                    })
                    continue
                # A request that used the failure hook must be a *real* answer, so skip the cache.
                use_cache = not simulated_any
                try:
                    response = await litellm.acompletion(**self._kwargs(current_model, key, messages, use_cache))
                    reply, prompt, completion, cache_hit = self._extract(
                        response, messages, current_model
                    )
                except Exception as exc:  # noqa: BLE001 - any provider failure -> next key
                    # Log only the class/status, never the message (it may echo credentials).
                    status_code = getattr(exc, "status_code", None)
                    logger.warning(
                        "%s on %s failed: %s status=%s",
                        key_id,
                        current_model,
                        type(exc).__name__,
                        status_code,
                    )
                    failures += 1
                    if isinstance(exc, ValueError) and "empty reply" in str(exc).lower():
                        reason = "empty_reply"
                    elif status_code is not None:
                        reason = f"{type(exc).__name__} {status_code}"
                    else:
                        reason = type(exc).__name__
                    attempts.append({
                        "key_id": key_id,
                        "model": current_model,
                        "outcome": "failed",
                        "reason": reason,
                    })
                    continue
                if cache_hit:
                    return LLMResult(
                        reply=reply,
                        resolution_source="LLM_CACHE",
                        model=current_model,
                        input_tokens=prompt,
                        output_tokens=completion,
                        key_id=None,
                        fallback_attempts=0,
                        attempts=[],
                    )
                attempts.append({
                    "key_id": key_id,
                    "model": current_model,
                    "outcome": "ok",
                })
                return LLMResult(
                    reply=reply,
                    resolution_source="LIVE_INFERENCE",
                    model=current_model,
                    input_tokens=prompt,
                    output_tokens=completion,
                    key_id=key_id,
                    fallback_attempts=failures,
                    attempts=attempts,
                )
        raise AllProvidersUnavailable()
