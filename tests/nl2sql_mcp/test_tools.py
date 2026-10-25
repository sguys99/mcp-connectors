"""nl2sql_mcp tool 단위 테스트 (MockBackend 사용)."""

from __future__ import annotations

import pytest
from fastmcp.exceptions import ToolError

from _common.errors import InvalidInputError, NotFoundError
from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.get_tables_schema import get_tables_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query
from nl2sql_mcp.tools.search_columns import search_columns
from nl2sql_mcp.tools.search_tables_schema import search_tables_schema

# ── T-01 search_tables_schema ──────────────────────────────────────────────


async def test_search_tables_schema_returns_match(mock_backend):
    result = (await search_tables_schema(pattern="CUST%")).model_dump()
    assert "tables" in result
    assert "match_count" in result
    names = [t["table_name"] for t in result["tables"]]
    assert "customer" in names


async def test_search_tables_schema_too_many_raises(mock_backend):
    """limit보다 많이 매칭되면 ToolError(TOO_MANY_TABLES) 발생."""

    async def _many_tables(pattern, limit):
        return {
            "tables": [{"table_name": f"T{i}"} for i in range(limit)],
            "match_count": limit + 1,
            "truncated": True,
        }

    mock_backend.search_tables = _many_tables
    with pytest.raises(ToolError, match="Too many"):
        await search_tables_schema(pattern="%")


async def test_search_tables_schema_empty_result(mock_backend):
    result = (await search_tables_schema(pattern="NONEXIST%")).model_dump()
    assert result["tables"] == []
    assert result["match_count"] == 0


# ── T-02 search_columns ────────────────────────────────────────────────────


async def test_search_columns_returns_match(mock_backend):
    result = (await search_columns(column_pattern="AMOUNT")).model_dump()
    assert "columns" in result
    cols = [c["column_name"] for c in result["columns"]]
    assert "amount" in cols


async def test_search_columns_too_many_raises(mock_backend):
    """limit보다 많이 매칭되면 ToolError(TOO_MANY_COLUMNS) 발생."""

    async def _many_cols(column_pattern, limit):
        return {"columns": [], "match_count": limit + 1, "truncated": True}

    mock_backend.search_columns = _many_cols
    with pytest.raises(ToolError, match="Too many"):
        await search_columns(column_pattern="%")


# ── T-03 get_table_schema ──────────────────────────────────────────────────


async def test_get_table_schema_returns_columns(mock_backend):
    result = (await get_table_schema(table_name="PAYMENT")).model_dump()
    assert result["table_name"] == "payment"
    assert "columns" in result
    assert len(result["columns"]) > 0


async def test_get_table_schema_not_found_raises(mock_backend):
    with pytest.raises(NotFoundError, match="was not found"):
        await get_table_schema(table_name="NONEXIST_TABLE")


async def test_get_table_schema_with_schema_prefix(mock_backend):
    """public.customer 형태도 정상 반환."""
    result = (await get_table_schema(table_name="public.customer")).model_dump()
    assert result["table_name"] == "customer"


# ── T-04 get_tables_schema ─────────────────────────────────────────────────


async def test_get_tables_schema_returns_all(mock_backend):
    result = (await get_tables_schema(table_names=["payment", "customer"])).model_dump()
    assert len(result["tables"]) == 2
    assert result["not_found"] == []


async def test_get_tables_schema_dedupes_names_in_tool(mock_backend):
    """대소문자나 스키마 한정자만 다른 같은 테이블은 한 번만 돌려줍니다 (T04-013, P2-7)."""
    seen_names: list[list[str]] = []
    original = mock_backend.get_tables_schema

    async def spy(table_names):
        seen_names.append(list(table_names))
        return await original(table_names=table_names)

    mock_backend.get_tables_schema = spy
    result = (
        await get_tables_schema(table_names=["customer", "CUSTOMER", "public.customer", "film"])
    ).model_dump()
    assert seen_names == [["customer", "public.customer", "film"]]
    assert [t["table_name"] for t in result["tables"]] == ["customer", "film"]


async def test_get_tables_schema_partial_not_found(mock_backend):
    result = (await get_tables_schema(table_names=["payment", "NO_SUCH_TABLE"])).model_dump()
    found_names = [t["table_name"] for t in result["tables"]]
    assert "payment" in found_names
    assert "NO_SUCH_TABLE" in result["not_found"]


