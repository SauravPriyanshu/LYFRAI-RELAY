#!/usr/bin/env python3
"""Contract Audit Script (Python Standard Library only).

Verifies every status code, required field, and header behavior from
.github/copilot-instructions.md against a running backend instance.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
import uuid

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RESET = "\033[0m"


def log_pass(msg: str):
    print(f"{GREEN}[PASS]{RESET} {msg}")


def log_fail(msg: str):
    print(f"{RED}[FAIL]{RESET} {msg}")


def log_info(msg: str):
    print(f"{YELLOW}[INFO]{RESET} {msg}")


class AuditRunner:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.passed = 0
        self.failed = 0

    def assert_true(self, condition: bool, description: str):
        if condition:
            log_pass(description)
            self.passed += 1
        else:
            log_fail(description)
            self.failed += 1

    def request(
        self,
        method: str,
        path: str,
        data: dict | bytes | None = None,
        headers: dict | None = None,
    ) -> tuple[int, dict | str, dict]:
        url = f"{self.base_url}{path}"
        req_headers = headers or {}
        body_bytes = None

        if isinstance(data, dict):
            body_bytes = json.dumps(data).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        elif isinstance(data, bytes):
            body_bytes = data

        req = urllib.request.Request(url, data=body_bytes, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read().decode("utf-8")
                resp_headers = dict(resp.headers)
                try:
                    parsed = json.loads(resp_body)
                except Exception:
                    parsed = resp_body
                return resp.status, parsed, resp_headers
        except urllib.error.HTTPError as exc:
            resp_body = exc.read().decode("utf-8")
            resp_headers = dict(exc.headers)
            try:
                parsed = json.loads(resp_body)
            except Exception:
                parsed = resp_body
            return exc.code, parsed, resp_headers
        except Exception as exc:
            return 0, str(exc), {}

    def run_all(self) -> bool:
        log_info(f"Auditing backend contract at {self.base_url} ...")

        # 1. GET /health
        status, body, headers = self.request("GET", "/health")
        self.assert_true(status == 200, "GET /health returns 200 OK")
        self.assert_true(isinstance(body, dict), "GET /health returns a JSON object")
        self.assert_true(body.get("status") == "ok", "GET /health 'status' is exactly 'ok'")
        self.assert_true(isinstance(body.get("keys_configured"), int) and body.get("keys_configured") > 0, "GET /health 'keys_configured' is positive int")
        self.assert_true(isinstance(body.get("cache_enabled"), bool), "GET /health 'cache_enabled' is bool")
        h_lower = {k.lower(): v for k, v in headers.items()}
        self.assert_true(h_lower.get("x-content-type-options", "").lower() == "nosniff", "GET /health includes X-Content-Type-Options: nosniff")
        self.assert_true(h_lower.get("referrer-policy", "").lower() == "no-referrer", "GET /health includes Referrer-Policy: no-referrer")
        self.assert_true(bool(h_lower.get("x-request-id")), "GET /health includes X-Request-ID header")

        sim_enabled = bool(body.get("failure_simulation"))

        # 2. POST /chat (Live inference contract)
        session_id = f"audit-{uuid.uuid4().hex[:12]}"
        chat_payload = {
            "session_id": session_id,
            "message": "Hello from contract audit. What is 2 + 2?",
            "system_prompt": "You are a concise mathematician.",
        }
        status, body, headers = self.request("POST", "/chat", data=chat_payload)
        self.assert_true(status == 200, "POST /chat returns 200 OK")
        self.assert_true(body.get("session_id") == session_id, "POST /chat echoes exact session_id")
        self.assert_true(bool(body.get("reply")) and isinstance(body.get("reply"), str), "POST /chat reply is non-empty string")

        meta = body.get("metadata", {})
        self.assert_true(isinstance(meta, dict), "POST /chat includes 'metadata' dict")
        self.assert_true(meta.get("resolution_source") in ("LIVE_INFERENCE", "LLM_CACHE"), "metadata.resolution_source is 'LIVE_INFERENCE' or 'LLM_CACHE'")
        self.assert_true(isinstance(meta.get("model"), str) and bool(meta.get("model")), "metadata.model is non-empty string")
        self.assert_true(isinstance(meta.get("latency_ms"), int) and meta.get("latency_ms") >= 0, "metadata.latency_ms is int >= 0")
        self.assert_true(isinstance(meta.get("input_tokens"), int) and meta.get("input_tokens") >= 0, "metadata.input_tokens is int >= 0")
        self.assert_true(isinstance(meta.get("output_tokens"), int) and meta.get("output_tokens") >= 0, "metadata.output_tokens is int >= 0")
        self.assert_true(meta.get("key_id") is None or (isinstance(meta.get("key_id"), str) and meta.get("key_id").startswith("key_")), "metadata.key_id is 'key_N' or null")
        self.assert_true(isinstance(meta.get("fallback_attempts"), int) and meta.get("fallback_attempts") >= 0, "metadata.fallback_attempts is int >= 0")
        self.assert_true("session_tokens" not in meta and "total_tokens" not in meta, "Tokens are per request only; NO session/total token sums returned")

        # 3. Cache behavior
        session_id_cache = f"audit-cache-{uuid.uuid4().hex[:12]}"
        status2, body2, _ = self.request("POST", "/chat", data={
            "session_id": session_id_cache,
            "message": "Hello from contract audit. What is 2 + 2?",
            "system_prompt": "You are a concise mathematician.",
        })
        self.assert_true(status2 == 200, "POST /chat cached request returns 200 OK")
        meta2 = body2.get("metadata", {})
        if body.get("cache_enabled", True):
            self.assert_true(meta2.get("resolution_source") == "LLM_CACHE", "Repeated prompt yields resolution_source == 'LLM_CACHE'")
            self.assert_true(meta2.get("key_id") is None, "Cache hit has key_id == null")
            self.assert_true(meta2.get("fallback_attempts") == 0, "Cache hit has fallback_attempts == 0")

        # 4. GET /sessions/{id}/messages
        status, body, _ = self.request("GET", f"/sessions/{session_id}/messages")
        self.assert_true(status == 200, "GET /sessions/{id}/messages returns 200 OK for known session")
        self.assert_true(body.get("session_id") == session_id, "GET /sessions/{id}/messages echoes session_id")
        msgs = body.get("messages", [])
        self.assert_true(isinstance(msgs, list) and len(msgs) >= 2, "History returns messages list [user, assistant, ...]")
        self.assert_true(all(m.get("role") in ("user", "assistant") for m in msgs), "History messages only contain 'user' and 'assistant' roles (system prompt hidden)")
        self.assert_true("concise mathematician" not in json.dumps(msgs), "System prompt is NEVER exposed in GET /sessions/{id}/messages")

        # 5. Unknown session -> 404
        unknown_id = f"unknown-{uuid.uuid4().hex}"
        status, body, _ = self.request("GET", f"/sessions/{unknown_id}/messages")
        self.assert_true(status == 404, "GET /sessions/{unknown}/messages returns 404")
        self.assert_true(body.get("detail") == "session not found", "404 detail is exactly 'session not found'")

        # 6. Validation errors (422)
        invalid_cases = [
            ({"session_id": "s", "message": ""}, "empty message"),
            ({"session_id": "s", "message": "   \n\t "}, "whitespace message"),
            ({"session_id": "s", "message": "a" * 4001}, "message > 4000 chars"),
            ({"session_id": "", "message": "valid"}, "empty session_id"),
            ({"session_id": "x" * 129, "message": "valid"}, "session_id > 128 chars"),
        ]
        for payload, label in invalid_cases:
            st, b, _ = self.request("POST", "/chat", data=payload)
            self.assert_true(st == 422, f"Validation failure for {label} returns 422")
            self.assert_true("detail" in b, f"422 for {label} contains 'detail'")

        # Malformed JSON -> 422
        st, b, _ = self.request("POST", "/chat", data=b"{malformed json", headers={"Content-Type": "application/json"})
        self.assert_true(st == 422, "Malformed JSON body returns 422 with detail")
        self.assert_true("detail" in b, "Malformed JSON body response contains 'detail'")

        # Failed requests are never saved to history
        failed_sid = f"failed-val-{uuid.uuid4().hex[:8]}"
        self.request("POST", "/chat", data={"session_id": failed_sid, "message": ""})
        st_check, _, _ = self.request("GET", f"/sessions/{failed_sid}/messages")
        self.assert_true(st_check == 404, "Failed validation request is never saved to SQLite history")

        # 7. Endpoint lockdown (exactly three endpoints)
        st, b, _ = self.request("GET", "/not-a-real-endpoint")
        self.assert_true(st == 404 and "detail" in b, "Unknown route returns 404 JSON with 'detail'")

        # 8. Body size guard (413)
        big_body = json.dumps({"session_id": "big", "message": "a" * 70000}).encode("utf-8")
        st, b, _ = self.request("POST", "/chat", data=big_body, headers={"Content-Type": "application/json"})
        self.assert_true(st == 413 and b.get("detail") == "request too large", "Oversized request body returns 413 'request too large'")

        # 9. Failure simulation (if enabled)
        if sim_enabled:
            sim_sid = f"sim-{uuid.uuid4().hex[:8]}"
            st, b, _ = self.request("POST", "/chat", data={"session_id": sim_sid, "message": "hi"}, headers={"X-Simulate-Failure": "*=429"})
            self.assert_true(st == 503, "X-Simulate-Failure: *=429 returns 503")
            self.assert_true(b.get("detail") == "all providers unavailable", "503 detail is exactly 'all providers unavailable'")
            st_hist, _, _ = self.request("GET", f"/sessions/{sim_sid}/messages")
            self.assert_true(st_hist == 404, "Failed 503 simulated request is never saved to history")

            # One-shot check: next request without header succeeds
            st_next, b_next, _ = self.request("POST", "/chat", data={"session_id": sim_sid, "message": "hi second time"})
            self.assert_true(st_next == 200, "Subsequent request after simulation succeeds (simulation is per-request one-shot)")

        print("-" * 60)
        print(f"Contract Audit Finished: {self.passed} passed, {self.failed} failed.")
        return self.failed == 0


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    runner = AuditRunner(url)
    success = runner.run_all()
    sys.exit(0 if success else 1)
