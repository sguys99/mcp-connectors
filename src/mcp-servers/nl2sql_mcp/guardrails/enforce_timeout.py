"""가드레일 7.4 — 쿼리 타임아웃 실행 래퍼.

asyncio.wait_for 로 코루틴에 타임아웃을 적용한다.
초과 시 QUERY_TIMEOUT(BackendUnavailableError) 를 raise 한다.
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any

from _common.errors import BackendUnavailableError


async def enforce_timeout[T](
    coro: Coroutine[Any, Any, T],
    timeout_sec: int = 30,
) -> T:
    """코루틴에 타임아웃을 적용한다. 초과 시 QUERY_TIMEOUT raise."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout_sec)
    except TimeoutError as e:
        raise BackendUnavailableError(
            f"Query execution exceeded {timeout_sec} seconds. "
            "Narrow the WHERE condition and retry. [QUERY_TIMEOUT]"
        ) from e
