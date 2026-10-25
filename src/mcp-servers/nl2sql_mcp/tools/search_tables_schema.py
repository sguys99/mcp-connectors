"""T-01 search_tables_schema — 이름 패턴으로 테이블 검색 + 스키마 반환."""

from __future__ import annotations

from typing import Annotated

from fastmcp.exceptions import ToolError
from pydantic import Field

from _common.errors import InvalidInputError
from nl2sql_mcp.guardrails import audit_call
from nl2sql_mcp.models import SearchTablesResult
from nl2sql_mcp.state import get_backend_or_raise


async def search_tables_schema(
    pattern: Annotated[str, Field(description='Table name pattern (e.g. "CUST%", "%FILM%")')],
    limit: Annotated[
        int, Field(description="Maximum number of tables to return. Default 20, max 50")
    ] = 20,
) -> SearchTablesResult:
    """Search by name pattern for tables that look relevant to a natural-language question.
    Do not fetch the whole schema at once. Always narrow the candidates with this tool first, then
    confirm details with get_table_schema.
    If you only know a column name and not the table, use search_columns instead.
    A broad call without a specific pattern may exceed limit and be truncated, so use concrete keywords.
    Example call: "find the customer table" -> search_tables_schema(pattern="CUST%")
    """
    async with audit_call("search_tables_schema", params={"pattern": pattern, "limit": limit}) as event:
        if limit <= 0 or limit > 50:
            raise InvalidInputError(
                f"limit must be in the range 1 to 50 (got: {limit}). [INVALID_INPUT]"
            )

        # 7.9 객체 화이트리스트는 카탈로그 SQL 이 시스템 스키마를 빼는 것으로 보장합니다 (db/dialects)
        result = await get_backend_or_raise().search_tables(pattern=pattern, limit=limit)

        if result["match_count"] > limit:
            event.error_type = "TOO_MANY_TABLES"
            raise ToolError(
                f"Too many tables match the pattern ({result['match_count']}). "
                "Narrow pattern to be more specific (e.g. 'FILM_C%'). [TOO_MANY_TABLES]",
            )

        event.row_count = result["match_count"]
        return SearchTablesResult.model_validate(result)
