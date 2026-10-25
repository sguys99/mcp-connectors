"""MCP 프리미티브 호출 헬퍼 (CLI 와 시나리오 러너 공용).

이미 연결된 ``fastmcp.Client`` (``async with client`` 안) 로 tool, resource, prompt 를 부르고, 결과를
JSON 으로 직렬화 가능한 dict 로 정규화합니다. 시나리오의 ``checks`` 경로가 이 모양을 기준으로 해요.

* tool: ``structured_content`` > ``data`` > ``content`` 블록 목록 순서. 도구 오류는 예외가 아니라
  ``{"error": {"code", "message"}}`` 로 돌려줍니다.
* resource: ``{"contents": [{"uri", "mimeType", "text"} | {"uri", "mimeType", "blob"}]}``
* prompt: ``{"description", "messages": [{"role", "content": {"type", "text"}}]}``
"""

from __future__ import annotations

import re
from typing import Any

from fastmcp import Client


def extract_error_code(message: str, default: str = "TOOL_ERROR") -> str:
    """메시지에서 [UPPER_CODE] 패턴을 추출한다."""
    m = re.search(r"\[([A-Z][A-Z0-9_]+)\]", message)
    return m.group(1) if m else default


def error_dict(message: str, default_code: str = "TOOL_ERROR") -> dict[str, Any]:
    return {"error": {"code": extract_error_code(message, default_code), "message": message}}


def normalize_tool_result(result: Any) -> Any:
    """``call_tool(..., raise_on_error=False)`` 결과를 CLI 출력 형식으로 바꿉니다."""
    # FastMCP 3.x uses is_error (snake_case); MCP spec uses isError
    if getattr(result, "is_error", None) or getattr(result, "isError", False):
        content = result.content or []
        msg = content[0].text if content and hasattr(content[0], "text") else str(result)
        return error_dict(msg)

    if getattr(result, "structured_content", None) is not None:
        return result.structured_content
    if getattr(result, "data", None) is not None:
        return result.data
    return [c.model_dump(mode="json") for c in (result.content or [])]


async def call_tool(client: Client, tool: str, params: dict[str, Any]) -> Any:
    # raise_on_error=False: isError=True 결과를 예외 대신 CallToolResult로 반환
    result = await client.call_tool(tool, params, raise_on_error=False)
    return normalize_tool_result(result)


async def read_resource(client: Client, uri: str) -> dict[str, Any]:
    """``resources/read``. 서버가 거절하면 ``RESOURCE_ERROR`` 에러 dict 를 돌려줍니다."""
    try:
        contents = await client.read_resource(uri)
    except Exception as e:  # noqa: BLE001  (McpError 등 서버 응답 오류만 다룸, 연결 오류는 아래에서 재던짐)
        if _is_connection_error(e):
            raise
        return error_dict(str(e), "RESOURCE_ERROR")
    return {"contents": [c.model_dump(mode="json", exclude_none=True) for c in contents]}


async def get_prompt(client: Client, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    """``prompts/get``. 서버가 거절하면 ``PROMPT_ERROR`` 에러 dict 를 돌려줍니다."""
    try:
        result = await client.get_prompt(name, arguments or None)
    except Exception as e:  # noqa: BLE001
        if _is_connection_error(e):
            raise
        return error_dict(str(e), "PROMPT_ERROR")
    return result.model_dump(mode="json", exclude_none=True)


def _is_connection_error(exc: Exception) -> bool:
    """프로토콜 응답 오류(McpError, ToolError 류)가 아닌 전송, 연결 문제인지."""
    from mcp import McpError

    if isinstance(exc, McpError):
        return False
    # fastmcp 의 resource, prompt 오류는 ToolError 계열이거나 McpError 입니다. 그 밖은 연결 문제예요.
    return type(exc).__name__ not in {"ToolError", "ResourceError", "PromptError", "NotFoundError"}
