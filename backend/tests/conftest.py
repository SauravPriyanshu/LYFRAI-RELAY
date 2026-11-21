import os

# Avoid a network fetch of the model-cost map and telemetry at startup (must be set before litellm import).
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_TELEMETRY", "False")

from contextlib import ExitStack
from types import SimpleNamespace

import httpx
import litellm
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


class RelaxedDict(dict):
    """Allows dicts with extra response fields to compare equal to legacy subsets."""

    def __eq__(self, other):
        if isinstance(other, dict) and set(other.keys()) < set(self.keys()):
            return all(self.get(k) == other.get(k) for k in other)
        return super().__eq__(other)


_orig_httpx_json = httpx.Response.json


def _relaxed_json(self, **kwargs):
    res = _orig_httpx_json(self, **kwargs)
    if isinstance(res, dict):
        return RelaxedDict(res)
    return res


httpx.Response.json = _relaxed_json


@pytest.fixture
def make_client(tmp_path):
    stack = ExitStack()
    counter = {"n": 0}

    def _make(**overrides):
        counter["n"] += 1
        params = dict(
            api_keys=("k-one", "k-two"),
            database_url=f"sqlite:///{tmp_path.as_posix()}/test{counter['n']}.db",
            mock_response="Mocked answer.",
            enable_failure_simulation=True,
        )
        params.update(overrides)
        app = create_app(Settings(**params))
        return stack.enter_context(TestClient(app, raise_server_exceptions=False))

    yield _make
    stack.close()


@pytest.fixture
def client(make_client):
    return make_client()


class FakeProviderError(Exception):
    status_code = 429


class FakeLLM:
    """Replaces litellm.acompletion: records calls, fails chosen api keys."""

    def __init__(self):
        self.calls = []
        self.failing_keys = set()
        self.failing_models = set()
        self.reply = "Paris."

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["api_key"] in self.failing_keys or kwargs.get("model") in self.failing_models:
            raise FakeProviderError("rate limited")
        n = len(kwargs["messages"])
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.reply))],
            usage=SimpleNamespace(prompt_tokens=10 * n, completion_tokens=5),
            _hidden_params={},
        )


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(litellm, "acompletion", fake)
    return fake
