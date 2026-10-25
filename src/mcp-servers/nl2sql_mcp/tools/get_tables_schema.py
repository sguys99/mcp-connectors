"""T-04 get_tables_schema — 다중 테이블 스키마 일괄 조회(호출 절감)."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from _common.errors import InvalidInputError
from nl2sql_mcp.config import settings
from nl2sql_mcp.guardrails import annotate_schema_pii, audit_call
from nl2sql_mcp.models import TablesSchemaResult
from nl2sql_mcp.state import get_backend_or_raise


async def get_tables_schema(
    table_names: Annotated[list[str], Field(description="List of table names to look up (max 20)")],
) -> TablesSchemaResult:
    """Get the schemas of several tables in one call.
    Use it to check the columns of all relevant tables before writing a join query (fewer calls).
    If you only need a single table, use get_table_schema.
    Do not pass too many tables at once (max 20; more than that returns INVALID_INPUT).
    If a column's pii is "block", it cannot appear in the SELECT list (it may be used in conditions); if
    "mask", its result values are masked.
    Example call: get_tables_schema(table_names=["payment","customer"])
    """
    async with audit_call("get_tables_schema", params={"table_names": table_names}) as event:
        if not table_names or len(table_names) > 20:
            raise InvalidInputError(
                f"table_names is empty or exceeds 20 entries (requested {len(table_names)}). "
                "Split the request into calls of 20 or fewer. [INVALID_INPUT]",
            )

        # 같은 테이블을 여러 번 적어도 한 번만 돌려줍니다 (대소문자 무시, 순서 유지).
        # Mock 과 실 DB 가 같게 동작하도록 백엔드가 아니라 도구에서 처리해요 (T04-013).
        unique_names = list({name.lower(): name for name in reversed(table_names)}.values())[::-1]
        result = await get_backend_or_raise().get_tables_schema(table_names=unique_names)

        tables = []
        seen: set[tuple[str, str]] = set()
        for schema in result["tables"]:
            key = (str(schema["owner"]).lower(), str(schema["table_name"]).lower())
            if key in seen:  # "customer" 와 "public.customer" 처럼 이름은 달라도 같은 테이블
                continue
            seen.add(key)
            schema = dict(schema)
            schema["columns"] = annotate_schema_pii(
                [dict(c) for c in schema["columns"]], schema["table_name"], settings.pii_catalog
            )
            tables.append(schema)

        event.row_count = len(tables)
        return TablesSchemaResult.model_validate({**result, "tables": tables})
