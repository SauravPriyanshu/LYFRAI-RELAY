import os

# Avoid a network fetch of the model-cost map and telemetry at startup (must be set before any litellm import).
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_TELEMETRY", "False")

import asyncio
import collections
import logging
import math
import time
import uuid
import weakref
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .db import Database
from .errors import AllProvidersUnavailable
from .llm_service import LLMService, compute_cache_key, parse_failure_header
from .schemas import ChatRequest, ChatResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("app")


class RateLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self.limit = limit_per_minute
        self.requests: dict[str, collections.deque[float]] = {}
        self.window = 60.0

    def check_and_record(self, ip: str, now: Optional[float] = None) -> tuple[bool, int]:
        if self.limit <= 0:
            return True, 0
        now = now if now is not None else time.time()
        cutoff = now - self.window

        if len(self.requests) > 1000:
            to_del = [k for k, v in self.requests.items() if not v or v[-1] < cutoff]
            for k in to_del:
                del self.requests[k]

        q = self.requests.get(ip)
        if q is None:
            q = collections.deque()
            self.requests[ip] = q

        while q and q[0] <= cutoff:
            q.popleft()

        if len(q) >= self.limit:
            oldest = q[0]
            retry_after = max(1, int(math.ceil(oldest + self.window - now)))
            return False, retry_after

        q.append(now)
        return True, 0


