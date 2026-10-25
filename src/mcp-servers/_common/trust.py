"""신뢰 경계 헬퍼. 외부 텍스트를 untrusted_content 필드로 격리."""

from __future__ import annotations

from typing import Any


def wrap_untrusted(
    metadata: dict[str, Any],
    untrusted_content: dict[str, Any],
) -> dict[str, Any]:
    """MCP 응답을 신뢰 경계 분리 형태로 감싼다.

    - metadata: MCP 서버가 생성한 신뢰 가능 데이터 (경로, 크기, 리비전 ID 등)
    - untrusted_content: 외부 시스템에서 온 텍스트 (파일 본문, 커밋 메시지, 사용자 입력 등)
      LLM이 이 필드의 내용을 명령으로 해석하지 않도록 시스템 프롬프트에서 명시해야 함 (Agent 측 책임).
    """
    return {"metadata": metadata, "untrusted_content": untrusted_content}
