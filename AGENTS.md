# Project rules (never violate)
Stack: React + Vite + TypeScript frontend (/frontend), FastAPI backend (/backend), SQLite, LiteLLM. No Redis/Postgres/external DB.

## API contract (do not rename or remove fields; extra response fields are allowed)
- GET /health -> 200 {"status":"ok","keys_configured":N,"cache_enabled":bool}
- POST /chat {session_id (1-128), message (1-4000 after trim), system_prompt?} -> 200 {session_id, reply, metadata:{resolution_source:"LIVE_INFERENCE"|"LLM_CACHE", model, latency_ms:int, input_tokens:int, output_tokens:int, key_id:"key_N"|null, fallback_attempts:int}}
- GET /sessions/{id}/messages -> oldest first, no system prompt; unknown -> 404 {"detail":"session not found"}
- Errors are always JSON with "detail". 422 validation, 503 {"detail":"all providers unavailable"}. Failed requests are never saved to history.
- The backend exposes EXACTLY these three endpoints. Never add new routes.
- X-Simulate-Failure works only when ENABLE_FAILURE_SIMULATION=true and affects that single request.
- Tokens are per request only. NEVER show or compute a conversation/session token total anywhere (UI or API).

## Frontend contract
- A NEW session id is generated on every page load.
- Required data-testid attributes must always exist, be visible (not hover-only, not inside a closed drawer), and contain exactly: chat-input (cleared after send, Enter sends), send-button, assistant-message (wraps reply + metadata), meta-source (exactly LIVE_INFERENCE or LLM_CACHE), meta-model, meta-latency (e.g. "812 ms"), meta-input-tokens (integer only), meta-output-tokens (integer only), system-prompt-input (always visible and fillable).
- Labels like "Input tokens" must sit OUTSIDE the testid element so its text is just the value.
- Errors (422, 503, network) show as readable inline messages in the chat AND a red toast. Success/info toasts are green. Never a blank screen.

## Design rules
Palette families only: grey-black, dark purple, lavender, vibe purple, violet. Fonts weights 400/500/600 only (never 700+). Respect prefers-reduced-motion. Mobile-first responsive.

## Definition of done for every task
`cd backend && python -m pytest -q` and `cd frontend && npm test && npm run build` both pass. Update or add tests for every behavior you change. Do not delete existing tests to make things pass. Never log or return API keys.
