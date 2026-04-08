"""Shared HTTP rate-limit retry wrapper for connector API calls."""
from __future__ import annotations

import asyncio
import random
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

_DEFAULT_RETRYABLE_STATUSES: set[int] = {429, 500, 502, 503, 504}


def _parse_retry_after_seconds(response: httpx.Response) -> float | None:
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        retry_after = retry_after.strip()
        if retry_after.isdigit():
            return max(0.0, float(retry_after))
        try:
            dt = parsedate_to_datetime(retry_after)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0.0, (dt - datetime.now(timezone.utc)).total_seconds())
        except Exception:
            pass

    reset_epoch = response.headers.get("X-RateLimit-Reset")
    if reset_epoch:
        try:
            return max(0.0, float(reset_epoch) - time.time())
        except Exception:
            pass

    return None


async def request_with_rate_limit(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_attempts: int = 5,
    base_delay_seconds: float = 1.0,
    max_delay_seconds: float = 30.0,
    retryable_statuses: set[int] | None = None,
    **request_kwargs: Any,
) -> httpx.Response:
    """
    Make an HTTP request with bounded retries for rate-limit/transient failures.

    Retries on:
      - HTTP 429 and common transient 5xx statuses
      - network-level httpx.RequestError exceptions
    """
    statuses = retryable_statuses or _DEFAULT_RETRYABLE_STATUSES
    delay = max(0.0, base_delay_seconds)
    last_response: httpx.Response | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.request(method, url, **request_kwargs)
            last_response = response
        except httpx.RequestError:
            if attempt >= max_attempts:
                raise
            await asyncio.sleep(min(max_delay_seconds, delay) + random.uniform(0, 0.25))
            delay = max(base_delay_seconds, delay * 2)
            continue

        if response.status_code not in statuses or attempt >= max_attempts:
            return response

        server_delay = _parse_retry_after_seconds(response)
        wait_seconds = server_delay if server_delay is not None else min(max_delay_seconds, delay)
        await asyncio.sleep(wait_seconds + random.uniform(0, 0.25))
        delay = max(base_delay_seconds, delay * 2)

    # Loop only exits here if max_attempts == 0; keep return type strict.
    if last_response is not None:
        return last_response
    raise RuntimeError("request_with_rate_limit did not perform a request")

