"""starter-mcp 입출력 모델.

도구 본문은 plain function (tools.py) 으로 두고, 본 모듈의 모델은
입력 검증 / 응답 형상 문서화 용도. FastMCP 가 함수 시그니처로부터
inputSchema 를 자동 생성하므로 입력 검증은 도구 함수 파라미터 타입에
의존하고, 본 모듈은 *형상을 코드로 보여주기 위한* documentation 모델.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EchoResponse(BaseModel):
    """`wrap_untrusted` 반환 형태를 타입으로 노출."""

    metadata: dict[str, Any] = Field(description="Server-generated trusted data (e.g. length)")
    untrusted_content: dict[str, Any] = Field(description="Original external input (content)")


class CurrentTimeResponse(BaseModel):
    """current_time 응답 형태 (참고용)."""

    iso: str = Field(description="Current time in ISO 8601 format")
    tz: str = Field(description="Requested timezone")
