"""백엔드 호출 재시도 (tenacity 기반 지수 백오프).

사용처: ``mock_repo_mcp/client.py::HttpBackendClient`` 가 네트워크 오류와 5xx/429 를 재시도할 때 씁니다.
``retry_on`` 에는 재시도해도 안전한 일시 장애 예외만 넣으세요 (4xx 같은 영구 오류는 넣지 않음).
"""

from __future__ import annotations

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


def with_backoff(
    max_attempts: int = 2,
    initial_wait: float = 1.0,
    max_wait: float = 4.0,
    retry_on: tuple[type[Exception], ...] = (Exception,),
):
    """tenacity AsyncRetrying을 반환하는 helper. 사용:

    async for attempt in with_backoff():
        with attempt:
            result = await call_backend()
    """
    return AsyncRetrying(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=initial_wait, max=max_wait),
        retry=retry_if_exception_type(retry_on),
        reraise=True,
    )
