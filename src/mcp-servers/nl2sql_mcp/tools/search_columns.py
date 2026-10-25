"""T-02 search_columns — 컬럼명·용어로 해당 컬럼을 가진 테이블 역탐색."""

from __future__ import annotations

from typing import Annotated

from fastmcp.exceptions import ToolError
from pydantic import Field

from nl2sql_mcp.config import settings
from nl2sql_mcp.guardrails import annotate_schema_pii, audit_call
from nl2sql_mcp.models import SearchColumnsResult
from nl2sql_mcp.state import get_backend_or_raise


async def search_columns(
    column_pattern: Annotated[
        str,
        Field(description='Column name pattern (SQL LIKE, e.g. "AMOUNT", "%DATE")'),
    ],
    limit: Annotated[
        int, Field(description="Maximum number of matches to return. Default 50, max 200")
    ] = 50,
) -> SearchColumnsResult:
    """Reverse-search for tables that contain a given column name or term.
    Use it when you do not know which table holds a specific column (e.g. AMOUNT).
    If you have a hint about the table name, use search_tables_schema first (more accurate).
    Too many matches are blocked with TOO_MANY_COLUMNS, so use a specific column name.
    If a column's pii is "block", it cannot appear in the SELECT list; if "mask", its result values are
    masked.
    Example call: "Where is the payment amount column?" -> search_columns(column_pattern="AMOUNT")
    """
    params = {"column_pattern": column_pattern, "limit": limit}
    async with audit_call("search_columns", params=params) as event:
        effective_limit = min(limit, 200)

        result = await get_backend_or_raise().search_columns(
            column_pattern=column_pattern, limit=effective_limit
        )

        if result["match_count"] > effective_limit:
            event.error_type = "TOO_MANY_COLUMNS"
            raise ToolError(
                f"Too many columns match the pattern ({result['match_count']}). "
                "Narrow column_pattern to be more specific. [TOO_MANY_COLUMNS]",
            )

        # 7.6 컬럼별 PII 표시 (테이블이 섞여 있어 한 건씩 판정)
        for col in result["columns"]:
            annotate_schema_pii([col], col["table_name"], settings.pii_catalog, column_key="column_name")

        event.row_count = result["match_count"]
        return SearchColumnsResult.model_validate(result)
