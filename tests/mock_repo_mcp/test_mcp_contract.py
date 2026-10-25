"""MCP 프로토콜 contract 검증 — list_tools / inputSchema 형상."""

from __future__ import annotations

import pytest
from fastmcp import Client


@pytest.mark.asyncio
async def test_list_tools_returns_three(mcp_client: Client) -> None:
    """list_tools() 가 list_repositories / get_file_content / search_code 3 종 반환."""
    tools = await mcp_client.list_tools()
    assert {t.name for t in tools} == {"list_repositories", "get_file_content", "search_code"}


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
async def test_get_file_content_schema_requires_repository_id_and_path(
    mcp_client: Client,
) -> None:
    """get_file_content 가 repository_id 와 path 를 required 로 선언."""
    tools = await mcp_client.list_tools()
    tool = next(t for t in tools if t.name == "get_file_content")
    required = set(tool.inputSchema.get("required", []))
    assert {"repository_id", "path"} <= required
    assert "revision" not in required


@pytest.mark.asyncio
async def test_list_repositories_params_all_optional(mcp_client: Client) -> None:
    """list_repositories 의 3 파라미터 모두 기본값 보유 → required 미포함."""
    tools = await mcp_client.list_tools()
    tool = next(t for t in tools if t.name == "list_repositories")
    required = tool.inputSchema.get("required", [])
    assert "name_pattern" not in required
    assert "limit" not in required
    assert "offset" not in required


@pytest.mark.asyncio
async def test_search_code_schema_requires_query(mcp_client: Client) -> None:
    """search_code 가 query 를 required 로 선언, repository_id / limit 은 선택."""
    tools = await mcp_client.list_tools()
    tool = next(t for t in tools if t.name == "search_code")
    required = set(tool.inputSchema.get("required", []))
    assert "query" in required
    assert "repository_id" not in required
    assert "limit" not in required


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
