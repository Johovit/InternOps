import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException

from app.core.rate_limiter import RateLimiter

class DummyClient:
    host = "127.0.0.1"

class DummyRequest:
    def __init__(self):
        self.headers = {}
        self.client = DummyClient()

@pytest.mark.asyncio
async def test_rate_limiter_blocks_after_limit():
    # Patch the global redis_client used by the RateLimiter
    with patch("app.core.rate_limiter.redis_client", new_callable=AsyncMock) as mock_redis:
        
        # Simulate incr returning 1, then 2, then 3 for consecutive requests
        mock_redis.incr.side_effect = [1, 2, 3]
        
        limiter = RateLimiter(requests_per_minute=2)
        request = DummyRequest()

        # First request -> allowed (count = 1)
        await limiter.check_rate_limit(request)
        # Verify expire was called on the first request
        mock_redis.expire.assert_awaited_once_with("ai:ratelimit:127.0.0.1", 60)

        # Second request -> allowed (count = 2)
        await limiter.check_rate_limit(request)

        # Third request -> blocked (count = 3)
        with pytest.raises(HTTPException) as exc_info:
            await limiter.check_rate_limit(request)
            
        assert exc_info.value.status_code == 429