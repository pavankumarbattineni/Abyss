# syntax=docker/dockerfile:1
# Abyss backend: FastAPI + LangGraph on Python 3.13, dependencies from uv.lock.
# Stage 1 installs dependencies; stage 2 is the slim image that runs.

# ============================================================================
# Stage 1: builder (dependencies into /app/.venv)
# ============================================================================
FROM python:3.13-slim AS builder

# uv from its official image (same version as local development).
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

# Precompile .pyc (faster start); copy files out of uv's cache so the venv is
# self-contained; use this image's Python, never download another.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Only the lockfiles first, so this slow layer is cached until dependencies
# change. --frozen: exactly uv.lock; --no-dev: no pytest/ruff;
# --no-install-project: the backend isn't an installable package.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ============================================================================
# Stage 2: runtime
# ============================================================================
FROM python:3.13-slim AS runtime

# Venv first on PATH; unbuffered logs (live `docker logs`); no .pyc writes
# (the code is read-only for the app user). Render overrides PORT.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Debian security updates since the base image was built; remove pip (never
# used at runtime, and it bundles old copies of urllib3 etc. that image
# scanners flag); an unprivileged "app" user to run the server.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && python -m pip uninstall -y pip \
 && groupadd --system app && useradd --system --gid app --no-create-home app

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
# Application code last (changes most often). .dockerignore keeps secrets,
# tests and local caches out.
COPY . .

USER app
EXPOSE 8000

# Healthy = /health answers 200 (it also checks the database). No curl in the
# image, so Python's urllib. Startup runs migrations, hence the grace period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"]

# exec: uvicorn becomes PID 1 and gets Docker's stop signal (clean shutdown).
# 0.0.0.0: reachable from outside the container. --proxy-headers: trust the
# HTTPS proxy in front (Render) for the real scheme and client IP.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
