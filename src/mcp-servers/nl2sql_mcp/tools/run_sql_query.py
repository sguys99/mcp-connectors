"""T-14 run_sql_query — SELECT 전용 쿼리 실행 (가드레일 7.1~7.9 전면 적용)."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

from _common.errors import InvalidInputError
from nl2sql_mcp.config import settings
from nl2sql_mcp.db.dialects import get_dialect
from nl2sql_mcp.guardrails import (
    apply_sql_guardrails,
    audit_call,
    enforce_timeout,
    mask_pii_output,
)
from nl2sql_mcp.models import SqlQueryResult
from nl2sql_mcp.state import get_backend_or_raise


async def run_sql_query(
    sql: Annotated[
        str,
        Field(description="A single SELECT statement (no multiple statements separated by semicolons)"),
    ],
    max_rows: Annotated[
        int, Field(description="Maximum number of rows to return. Default 1000, max 10000")
    ] = 1000,
) -> SqlQueryResult:
    """Execute SELECT queries only. INSERT/UPDATE/DELETE/DDL/DCL/transaction control are all rejected.
    Every query must pass these guardrails in order before it runs:
    (1) single-SELECT validation -> (2) object whitelist and forbidden/risky construct checks ->
    (3) PII column check, plus blocking of full scans and cartesian joins ->
    (4) forced injection of the date range and LIMIT -> (5) timeout enforcement.
    A query without WHERE is allowed only on small tables (e.g. catalog row count of 10,000 or less).
    Full scans or cartesian joins on large tables are blocked before execution, so narrow the
    conditions and retry. UNION/UNION ALL is allowed.
    Date conditions are limited to 12 months at most. If you give only a lower bound, the range is
    computed up to today, so give an upper bound as well.
    Columns marked pii="block" by the schema tools are rejected with PII_COLUMN_BLOCKED if placed in
    the SELECT list (they may be used in WHERE conditions). Columns marked pii="mask" and values in
    PII formats (phone numbers, emails, card numbers, etc.) are masked automatically and listed in
    masked_columns.
    data_source tells where the rows came from: mock_sample means the Mock backend answered from a
    small fixed sample of rows (say so when you report counts or totals), database means a real database.
    Example call: run_sql_query(sql="SELECT staff_id, COUNT(*) FROM payment
    WHERE payment_date >= CURRENT_DATE - INTERVAL '3 months' GROUP BY staff_id")
    """
    async with audit_call("run_sql_query", sql=sql, params={"max_rows": max_rows}) as event:
        if max_rows <= 0:
            raise InvalidInputError(f"max_rows must be 1 or greater (got: {max_rows}). [INVALID_INPUT]")
        effective_max_rows = min(max_rows, settings.guardrail_max_limit)

        backend = get_backend_or_raise()
        # 가드레일 파이프라인: 7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3
        guarded = await apply_sql_guardrails(
            sql,
            max_rows=effective_max_rows,
            forbidden_enabled=settings.guardrail_forbidden_enabled,
            risky_sql_enabled=settings.guardrail_risky_sql_enabled,
            pii_catalog=settings.pii_catalog,
            default_months=settings.guardrail_default_months,
            max_months=settings.guardrail_max_months,
            require_where=settings.guardrail_require_where,
            block_tautology=settings.guardrail_block_tautology,
            dialect=get_dialect(settings.nl2sql_db_dialect),
            row_estimator=getattr(backend, "estimate_rows", None),
            mass_scan_row_threshold=settings.guardrail_mass_scan_row_threshold,
            date_columns=settings.date_column_catalog,
        )

        # 7.4 timeout 래핑 후 DB 실행
        result = await enforce_timeout(
            backend.execute_query(sql=guarded.sql, max_rows=effective_max_rows),
            timeout_sec=settings.guardrail_timeout_sec,
        )

        # 7.6 결과 마스킹 (카탈로그 mask 열 + PII 정규식)
        rows, masked_columns = mask_pii_output(result["rows"], result["columns"], guarded.pii_plan)
        result = {**result, "rows": rows, "masked_columns": masked_columns}

        event.row_count = result.get("row_count", len(rows))
        return SqlQueryResult.model_validate(result)
