import json

import pytest


def chat(client, session_id="s-1", message="What is the capital of France?", headers=None, **extra):
    body = {"session_id": session_id, "message": message, **extra}
    return client.post("/chat", json=body, headers=headers or {})


# ---------- health ----------
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "keys_configured": 2, "cache_enabled": True}


# ---------- /chat contract ----------
def test_chat_contract(client):
    r = chat(client)
    assert r.status_code == 200
    data = r.json()
    assert data["session_id"] == "s-1"
    assert data["reply"]
    m = data["metadata"]
    assert m["resolution_source"] == "LIVE_INFERENCE"
    assert m["model"] == "gemini/gemini-2.0-flash"
    assert m["key_id"] == "key_1"
    assert m["fallback_attempts"] == 0
    for field in ("latency_ms", "input_tokens", "output_tokens"):
        assert isinstance(m[field], int)
    assert "k-one" not in r.text


# ---------- caching ----------
def test_cache_hit_same_first_message_new_session(client):
    first = chat(client, "a", "cache me please").json()
    second = chat(client, "b", "cache me please").json()
    assert first["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert second["metadata"]["resolution_source"] == "LLM_CACHE"
    assert second["metadata"]["key_id"] is None
    assert second["metadata"]["fallback_attempts"] == 0
    assert second["reply"] == first["reply"]
    assert second["metadata"]["input_tokens"] == first["metadata"]["input_tokens"]
    assert second["metadata"]["output_tokens"] == first["metadata"]["output_tokens"]


def test_different_message_never_cached(client):
    chat(client, "a", "message one")
    other = chat(client, "b", "message two").json()
    assert other["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_different_system_prompt_never_cached(client):
    chat(client, "a", "same text", system_prompt="You are a pirate.")
    other = chat(client, "b", "same text", system_prompt="You are a poet.").json()
    assert other["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_cache_disabled(make_client):
    c = make_client(cache_enabled=False)
    chat(c, "a", "hello cache")
    again = chat(c, "b", "hello cache").json()
    assert again["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert c.get("/health").json()["cache_enabled"] is False


# ---------- multi-turn ----------
def test_multi_turn_sends_history(client, fake_llm):
    chat(client, "mt", "My name is Ada.")
    chat(client, "mt", "What is my name?")
    sent = fake_llm.calls[1]["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[1]["content"] == "My name is Ada."
    assert sent[3]["content"] == "What is my name?"


def test_input_tokens_are_per_request(client, fake_llm):
    first = chat(client, "tok", "hello").json()["metadata"]
    second = chat(client, "tok", "again").json()["metadata"]
    assert first["input_tokens"] == 20   # system + user
    assert second["input_tokens"] == 40  # system + user + assistant + user (this request only)
    assert second["output_tokens"] == 5


def test_system_prompt_persists_and_is_hidden(client, fake_llm):
    chat(client, "sp", "hi", system_prompt="You are a pirate.")
    chat(client, "sp", "again")
    assert fake_llm.calls[0]["messages"][0]["content"] == "You are a pirate."
    assert fake_llm.calls[1]["messages"][0]["content"] == "You are a pirate."
    history = client.get("/sessions/sp/messages").json()["messages"]
    assert all(m["role"] in ("user", "assistant") for m in history)
    assert "pirate" not in json.dumps(history)


# ---------- history endpoint ----------
def test_history_endpoint(client):
    chat(client, "h1", "first")
    chat(client, "h1", "second")
    r = client.get("/sessions/h1/messages")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "h1"
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[0]["content"] == "first" and "metadata" not in msgs[0]
    meta = msgs[1]["metadata"]
    assert {"resolution_source", "input_tokens", "output_tokens"} <= set(meta)


def test_history_unknown_session_404(client):
    r = client.get("/sessions/nope/messages")
    assert r.status_code == 404
    assert r.json() == {"detail": "session not found"}


def test_history_isolated_between_sessions(client):
    chat(client, "iso-a", "only in a")
    chat(client, "iso-b", "only in b")
    a = client.get("/sessions/iso-a/messages").json()["messages"]
    b = client.get("/sessions/iso-b/messages").json()["messages"]
    assert a[0]["content"] == "only in a" and len(a) == 2
    assert b[0]["content"] == "only in b" and len(b) == 2


def test_history_survives_new_app_instance(tmp_path, make_client):
    db = f"sqlite:///{tmp_path.as_posix()}/persist.db"
    chat(make_client(database_url=db), "persist", "remember me")
    msgs = make_client(database_url=db).get("/sessions/persist/messages").json()["messages"]
    assert msgs[0]["content"] == "remember me"


# ---------- validation ----------
@pytest.mark.parametrize(
    "body",
    [
        {"session_id": "s", "message": ""},
        {"session_id": "s", "message": "   \n\t "},
        {"session_id": "s", "message": "x" * 4001},
        {"session_id": "s"},
        {"message": "hi"},
        {"session_id": "", "message": "hi"},
        {"session_id": "   ", "message": "hi"},
        {"session_id": "s" * 129, "message": "hi"},
        {"session_id": "s", "message": 123},
        {"session_id": "s", "message": "hi", "system_prompt": 5},
    ],
)
def test_validation_422_and_not_persisted(client, body):
    r = client.post("/chat", json=body)
    assert r.status_code == 422
    assert "detail" in r.json()
    assert client.get(f"/sessions/{body.get('session_id', 's')}/messages").status_code == 404


def test_malformed_json_422(client):
    r = client.post("/chat", content="{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_message_trimmed_and_boundary(client, fake_llm):
    ok = chat(client, "b1", "  " + "x" * 4000 + "  ")
    assert ok.status_code == 200
    assert fake_llm.calls[0]["messages"][-1]["content"] == "x" * 4000
    assert client.get("/sessions/b1/messages").json()["messages"][0]["content"] == "x" * 4000


def test_unknown_route_is_json(client):
    r = client.get("/nope")
    assert r.status_code == 404
    assert "detail" in r.json()


# ---------- real failover ----------
def test_real_failover_to_second_key(client, fake_llm):
    fake_llm.failing_keys = {"k-one"}
    m = chat(client).json()["metadata"]
    assert m["key_id"] == "key_2"
    assert m["fallback_attempts"] == 1
    assert m["resolution_source"] == "LIVE_INFERENCE"


def test_all_real_keys_fail_503_not_persisted(client, fake_llm):
    fake_llm.failing_keys = {"k-one", "k-two"}
    r = chat(client, "dead", "hello")
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}
    assert client.get("/sessions/dead/messages").status_code == 404


def test_empty_provider_reply_fails_over(client, fake_llm):
    fake_llm.reply = ""
    assert chat(client, "empty", "hello").status_code == 503


# ---------- X-Simulate-Failure ----------
@pytest.mark.parametrize("header", ["key_1=429", "key_1=500", "key_1=502", "key_1=503"])
def test_simulate_first_key(client, header):
    r = chat(client, "sim", "fresh msg " + header, headers={"X-Simulate-Failure": header})
    assert r.status_code == 200
    m = r.json()["metadata"]
    assert m["key_id"] == "key_2" and m["fallback_attempts"] == 1
    assert r.json()["reply"]


def test_simulate_all_keys_503_not_persisted(client):
    for i, header in enumerate(["*=429", "key_1=429,key_2=500"]):
        sid = f"allfail-{i}"
        r = chat(client, sid, "hello", headers={"X-Simulate-Failure": header})
        assert r.status_code == 503
        assert r.json() == {"detail": "all providers unavailable"}
        assert client.get(f"/sessions/{sid}/messages").status_code == 404


def test_simulate_is_per_request_only(client):
    chat(client, "p1", "one", headers={"X-Simulate-Failure": "key_1=429"})
    m = chat(client, "p2", "two").json()["metadata"]
    assert m["key_id"] == "key_1" and m["fallback_attempts"] == 0


def test_simulated_request_bypasses_cache_and_is_live(client):
    chat(client, "c1", "cached question")  # populates cache
    r = chat(client, "c2", "cached question", headers={"X-Simulate-Failure": "key_1=429"})
    m = r.json()["metadata"]
    assert m["resolution_source"] == "LIVE_INFERENCE"
    assert m["key_id"] == "key_2" and m["fallback_attempts"] == 1


def test_simulation_ignored_when_disabled(make_client):
    c = make_client(enable_failure_simulation=False)
    r = chat(c, "off", "hi", headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_1"


def test_simulation_garbage_header_ignored(client):
    r = chat(client, "g", "hi", headers={"X-Simulate-Failure": "junk,key_1=abc,key_1=418"})
    assert r.status_code == 200 and r.json()["metadata"]["key_id"] == "key_1"


def test_openapi_documents_simulate_failure_header(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    schema = r.json()
    post_chat = schema["paths"]["/chat"]["post"]
    params = post_chat.get("parameters", [])
    header_param = next((p for p in params if p.get("name") == "X-Simulate-Failure"), None)
    assert header_param is not None
    assert header_param["in"] == "header"
    assert "key_1=429" in header_param.get("description", "")


# ---------- CORS ----------
def test_cors_preflight(client):
    r = client.options(
        "/chat",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-simulate-failure",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


# ---------- improvements tests ----------
def test_attempts_list_for_failover(client, fake_llm):
    fake_llm.failing_keys = {"k-one"}
    r = chat(client, "failover-trace", "hello failover")
    assert r.status_code == 200
    m = r.json()["metadata"]
    assert m["key_id"] == "key_2"
    assert m["fallback_attempts"] == 1
    attempts = m["attempts"]
    assert len(attempts) == 2
    assert attempts[0] == {
        "key_id": "key_1",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "FakeProviderError 429",
    }
    assert attempts[1] == {
        "key_id": "key_2",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "ok",
    }

    # Also verify stored in SQLite history
    hist = client.get("/sessions/failover-trace/messages").json()["messages"]
    assert len(hist) == 2
    assert hist[1]["metadata"]["attempts"] == attempts

    # Also verify simulation failover
    r_sim = chat(client, "sim-trace", "hello sim", headers={"X-Simulate-Failure": "key_1=429"})
    assert r_sim.status_code == 200
    m_sim = r_sim.json()["metadata"]
    assert m_sim["attempts"][0] == {
        "key_id": "key_1",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "simulated_429",
    }
    assert m_sim["attempts"][1] == {
        "key_id": "key_2",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "ok",
    }


def test_attempts_empty_on_cache_hit(client):
    first = chat(client, "att-c1", "cache attempt test").json()
    assert first["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert first["metadata"]["attempts"] == [
        {"key_id": "key_1", "model": "gemini/gemini-2.0-flash", "outcome": "ok"}
    ]

    second = chat(client, "att-c2", "cache attempt test").json()
    assert second["metadata"]["resolution_source"] == "LLM_CACHE"
    assert second["metadata"]["attempts"] == []


def test_original_latency_ms_present_on_cache_hit(client):
    first = chat(client, "lat-c1", "unique message for original latency test").json()
    assert first["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert first["metadata"].get("original_latency_ms") is None

    second = chat(client, "lat-c2", "unique message for original latency test").json()
    assert second["metadata"]["resolution_source"] == "LLM_CACHE"
    assert isinstance(second["metadata"]["original_latency_ms"], int)
    assert second["metadata"]["original_latency_ms"] == first["metadata"]["latency_ms"]


def test_health_extra_fields(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert isinstance(body["keys_configured"], int)
    assert isinstance(body["cache_enabled"], bool)
    assert body["model"] == "gemini/gemini-2.0-flash"
    assert body["failure_simulation"] is True


def test_think_tag_stripping_live_and_cached(make_client):
    c = make_client(
        mock_response="<think>\nLet me think about this...\nStep 1... Step 2...\n</think>\n\nFinal answer here."
    )
    # Live path
    r1 = chat(c, "think-live", "question with thinking")
    assert r1.status_code == 200
    assert r1.json()["reply"] == "Final answer here."
    assert r1.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"

    # Cached path
    r2 = chat(c, "think-cached", "question with thinking")
    assert r2.status_code == 200
    assert r2.json()["reply"] == "Final answer here."
    assert r2.json()["metadata"]["resolution_source"] == "LLM_CACHE"

    # If result would be empty, keep original
    c_empty = make_client(mock_response="<think>Only internal thoughts</think>")
    r3 = chat(c_empty, "think-only", "only thoughts question")
    assert r3.status_code == 200
    assert r3.json()["reply"] == "<think>Only internal thoughts</think>"


def test_rate_limiting_chat_429(make_client):
    c = make_client(rate_limit_per_minute=2)
    r1 = chat(c, "rl-1", "m1")
    assert r1.status_code == 200
    r2 = chat(c, "rl-2", "m2")
    assert r2.status_code == 200

    r3 = chat(c, "rl-3", "m3")
    assert r3.status_code == 429
    assert r3.json() == {"detail": "rate limit exceeded"}
    assert "Retry-After" in r3.headers
    assert int(r3.headers["Retry-After"]) >= 1

    # /health and history are exempt
    assert c.get("/health").status_code == 200
    assert c.get("/sessions/rl-1/messages").status_code == 200

    # Different IP via X-Forwarded-For is not blocked
    r_other = chat(c, "rl-4", "m4", headers={"X-Forwarded-For": "198.51.100.1"})
    assert r_other.status_code == 200


def test_request_body_size_413(make_client):
    c = make_client(max_body_bytes=80)
    # With Content-Length exceeding limit
    big = {"session_id": "large-session", "message": "a" * 100}
    r = c.post("/chat", json=big)
    assert r.status_code == 413
    assert r.json() == {"detail": "request too large"}

    # Missing Content-Length guard (chunked)
    import json as _json

    r_chunked = c.post(
        "/chat",
        content=_json.dumps(big),
        headers={"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
    )
    assert r_chunked.status_code == 413
    assert r_chunked.json() == {"detail": "request too large"}


def test_security_headers_and_request_id(client):
    import uuid as _uuid

    for r in [client.get("/health"), chat(client, "sec-id", "header check")]:
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["Referrer-Policy"] == "no-referrer"
        req_id = r.headers.get("X-Request-ID")
        assert req_id is not None
        assert len(_uuid.UUID(hex=req_id).hex) == 32


def test_security_keys_never_logged_or_returned(client, fake_llm, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    fake_llm.failing_keys = {"k-one"}

    # Run failover request
    r = chat(client, "sec-keys-session", "test keys security")
    assert r.status_code == 200

    # Induce simulated error
    r_sim = chat(client, "sec-sim", "test keys in sim", headers={"X-Simulate-Failure": "key_1=429"})
    assert r_sim.status_code == 200

    # Check response text
    for key in ("k-one", "k-two"):
        assert key not in r.text
        assert key not in r_sim.text
        assert key not in caplog.text


def test_security_cors_origin_restriction(client):
    # Allowed origin
    r_allowed = client.options(
        "/chat",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r_allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"

    # Disallowed origin
    r_disallowed = client.options(
        "/chat",
        headers={
            "Origin": "https://attacker.evil.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r_disallowed.headers.get("access-control-allow-origin") != "https://attacker.evil.com"


# ---------- multi-model failover ----------
def test_config_fallback_models_parsing(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("LLM_FALLBACK_MODELS", "groq/llama-3.3-70b-versatile, openai/gpt-4o-mini")
    s = Settings.from_env()
    assert s.fallback_models == ("groq/llama-3.3-70b-versatile", "openai/gpt-4o-mini")

    monkeypatch.delenv("LLM_FALLBACK_MODELS", raising=False)
    s_default = Settings.from_env()
    assert s_default.fallback_models == ()


def test_fallback_model_answers_when_primary_fails(make_client, fake_llm):
    c = make_client(fallback_models=("groq/llama-3.3-70b-versatile",))
    fake_llm.failing_models = {"gemini/gemini-2.0-flash"}
    r = chat(c, "mm-1", "test multi-model")
    assert r.status_code == 200
    data = r.json()
    m = data["metadata"]
    assert m["model"] == "groq/llama-3.3-70b-versatile"
    assert m["key_id"] == "key_1"
    assert m["fallback_attempts"] == 2
    assert len(m["attempts"]) == 3
    assert m["attempts"][0] == {
        "key_id": "key_1",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "FakeProviderError 429",
    }
    assert m["attempts"][1] == {
        "key_id": "key_2",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "FakeProviderError 429",
    }
    assert m["attempts"][2] == {
        "key_id": "key_1",
        "model": "groq/llama-3.3-70b-versatile",
        "outcome": "ok",
    }


def test_multi_model_all_fail_503(make_client, fake_llm):
    c = make_client(fallback_models=("groq/llama-3.3-70b-versatile",))
    fake_llm.failing_models = {"gemini/gemini-2.0-flash", "groq/llama-3.3-70b-versatile"}
    r = chat(c, "mm-fail", "all models fail")
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}
    assert c.get("/sessions/mm-fail/messages").status_code == 404


def test_default_behavior_unchanged_without_fallbacks(make_client, fake_llm):
    c = make_client()  # fallback_models empty
    fake_llm.failing_models = {"gemini/gemini-2.0-flash"}
    r = chat(c, "mm-none", "no fallback configured")
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}


def test_cache_separation_across_different_models(make_client):
    # Two clients with different models answering the exact same prompt
    c_primary = make_client(model="gemini/gemini-2.0-flash")
    c_fallback = make_client(model="groq/llama-3.3-70b-versatile")

    r1 = chat(c_primary, "s-alpha-1", "shared prompt").json()
    assert r1["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert r1["metadata"]["model"] == "gemini/gemini-2.0-flash"

    # Same prompt to different model must NOT hit first model's cache
    r2 = chat(c_fallback, "s-beta-1", "shared prompt").json()
    assert r2["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert r2["metadata"]["model"] == "groq/llama-3.3-70b-versatile"

    # Subsequent call to primary model hits primary model's cache
    r3 = chat(c_primary, "s-alpha-2", "shared prompt").json()
    assert r3["metadata"]["resolution_source"] == "LLM_CACHE"
    assert r3["metadata"]["model"] == "gemini/gemini-2.0-flash"

    # Subsequent call to fallback model hits fallback model's cache
    r4 = chat(c_fallback, "s-beta-2", "shared prompt").json()
    assert r4["metadata"]["resolution_source"] == "LLM_CACHE"
    assert r4["metadata"]["model"] == "groq/llama-3.3-70b-versatile"


def test_simulation_applies_across_all_models(make_client, fake_llm):
    c = make_client(fallback_models=("groq/llama-3.3-70b-versatile",), enable_failure_simulation=True)
    # *=429 simulates failure for all keys across all models -> 503
    r = chat(c, "sim-all-models", "hello", headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}

    # key_1=429 with fake_llm failing model 1:
    # Model 1 key 1 -> simulated 429
    # Model 1 key 2 -> FakeProviderError 429
    # Model 2 key 1 -> simulated 429
    # Model 2 key 2 -> ok!
    fake_llm.failing_models = {"gemini/gemini-2.0-flash"}
    fake_llm.failing_keys = set()
    r2 = chat(c, "sim-key1-models", "hello", headers={"X-Simulate-Failure": "key_1=429"})
    assert r2.status_code == 200
    m2 = r2.json()["metadata"]
    assert m2["model"] == "groq/llama-3.3-70b-versatile"
    assert m2["key_id"] == "key_2"
    assert m2["fallback_attempts"] == 3
    assert m2["attempts"][0] == {
        "key_id": "key_1",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "simulated_429",
    }
    assert m2["attempts"][1] == {
        "key_id": "key_2",
        "model": "gemini/gemini-2.0-flash",
        "outcome": "failed",
        "reason": "FakeProviderError 429",
    }
    assert m2["attempts"][2] == {
        "key_id": "key_1",
        "model": "groq/llama-3.3-70b-versatile",
        "outcome": "failed",
        "reason": "simulated_429",
    }
    assert m2["attempts"][3] == {
        "key_id": "key_2",
        "model": "groq/llama-3.3-70b-versatile",
        "outcome": "ok",
    }


