# syntax=docker/dockerfile:1

# ---------- Stage 1: build the virtualenv ----------
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements.txt .
RUN pip install -r requirements.txt

# ---------- Stage 2: small runtime image ----------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LITELLM_LOCAL_MODEL_COST_MAP=True \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8000

# Non-root user. /data is created and owned by it, so the named volume
# mounted there inherits the right permissions on first use.
RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /data \
    && chown app:app /data

WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY app ./app

USER app
EXPOSE 8000
VOLUME ["/data"]

# PORT is configurable (cloud hosts inject their own).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