class HardeningASGIMiddleware:
    def __init__(self, app, settings: Settings, rate_limiter: RateLimiter) -> None:
        self.app = app
        self.settings = settings
        self.rate_limiter = rate_limiter

    def _get_client_ip(self, scope) -> str:
        headers_dict = dict(scope.get("headers", []))
        xff = headers_dict.get(b"x-forwarded-for")
        if xff:
            return xff.decode("latin-1").split(",")[0].strip()
        client = scope.get("client")
        if client and len(client) > 0 and client[0]:
            return str(client[0])
        return "127.0.0.1"

    async def _send_response(self, response, scope, receive, send, request_id: str):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Request-ID"] = request_id
        await response(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        request_id = uuid.uuid4().hex
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        max_bytes = self.settings.max_body_bytes
        headers_dict = dict(scope.get("headers", []))
        cl_str = headers_dict.get(b"content-length")
        if cl_str is not None:
            try:
                if int(cl_str.decode("latin-1")) > max_bytes:
                    res = JSONResponse(status_code=413, content={"detail": "request too large"})
                    return await self._send_response(res, scope, receive, send, request_id)
            except ValueError:
                pass

        # Rate limiting for POST /chat only
        path = scope.get("path", "")
        method = scope.get("method", "")
        if method == "POST" and path == "/chat":
            ip = self._get_client_ip(scope)
            allowed, retry_after = self.rate_limiter.check_and_record(ip)
            if not allowed:
                res = JSONResponse(
                    status_code=429,
                    content={"detail": "rate limit exceeded"},
                    headers={"Retry-After": str(retry_after)},
                )
                return await self._send_response(res, scope, receive, send, request_id)

        total = 0

        async def custom_receive():
            nonlocal total
            message = await receive()
            if message.get("type") == "http.request":
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError("request too large")
            return message

        async def custom_send(message):
            if message.get("type") == "http.response.start":
                h = list(message.get("headers", []))
                h.append((b"x-content-type-options", b"nosniff"))
                h.append((b"referrer-policy", b"no-referrer"))
                h.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = h
            await send(message)

        try:
            await self.app(scope, custom_receive, custom_send)
        except ValueError as exc:
            if str(exc) == "request too large":
                res = JSONResponse(status_code=413, content={"detail": "request too large"})
                await self._send_response(res, scope, receive, send, request_id)
            else:
                raise


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = Database(settings.db_path)
    llm = LLMService(settings)
    locks: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()
    rate_limiter = RateLimiter(settings.rate_limit_per_minute)

    def session_lock(session_id: str) -> asyncio.Lock:
        lock = locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            locks[session_id] = lock
        return lock

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await asyncio.to_thread(db.init)
        logger.info("Started: keys=%d cache=%s", len(llm.keys), llm.cache_enabled)
        yield

    app = FastAPI(title="Lyftr Chat API", lifespan=lifespan)
    app.add_middleware(HardeningASGIMiddleware, settings=settings, rate_limiter=rate_limiter)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError):
        detail = [
            {
                "loc": [str(p) for p in err.get("loc", [])],
                "msg": str(err.get("msg", "invalid input")),
                "type": str(err.get("type", "value_error")),
            }
            for err in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.exception_handler(Exception)
    async def unhandled_handler(_request: Request, exc: Exception):
        logger.error("Unhandled error: %s", type(exc).__name__)
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

    @app.get("/health")
    async def health():
        try:
            await asyncio.to_thread(db.ping)
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=503, detail="database unavailable")
        if not llm.keys:
            raise HTTPException(status_code=503, detail="no api keys configured")
        return {
            "status": "ok",
            "keys_configured": len(llm.keys),
            "cache_enabled": llm.cache_enabled,
            "model": settings.model,
            "failure_simulation": settings.enable_failure_simulation,
        }

    @app.post("/chat", response_model=ChatResponse)
    async def chat(
        payload: ChatRequest,
        request: Request,
        x_simulate_failure: Optional[str] = Header(
            default=None,
            alias="X-Simulate-Failure",
            description="Test hook, e.g. key_1=429 or *=429. Only active when ENABLE_FAILURE_SIMULATION=true",
        ),
    ):
        started = time.perf_counter()
        simulate = {}
        if settings.enable_failure_simulation:
            simulate = parse_failure_header(x_simulate_failure)
        sid = payload.session_id
        try:
            async with session_lock(sid):
                ctx = await asyncio.to_thread(db.load_context, sid, settings.max_history_messages)
                system_prompt = payload.system_prompt or ctx["system_prompt"] or settings.default_system_prompt
                messages = (
                    [{"role": "system", "content": system_prompt}]
                    + ctx["history"]
                    + [{"role": "user", "content": payload.message}]
                )
                result = await llm.complete(messages, simulate)
                latency_ms = max(1, int((time.perf_counter() - started) * 1000))
                original_latency_ms = None
                cache_key = compute_cache_key(result.model, messages)
                if result.resolution_source == "LIVE_INFERENCE":
                    llm.latency_cache.set(cache_key, latency_ms)
                elif result.resolution_source == "LLM_CACHE":
                    original_latency_ms = llm.latency_cache.get(cache_key)

                metadata = {
                    "resolution_source": result.resolution_source,
                    "model": result.model,
                    "latency_ms": latency_ms,
                    "input_tokens": result.input_tokens,
                    "output_tokens": result.output_tokens,
                    "key_id": result.key_id,
                    "fallback_attempts": result.fallback_attempts,
                    "attempts": result.attempts,
                    "original_latency_ms": original_latency_ms,
                }
                await asyncio.to_thread(
                    db.save_exchange, sid, payload.system_prompt, payload.message, result.reply, metadata
                )
                req_id = getattr(request.state, "request_id", None) or uuid.uuid4().hex
                logger.info(
                    "chat [%s] sid=%s source=%s latency_ms=%d",
                    req_id,
                    sid,
                    result.resolution_source,
                    latency_ms,
                )
        except AllProvidersUnavailable:
            raise HTTPException(status_code=503, detail="all providers unavailable")
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("chat failed: %s", type(exc).__name__)
            raise HTTPException(status_code=500, detail="internal server error")
        return {"session_id": sid, "reply": result.reply, "metadata": metadata}

    @app.get("/sessions/{session_id}/messages")
    async def get_messages(session_id: str):
        messages = await asyncio.to_thread(db.get_messages, session_id)
        if messages is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {"session_id": session_id, "messages": messages}

    return app


_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.is_file():
    load_dotenv(_backend_env)
load_dotenv()
app = create_app()
