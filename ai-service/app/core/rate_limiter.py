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
            if not redis_client:
                return

            client_id = request.headers.get("X-User-ID") or request.client.host
            key = f"ai:ratelimit:{client_id}"

            try:
                # Increment the counter for this client
                count = await redis_client.incr(key)
                
                # If this is the first request in the window, set expiration
                if count == 1:
                    await redis_client.expire(key, 60)

                # If the client has already reached the limit, reject the request
                if count > self.requests_per_minute:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="AI request rate limit exceeded. Please wait before retrying.",
                        headers={"Retry-After": "60"},
                    )
            except HTTPException:
                # Re-raise the rate limit exception so it correctly blocks the user with a 429
                raise
            except Exception as e:
                # If Redis connection fails, log the error and gracefully bypass the rate limit
                print(f"Warning: Redis rate limiter connection failed: {e}")
                return

# Maintain the exact same exported instance name so endpoints continue working without changes
ai_rate_limiter = RateLimiter()