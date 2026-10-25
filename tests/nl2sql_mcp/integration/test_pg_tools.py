"""도구 5종을 실 Pagila 샘플 DB 에 연결해 확인합니다 (가드레일 포함 전체 경로)."""

from __future__ import annotations

import pytest
from fastmcp.exceptions import ToolError

from _common.errors import NotFoundError
from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.get_tables_schema import get_tables_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query
from nl2sql_mcp.tools.search_columns import search_columns
from nl2sql_mcp.tools.search_tables_schema import search_tables_schema

pytestmark = pytest.mark.integration


# ── 스키마 탐색 ────────────────────────────────────────────────────────────


async def test_search_tables_schema_film(real_backend):
    result = (await search_tables_schema(pattern="FILM%")).model_dump()
    by_name = {t["table_name"]: t for t in result["tables"]}
    assert set(by_name) == {"film", "film_actor", "film_category", "film_list"}
    assert by_name["film"]["comment"] == "Film master"
    assert by_name["film"]["column_count"] == 14
    assert by_name["film"]["estimated_rows"] == 1000  # ANALYZE 후 reltuples
    assert all(t["owner"] == "public" for t in result["tables"])


async def test_search_tables_hides_partitions(real_backend):
    """payment 월별 파티션(payment_p2022_01~07)은 부모 payment 하나로만 보입니다."""
    result = (await search_tables_schema(pattern="payment%")).model_dump()
    assert [t["table_name"] for t in result["tables"]] == ["payment"]
    assert result["tables"][0]["estimated_rows"] == 16049


async def test_search_tables_schema_all_objects(real_backend):
    """테이블 15 + 뷰 7 + 구체화 뷰 1 = 23개. 기본 limit(20)을 넘으면 TOO_MANY_TABLES."""
    result = (await search_tables_schema(pattern="%", limit=50)).model_dump()
    assert result["match_count"] == 23
    assert result["truncated"] is False
    with pytest.raises(ToolError, match=r"Too many tables .*\[TOO_MANY_TABLES\]"):
        await search_tables_schema(pattern="%")


async def test_search_columns_amount(real_backend):
    result = (await search_columns(column_pattern="%amount%")).model_dump()
    assert result["columns"] == [
        {
            "owner": "public",
            "table_name": "payment",
            "column_name": "amount",
            "data_type": "numeric(5,2)",
            "comment": "Payment amount",
            "pii": None,
        }
    ]


async def test_get_table_schema_payment(real_backend):
    """파티션 테이블 payment 의 FK 는 파티션에 걸려 있어도 부모 스키마에 모아 보여 줍니다."""
    result = (await get_table_schema(table_name="payment")).model_dump()
    assert result["comment"].startswith("Payments")
    assert result["primary_key"] == ["payment_date", "payment_id"]
    fks = {
        (tuple(f["columns"]), f["ref_table"], tuple(f["ref_columns"])) for f in result["foreign_keys"]
    }
    assert fks == {
        (("customer_id",), "customer", ("customer_id",)),
        (("rental_id",), "rental", ("rental_id",)),
        (("staff_id",), "staff", ("staff_id",)),
    }


async def test_get_table_schema_with_owner_and_case(real_backend):
    result = (await get_table_schema(table_name="PUBLIC.CUSTOMER")).model_dump()
    assert result["table_name"] == "customer"
    cols = {c["name"]: c for c in result["columns"]}
    assert cols["email"]["comment"] == "Email (PII)"
    assert cols["email"]["nullable"] is True
    assert cols["customer_id"]["nullable"] is False


async def test_get_table_schema_not_found(real_backend):
    with pytest.raises(NotFoundError):
        await get_table_schema(table_name="no_such_table")


@pytest.mark.parametrize("name", ["pg_catalog.pg_class", "information_schema.tables", "pg_class"])
async def test_get_table_schema_hides_system_schemas(real_backend, name):
    """스키마를 직접 적어도 시스템 카탈로그는 없는 테이블입니다 (T03-009, P2-7)."""
    with pytest.raises(NotFoundError, match="TABLE_NOT_FOUND"):
        await get_table_schema(table_name=name)


async def test_get_tables_schema_dedupes_like_mock(real_backend):
    """같은 테이블을 여러 이름으로 적어도 한 번만 돌려줍니다 (T04-013, P2-7)."""
    result = (
        await get_tables_schema(table_names=["customer", "CUSTOMER", "public.customer", "film"])
    ).model_dump()
    assert [t["table_name"] for t in result["tables"]] == ["customer", "film"]
    assert result["not_found"] == []


async def test_get_tables_schema_mixed(real_backend):
    result = (
        await get_tables_schema(table_names=["film", "rental_by_category", "no_such_table"])
    ).model_dump()
    assert [t["table_name"] for t in result["tables"]] == ["film", "rental_by_category"]
    assert result["not_found"] == ["no_such_table"]


# ── 쿼리 실행 ──────────────────────────────────────────────────────────────


async def test_run_sql_query_group_by(real_backend):
    result = (
        await run_sql_query(
            sql=(
                "SELECT staff_id, COUNT(*) AS cnt FROM payment "
                "WHERE payment_date >= DATE '2022-03-01' AND payment_date < DATE '2022-05-01' "
                "GROUP BY staff_id ORDER BY staff_id"
            )
        )
    ).model_dump()
    assert result["columns"] == ["staff_id", "cnt"]
    assert [r[0] for r in result["rows"]] == [1, 2]
    assert sum(r[1] for r in result["rows"]) > 0


async def test_run_sql_query_injects_limit(real_backend):
    """LIMIT 이 없으면 max_rows 만큼 LIMIT 이 붙어 실행됩니다."""
    result = (
        await run_sql_query(sql="SELECT film_id, title FROM film WHERE film_id > 0", max_rows=5)
    ).model_dump()
    assert result["row_count"] == 5
    assert len(result["rows"]) == 5


async def test_run_sql_query_materialized_view_is_populated(real_backend):
    """upstream 은 rental_by_category 를 WITH NO DATA 로 만들어 initdb 03 에서 REFRESH 합니다."""
    result = (
        await run_sql_query(
            sql="SELECT category, total_sales FROM rental_by_category WHERE total_sales > 0"
        )
    ).model_dump()
    assert result["row_count"] == 16


async def test_run_sql_query_db_error_is_reported(real_backend):
    """없는 컬럼은 DB 메시지를 담아 INVALID_SQL 로 돌려줘 LLM 이 SQL 을 고칠 수 있게 합니다 (P2-7)."""
    with pytest.raises(ToolError, match=r"no_such_col.*\[INVALID_SQL\]"):
        await run_sql_query(sql="SELECT no_such_col FROM film WHERE film_id = 1")


async def test_run_sql_query_write_blocked_by_guardrail(real_backend):
    with pytest.raises(ToolError, match="WRITE_BLOCKED"):
        await run_sql_query(sql="DELETE FROM film WHERE film_id = 1")
