import logging
import time
import uuid
from typing import Dict, List, Optional

import redis.asyncio as redis
from fastapi import Depends, HTTPException, Request, status

from app.core.auth import User, get_current_user
from app.core.config import settings, RATE_LIMIT_PER_MINUTE

logger = logging.getLogger(__name__)

# Initialize a global Redis client.
# This will be shared across requests in this worker.
redis_client = redis.from_url(settings.REDIS_URL) if settings.REDIS_URL else None

class RateLimiter:
    """Redis-backed fixed-window rate limiter."""

    def __init__(self, requests_per_minute: int = RATE_LIMIT_PER_MINUTE):
        self.requests_per_minute = requests_per_minute

    async def check_rate_limit(
        self,
        request: Request,
        current_user: User = Depends(get_current_user),
    ):
        if not redis_client:
            return

        # Uses the verified user_id from the JWT (injected via Depends) 
        # to prevent X-User-ID header spoofing
        client_id = current_user.id if isinstance(current_user, User) else (
            request.client.host if (request and getattr(request, "client", None)) else "unknown"
        )
        
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
            # Re-raise the rate limit exception so it correctly blocks the user
            raise
        except Exception as e:
            # If Redis connection fails, log the error properly instead of printing,
            # and gracefully bypass the rate limit (fail open).
            logger.warning("Redis rate limiter connection failed: %s", e)
            return

# Maintain the exact same exported instance name so endpoints continue working without changes
ai_rate_limiter = RateLimiter()