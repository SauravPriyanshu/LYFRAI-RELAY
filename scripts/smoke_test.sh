#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
echo "==> Running smoke tests against $BASE_URL"

# 1. Health check
echo -n "[1/6] GET /health ... "
HEALTH=$(curl -sS "$BASE_URL/health")
echo "$HEALTH" | grep -q '"status":"ok"' || { echo "FAILED"; echo "$HEALTH"; exit 1; }
echo "$HEALTH" | grep -q '"keys_configured"' || { echo "FAILED"; echo "$HEALTH"; exit 1; }
echo "$HEALTH" | grep -q '"cache_enabled"' || { echo "FAILED"; echo "$HEALTH"; exit 1; }
echo "OK"

# 2. Live chat
echo -n "[2/6] POST /chat (live inference) ... "
SESSION_ID="smoke-$(date +%s)-$RANDOM"
CHAT1=$(curl -sS -X POST "$BASE_URL/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"message\":\"Hello smoke test\"}")
echo "$CHAT1" | grep -q '"session_id":"'"$SESSION_ID"'"' || { echo "FAILED"; echo "$CHAT1"; exit 1; }
echo "$CHAT1" | grep -q '"resolution_source":"LIVE_INFERENCE"' || { echo "FAILED"; echo "$CHAT1"; exit 1; }
echo "$CHAT1" | grep -q '"reply"' || { echo "FAILED"; echo "$CHAT1"; exit 1; }
echo "OK"

# 3. Cache hit
echo -n "[3/6] POST /chat (cache hit) ... "
SESSION_ID2="smoke-cache-$(date +%s)-$RANDOM"
CHAT2=$(curl -sS -X POST "$BASE_URL/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID2\",\"message\":\"Hello smoke test\"}")
echo "$CHAT2" | grep -q '"resolution_source":"LLM_CACHE"' || { echo "FAILED"; echo "$CHAT2"; exit 1; }
echo "OK"

# 4. History endpoint
echo -n "[4/6] GET /sessions/{id}/messages ... "
HIST=$(curl -sS "$BASE_URL/sessions/$SESSION_ID/messages")
echo "$HIST" | grep -q '"session_id":"'"$SESSION_ID"'"' || { echo "FAILED"; echo "$HIST"; exit 1; }
echo "$HIST" | grep -q '"messages"' || { echo "FAILED"; echo "$HIST"; exit 1; }
echo "OK"

# 5. History 404 for unknown session
echo -n "[5/6] GET /sessions/unknown-session/messages (404) ... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/sessions/nonexistent-session-$RANDOM/messages")
[ "$HTTP_CODE" -eq 404 ] || { echo "FAILED (HTTP $HTTP_CODE)"; exit 1; }
echo "OK"

# 6. Validation error 422
echo -n "[6/6] POST /chat validation 422 ... "
HTTP_CODE_VAL=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/chat" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"val\",\"message\":\"   \"}")
[ "$HTTP_CODE_VAL" -eq 422 ] || { echo "FAILED (HTTP $HTTP_CODE_VAL)"; exit 1; }
echo "OK"

echo "==> All smoke tests passed successfully!"
