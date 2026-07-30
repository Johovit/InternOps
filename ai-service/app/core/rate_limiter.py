from fastapi import HTTPException, Request, status
import redis.asyncio as redis
from app.core.config import RATE_LIMIT_PER_MINUTE, REDIS_URL

# Initialize a global Redis client.
# This will be shared across requests in this worker.
redis_client = redis.from_url(REDIS_URL) if REDIS_URL else None

class RateLimiter:
    """Redis-backed rate limiter."""

    def __init__(self, requests_per_minute: int = RATE_LIMIT_PER_MINUTE):
        self.requests_per_minute = requests_per_minute

    async def check_rate_limit(self, request: Request):
        # If Redis isn't configured, we might want to bypass or raise an error.
        # Assuming for production, REDIS_URL is strictly provided.
        if not redis_client:
            return

        # Identify the client (User ID header or IP address)
        client_id = request.headers.get("X-User-ID") or request.client.host
        key = f"ai:ratelimit:{client_id}"

        # Increment the counter for this client
        count = await redis_client.incr(key)
        
        # If this is the first request in the window, set the expiration to 60 seconds
        if count == 1:
            await redis_client.expire(key, 60)

        # If the client has already reached the limit, reject the request
        if count > self.requests_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="AI request rate limit exceeded. Please wait before retrying.",
                headers={"Retry-After": "60"},
            )

# Maintain the exact same exported instance name so endpoints continue working without changes
ai_rate_limiter = RateLimiter()