async def test_get_tables_schema_exceeds_limit_raises(mock_backend):
    with pytest.raises(InvalidInputError, match="exceeds 20"):
        await get_tables_schema(table_names=[f"T{i}" for i in range(21)])


async def test_get_tables_schema_empty_raises(mock_backend):
    with pytest.raises(InvalidInputError):
        await get_tables_schema(table_names=[])


# ── T-14 run_sql_query ─────────────────────────────────────────────────────


async def test_run_sql_query_returns_rows(mock_backend):
    result = (
        await run_sql_query(
            sql=(
                "SELECT staff_id, COUNT(*) FROM payment "
                "WHERE payment_date >= DATE '2026-05-01' GROUP BY staff_id"
            ),
        )
    ).model_dump()
    assert "columns" in result
    assert "rows" in result
    assert "row_count" in result
    assert result["row_count"] >= 0


async def test_run_sql_query_respects_max_rows(mock_backend):
    # WHERE 없는 풀스캔은 가드레일에 의해 차단되므로 조건 포함 SQL 사용
    result = (
        await run_sql_query(
            sql="SELECT customer_id, store_id FROM customer WHERE active = 1",
            max_rows=500,
        )
    ).model_dump()
    assert result is not None


async def test_run_sql_query_delete_write_blocked(mock_backend):
    """DELETE 문은 7.1 가드레일에 의해 WRITE_BLOCKED."""
    with pytest.raises(ToolError, match="WRITE_BLOCKED"):
        await run_sql_query(sql="DELETE FROM customer WHERE customer_id = 1")


async def test_run_sql_query_no_where_mass_scan_blocked(mock_backend):
    """큰 테이블(rental 약 1.6만 행)의 WHERE 없는 전체 조회는 7.7 가드레일에 의해 MASS_SCAN_BLOCKED."""
    with pytest.raises(ToolError, match="MASS_SCAN_BLOCKED"):
        await run_sql_query(sql="SELECT rental_id, customer_id FROM rental")


# ── Pagila 카탈로그 특성 (Mock 백엔드) ─────────────────────────────────────


async def test_catalog_has_23_objects(mock_backend):
    """Pagila 테이블 15 + 뷰 7 + 구체화 뷰 1 = 23개. 기본 limit(20) 초과라 '%' 는 TOO_MANY_TABLES."""
    result = await mock_backend.search_tables("%", limit=50)
    assert result["match_count"] == 23
    with pytest.raises(ToolError, match="Too many"):
        await search_tables_schema(pattern="%")


async def test_search_columns_percent_too_many(mock_backend):
    """전체 컬럼 패턴('%')은 기본 limit(50) 초과 → ToolError."""
    with pytest.raises(ToolError, match="Too many"):
        await search_columns(column_pattern="%")


async def test_get_table_schema_case_insensitive(mock_backend):
    """대문자 입력도 소문자 카탈로그(Pagila)와 매칭된다."""
    result = (await get_table_schema(table_name="CUSTOMER")).model_dump()
    assert result["table_name"] == "customer"
    assert result["owner"] == "public"
    assert result["primary_key"] == ["customer_id"]


async def test_get_table_schema_rental_return_date_nullable(mock_backend):
    """rental.return_date 는 NULL 허용(미반납), rental_date 는 NOT NULL."""
    result = (await get_table_schema(table_name="rental")).model_dump()
    cols = {c["name"]: c for c in result["columns"]}
    assert cols["return_date"]["nullable"] is True
    assert cols["rental_date"]["nullable"] is False


async def test_run_sql_query_sample_rows_payment(mock_backend):
    """payment 조회는 SELECT 컬럼에 맞춰 샘플 행을 고르고, 단순 WHERE 를 샘플 행에 적용한다."""
    result = (
        await run_sql_query(sql="SELECT payment_id, amount FROM payment WHERE customer_id = 269")
    ).model_dump()
    assert result["columns"] == ["payment_id", "amount"]
    assert result["row_count"] == 5
    none = await run_sql_query(sql="SELECT payment_id FROM payment WHERE customer_id = 130")
    assert none.row_count == 0


async def test_run_sql_query_pii_column_blocked(mock_backend):
    """PII 컬럼(email) 직접 조회는 ToolError(PII_COLUMN_BLOCKED)."""
    with pytest.raises(ToolError, match="PII_COLUMN_BLOCKED"):
        await run_sql_query(sql="SELECT email FROM customer WHERE active = 1")
