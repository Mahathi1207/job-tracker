"""
API Gateway — single entry point for all client traffic.
Responsibilities:
  • Routes requests to the correct downstream microservice
  • Enforces rate limiting (100 req/min per IP) via Redis sliding window
  • Checks that JWT Authorization header is present on protected routes
  • Exposes GET /health that pings every downstream service
"""
import os
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import redis.asyncio as aioredis
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8001")
JOB_SERVICE_URL = os.getenv("JOB_SERVICE_URL", "http://job-service:8002")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:8003")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8004")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

RATE_LIMIT = 100   # max requests
RATE_WINDOW = 60   # per this many seconds

redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    await redis_client.aclose()


app = FastAPI(
    title="API Gateway",
    description="Reverse proxy with rate limiting for all Job Tracker microservices.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Rate limiting ─────────────────────────────────────────────
async def check_rate_limit(client_ip: str):
    """
    Sliding-window counter stored in Redis.
    First request in a window sets a TTL; subsequent ones increment.
    429 is raised when the counter exceeds RATE_LIMIT.
    """
    if redis_client is None:
        return  # Redis unavailable → skip limiting rather than blocking everyone

    key = f"rl:{client_ip}"
    count = await redis_client.incr(key)
    if count == 1:
        # Start the window on first request
        await redis_client.expire(key, RATE_WINDOW)
    if count > RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: {RATE_LIMIT} requests per {RATE_WINDOW}s",
        )


def require_auth(request: Request):
    """Raise 401 if the Authorization header is missing."""
    if "authorization" not in request.headers:
        raise HTTPException(status_code=401, detail="Authorization header required")


# ── Proxy helper ──────────────────────────────────────────────
async def proxy(request: Request, target_url: str) -> Response:
    """
    Forwards the incoming HTTP request verbatim to target_url,
    returns the downstream response back to the client.
    Strips the Host header to avoid confusing downstream services.
    """
    client_ip = request.client.host if request.client else "unknown"
    await check_rate_limit(client_ip)

    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                params=request.query_params,
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Upstream unavailable: {e}")

    # Forward response headers except transfer-encoding (handled by FastAPI)
    response_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower() not in ("transfer-encoding", "content-encoding")
    }
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
        media_type=resp.headers.get("content-type"),
    )


# ── Health ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """Pings all downstream services and aggregates their health status."""
    services = {
        "auth-service": AUTH_SERVICE_URL,
        "job-service": JOB_SERVICE_URL,
        "ai-service": AI_SERVICE_URL,
        "notification-service": NOTIFICATION_SERVICE_URL,
    }
    results: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=5.0) as client:
        for name, url in services.items():
            try:
                resp = await client.get(f"{url}/health")
                results[name] = "ok" if resp.status_code == 200 else "degraded"
            except httpx.RequestError:
                results[name] = "unreachable"

    overall = "ok" if all(v == "ok" for v in results.values()) else "degraded"
    return {"status": overall, "services": results}


# ── /auth/* → auth-service (public) ──────────────────────────
@app.api_route("/auth{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def auth_proxy(path: str, request: Request):
    return await proxy(request, f"{AUTH_SERVICE_URL}/auth{path}")


# ── /jobs/* → job-service (JWT required) ─────────────────────
@app.api_route("/jobs{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def jobs_proxy(path: str, request: Request):
    require_auth(request)
    return await proxy(request, f"{JOB_SERVICE_URL}/jobs{path}")


# ── /ai/* → ai-service (JWT required) ────────────────────────
@app.api_route("/ai{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def ai_proxy(path: str, request: Request):
    require_auth(request)
    return await proxy(request, f"{AI_SERVICE_URL}/ai{path}")


# ── /resumes/* → job-service (JWT required) ──────────────────
@app.api_route("/resumes{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def resumes_proxy(path: str, request: Request):
    require_auth(request)
    return await proxy(request, f"{JOB_SERVICE_URL}/resumes{path}")


# ── /notifications/* → notification-service ──────────────────
@app.api_route(
    "/notifications{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"]
)
async def notifications_proxy(path: str, request: Request):
    return await proxy(request, f"{NOTIFICATION_SERVICE_URL}/notifications{path}")
