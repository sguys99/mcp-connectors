"""nl2sql_mcp MCP 프로토콜 contract 테스트 (FastMCP in-memory client)."""

from __future__ import annotations

import pytest

EXPECTED_TOOLS = {
    "search_tables_schema",
    "search_columns",
    "get_table_schema",
    "get_tables_schema",
    "run_sql_query",
}


async def test_list_tools_returns_all_expected(mcp_client):
    tools = await mcp_client.list_tools()
    tool_names = {t.name for t in tools}
    assert tool_names == EXPECTED_TOOLS, (
        f"Tool 목록 불일치. 누락: {EXPECTED_TOOLS - tool_names}, 추가: {tool_names - EXPECTED_TOOLS}"
    )


async def test_each_tool_has_description_and_schema(mcp_client):
    tools = await mcp_client.list_tools()
    for tool in tools:
        assert tool.description, f"{tool.name}에 description이 없음"
        assert tool.inputSchema, f"{tool.name}에 inputSchema가 없음"


@pytest.mark.parametrize(
    "tool_name,args",
    [
        ("search_tables_schema", {"pattern": "CUST%"}),
        ("search_columns", {"column_pattern": "AMOUNT"}),
        ("get_table_schema", {"table_name": "payment"}),
        ("get_tables_schema", {"table_names": ["payment", "customer"]}),
        (
            "run_sql_query",
            {"sql": "SELECT payment_id, amount FROM payment WHERE payment_date > SYSDATE - 90"},
        ),
    ],
)
async def test_each_tool_callable_via_mcp_protocol(mcp_client, tool_name, args):
    """MCP 프로토콜 레이어를 거쳐도 각 tool이 오류 없이 호출 가능한지 확인."""
    result = await mcp_client.call_tool(tool_name, args)
    assert result is not None
