"""서버 실행 중 공유하는 런타임 상태.

도구 모듈은 ``server.py`` 를 import 하지 않고 이 모듈에서 백엔드를 꺼냅니다. 그래서 도구 등록 순서와
import 순서가 서로 얽히지 않아요. 백엔드는 ``server.py`` 의 lifespan 이 넣고 뺍니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from _common.errors import BackendUnavailableError


@dataclass
class AppState:
    """lifespan 동안 유지되는 상태. 테스트는 ``state.backend`` 를 바꿔 끼웁니다."""

    backend: Any = None


state = AppState()


def get_backend_or_raise() -> Any:
    """현재 백엔드를 돌려줍니다. lifespan 밖에서 불리면 BACKEND_UNAVAILABLE 로 알립니다."""
    if state.backend is None:
        raise BackendUnavailableError(
            "The DB backend is not initialized. Call it inside the server lifespan. "
            "[BACKEND_UNAVAILABLE]"
        )
    return state.backend
