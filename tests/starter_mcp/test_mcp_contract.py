"""MCP 프로토콜 contract 검증 — list_tools / inputSchema 형상."""

from __future__ import annotations

import pytest
from fastmcp import Client


@pytest.mark.asyncio
async def test_list_tools_returns_four(mcp_client: Client) -> None:
    """list_tools() 가 echo / add / current_time / sample_content 4 종을 반환."""
    tools = await mcp_client.list_tools()
    assert {t.name for t in tools} == {"echo", "add", "current_time", "sample_content"}


@pytest.mark.asyncio
async def test_each_tool_has_valid_input_schema(mcp_client: Client) -> None:
    """각 도구의 inputSchema 가 dict + type=object."""
    tools = await mcp_client.list_tools()
    for tool in tools:
        schema = tool.inputSchema
        assert isinstance(schema, dict), f"{tool.name}: inputSchema is not dict"
        assert schema.get("type") == "object", f"{tool.name}: type != object"
        assert "properties" in schema, f"{tool.name}: missing properties"


@pytest.mark.asyncio
async def test_echo_schema_requires_text(mcp_client: Client) -> None:
    """echo 의 inputSchema 가 text 를 required 로 선언."""
    tools = await mcp_client.list_tools()
    echo_tool = next(t for t in tools if t.name == "echo")
    assert "text" in echo_tool.inputSchema["properties"]
    assert "text" in echo_tool.inputSchema.get("required", [])


@pytest.mark.asyncio
async def test_add_schema_declares_int_params(mcp_client: Client) -> None:
    """add 의 inputSchema 가 a / b 를 integer 로 선언."""
    tools = await mcp_client.list_tools()
    add_tool = next(t for t in tools if t.name == "add")
    props = add_tool.inputSchema["properties"]
    assert props["a"]["type"] == "integer"
    assert props["b"]["type"] == "integer"


@pytest.mark.asyncio
async def test_current_time_tz_has_default(mcp_client: Client) -> None:
    """current_time 의 tz 는 기본값을 가져 required 가 아님."""
    tools = await mcp_client.list_tools()
    ct_tool = next(t for t in tools if t.name == "current_time")
    assert "tz" not in ct_tool.inputSchema.get("required", [])


@pytest.mark.asyncio
async def test_llm_visible_descriptions_are_plain_text(mcp_client: Client) -> None:
    """LLM 에 보이는 도구 설명과 인자 설명에 RST 표기(이중 역따옴표)나 docstring 섹션 머리가 없다."""
    tools = await mcp_client.list_tools()
    for tool in tools:
        texts = [tool.description or ""] + [
            str(p.get("description", "")) for p in tool.inputSchema.get("properties", {}).values()
        ]
        for text in texts:
            assert "``" not in text, f"{tool.name}: {text!r}"
            assert "Returns:" not in text and "Raises:" not in text, f"{tool.name}: {text!r}"
