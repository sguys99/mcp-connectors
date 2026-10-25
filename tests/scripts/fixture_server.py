"""시나리오 러너 테스트용 임시 FastMCP 서버 (tool, resource, prompt 각각).

프로세스를 띄우지 않고 ``Client(mcp)`` 인메모리 전송으로 씁니다. starter 서버와 독립이라 그쪽
프리미티브 구현에 영향을 받지 않아요.
"""

from __future__ import annotations

import asyncio

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

mcp = FastMCP("scenario-fixture")


@mcp.tool
async def add(a: int, b: int) -> int:
    return a + b


@mcp.tool
async def fail(code: str = "BOOM") -> str:
    raise ToolError(f"it broke [{code}]")


@mcp.tool
async def slow(seconds: float = 5.0) -> str:
    await asyncio.sleep(seconds)
    return "done"


@mcp.resource("fixture://about", mime_type="text/markdown")
def about() -> str:
    """About the fixture."""
    return "# About\nfixture server"


@mcp.resource("fixture://items/{item_id}", mime_type="application/json")
def item(item_id: str) -> dict[str, str]:
    """Item by id."""
    return {"id": item_id}


@mcp.prompt
def greet(name: str, tone: str = "friendly") -> str:
    """Greeting prompt."""
    return f"Say hello to {name} in a {tone} tone."
