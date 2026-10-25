"""T-03 get_table_schema — 단일 테이블 상세 스키마(컬럼·타입·널·관계) 조회."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from _common.errors import NotFoundError
from nl2sql_mcp.config import settings
from nl2sql_mcp.guardrails import annotate_schema_pii, audit_call
from nl2sql_mcp.models import TableSchema
from nl2sql_mcp.state import get_backend_or_raise


async def get_table_schema(
    table_name: Annotated[
        str, Field(description='Table name (may be schema-qualified, e.g. "public.customer")')
    ],
) -> TableSchema:
    """Get the exact columns, types, and relationships of a single table.
    Before writing a SELECT, always confirm the target table's real columns with this tool (prevents
    column hallucination).
    If you need several tables, fetch them at once with get_tables_schema.
    If you are unsure of the table name, first confirm the exact name with search_tables_schema.
    If a column's pii is "block", it cannot appear in the SELECT list (it may be used in conditions); if
    "mask", its result values are masked.
    Example call: get_table_schema(table_name="customer")
    """
    async with audit_call("get_table_schema", params={"table_name": table_name}) as event:
        schema = await get_backend_or_raise().get_table_schema(table_name=table_name)

        if schema is None:
            raise NotFoundError(
                f"Table '{table_name}' was not found. "
                "Confirm the exact name with search_tables_schema. [TABLE_NOT_FOUND]",
            )

        schema = dict(schema)
        schema["columns"] = annotate_schema_pii(
            [dict(c) for c in schema["columns"]], schema["table_name"], settings.pii_catalog
        )
        event.row_count = len(schema["columns"])
        return TableSchema.model_validate(schema)
