"""P2-6 가드레일 회귀 테스트. 번호는 update-plan 2-A 의 P2-6 버그 목록 순서입니다.

dialect 차이가 있는 버그는 Postgres(기본)와 Oracle 을 모두 확인합니다.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from _common.errors import AccessDeniedError, InvalidInputError
from nl2sql_mcp.db.dialects import get_dialect
from nl2sql_mcp.db.mock_backend import MockBackend
from nl2sql_mcp.guardrails import apply_sql_guardrails
from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs
from nl2sql_mcp.guardrails.block_mass_scan import block_mass_scan
from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql
from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range
from nl2sql_mcp.guardrails.enforce_row_limit import enforce_row_limit
from nl2sql_mcp.guardrails.enforce_select_only import enforce_select_only

PG = get_dialect("postgres")
ORA = get_dialect("oracle")
BOTH = pytest.mark.parametrize("dialect", [PG, ORA], ids=["postgres", "oracle"])
TODAY = date(2026, 10, 22)


async def _guard(sql: str, dialect=PG, backend: MockBackend | None = None, **kw):
    backend = backend or MockBackend(dialect=dialect)
    return await apply_sql_guardrails(
        sql, max_rows=10, dialect=dialect, row_estimator=backend.estimate_rows, **kw
    )


# ── 1. 하한만 있는 날짜 조건 ─────────────────────────────────────────────────


@BOTH
async def test_1_lower_bound_only_is_checked_until_today(dialect):
    sql = "SELECT rental_id FROM rental WHERE rental_date >= DATE '2022-01-01'"
    with pytest.raises(InvalidInputError, match="DATE_RANGE_EXCEEDED"):
        await enforce_date_range(sql, dialect=dialect, today=TODAY)
    recent = "SELECT rental_id FROM rental WHERE rental_date >= DATE '2026-01-01'"
    assert await enforce_date_range(recent, dialect=dialect, today=TODAY) == recent


@pytest.mark.parametrize(
    "dialect,ok,bad",
    [
        (PG, "CURRENT_DATE - INTERVAL '12 months'", "CURRENT_DATE - INTERVAL '13 months'"),
        (PG, "NOW() - INTERVAL '1 year'", "CURRENT_DATE - INTERVAL '12 months' - INTERVAL '1 day'"),
        (ORA, "ADD_MONTHS(SYSDATE, -12)", "ADD_MONTHS(SYSDATE, -13)"),
        (ORA, "SYSDATE - 30", "SYSDATE - 400"),
    ],
)
async def test_1_relative_lower_bound(dialect, ok, bad):
    base = "SELECT payment_id FROM payment WHERE payment_date >= "
    assert await enforce_date_range(base + ok, dialect=dialect, today=TODAY) == base + ok
    with pytest.raises(InvalidInputError, match="DATE_RANGE_EXCEEDED"):
        await enforce_date_range(base + bad, dialect=dialect, today=TODAY)


@BOTH
async def test_1_upper_bound_only_is_open_ended(dialect):
    sql = "SELECT rental_id FROM rental WHERE rental_date < DATE '2026-01-01'"
    with pytest.raises(InvalidInputError, match="lower bound"):
        await enforce_date_range(sql, dialect=dialect, today=TODAY)


async def test_1_calendar_boundary_and_oracle_literals():
    ok = (
        "SELECT payment_id FROM payment "
        "WHERE payment_date >= DATE '2025-06-01' AND payment_date <= DATE '2026-06-01'"
    )
    assert await enforce_date_range(ok, dialect=PG, today=TODAY) == ok
    bad = (
        "SELECT payment_id FROM payment WHERE payment_date "
        "BETWEEN TO_DATE('2023-01-01', 'YYYY-MM-DD') AND TO_DATE('2024-01-02', 'YYYY-MM-DD')"
    )
    with pytest.raises(InvalidInputError, match="DATE_RANGE_EXCEEDED"):
        await enforce_date_range(bad, dialect=ORA, today=TODAY)


# ── 2. 정상 UNION 허용, injection 패턴은 차단 ───────────────────────────────


@BOTH
@pytest.mark.parametrize("op", ["UNION", "UNION ALL"])
async def test_2_union_of_selects_passes_pipeline(dialect, op):
    sql = (
        f"SELECT film_id FROM film WHERE film_id < 3 {op} SELECT actor_id FROM actor WHERE actor_id < 3"
    )
    guarded = await _guard(sql, dialect)
    limit = "LIMIT 11" if dialect is PG else "FETCH FIRST 11 ROWS ONLY"
    assert guarded.sql.endswith(limit)  # 행 수 제한은 집합 전체에 한 번


@BOTH
@pytest.mark.parametrize(
    "branch",
    ["SELECT 1", "SELECT NULL, NULL", "SELECT 1 FROM dual"],
)
async def test_2_constant_union_branch_blocked(dialect, branch):
    sql = f"SELECT customer_id FROM customer WHERE active = 1 UNION {branch}"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(sql, dialect=dialect)


async def test_2_union_into_system_catalog_blocked_even_without_7_5():
    pg = "SELECT customer_id FROM customer WHERE active = 1 UNION SELECT usesysid FROM pg_shadow"
    ora = "SELECT customer_id FROM customer WHERE active = 1 UNION SELECT user_id FROM DBA_USERS"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(pg, dialect=PG)
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(ora, dialect=ORA)


async def test_2_union_mass_scan_checks_each_branch():
    sql = "SELECT film_id FROM film UNION SELECT rental_id FROM rental"
    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await _guard(sql)


async def test_2_union_date_injection_per_branch():
    sql = (
        "SELECT rental_id FROM rental WHERE staff_id = 1 "
        "UNION ALL SELECT payment_id FROM payment WHERE staff_id = 1"
    )
    guarded = await _guard(sql)
    assert "rental.rental_date >= CURRENT_DATE" in guarded.sql
    assert "payment.payment_date >= CURRENT_DATE" in guarded.sql


# ── 3. 주석, 문자열 안의 @ 와 UNION SELECT 오탐 ─────────────────────────────


@BOTH
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 'a@b' AS x FROM actor WHERE actor_id = 1",
        "SELECT customer_id FROM customer WHERE email = 'test@test.com' AND active = 1",
        "SELECT /* @not_a_dblink */ customer_id FROM customer WHERE active = 1",
        "SELECT film_id FROM film WHERE title = 'UNION SELECT'",
        "SELECT customer_id FROM customer WHERE active = 1 /* UNION SELECT 1 */",
        "SELECT customer_id FROM customer WHERE active = 1 -- UNION SELECT password FROM x",
        "SELECT film_id FROM film WHERE description = 'SYS.x DBMS_y pg_shadow'",
    ],
)
async def test_3_comments_and_literals_not_flagged(dialect, sql):
    assert await block_forbidden_constructs(sql, dialect=dialect) == sql
    assert await detect_risky_sql(sql, dialect=dialect) == sql


async def test_3_line_comment_then_real_union_still_blocked():
    sql = "SELECT customer_id FROM customer WHERE active = 1--comment\nUNION SELECT 1"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(sql, dialect=PG)


async def test_3_oracle_dblink_outside_literal_still_blocked():
    with pytest.raises(AccessDeniedError, match="DBLINK"):
        await block_forbidden_constructs("SELECT a FROM customer@remote WHERE x = 'a@b'", dialect=ORA)


# ── 4. Oracle SYSTEM., DBA_, V$, DBMS_METADATA ──────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT username FROM SYSTEM.help WHERE seq = 1",
        "SELECT username FROM DBA_USERS WHERE username = 'X'",
        "SELECT owner FROM dba_tables WHERE owner = 'X'",
        "SELECT sid FROM V$SESSION WHERE sid = 1",
        "SELECT name FROM CDB_PDBS WHERE con_id = 1",
    ],
)
async def test_4_oracle_system_objects_blocked(sql):
    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await block_forbidden_constructs(sql, dialect=ORA)


async def test_4_oracle_dbms_metadata_is_risky_function():
    sql = "SELECT DBMS_METADATA.GET_DDL('TABLE', 'FILM') FROM DUAL"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(sql, dialect=ORA)


# ── 5. 공백 SQL, 구문 오류 코드 ─────────────────────────────────────────────


@BOTH
@pytest.mark.parametrize("sql", ["", "   ", "\n\t  "])
async def test_5_blank_sql_is_invalid_input(dialect, sql):
    with pytest.raises(InvalidInputError, match=r"\[INVALID_INPUT\]"):
        await enforce_select_only(sql, dialect=dialect)


@BOTH
async def test_5_parse_error_codes(dialect):
    with pytest.raises(InvalidInputError, match=r"\[INVALID_SQL\]"):
        await enforce_select_only(
            "SELECT customer_id FROM customer WHERE active = 1 UNION", dialect=dialect
        )
    with pytest.raises(AccessDeniedError, match=r"\[WRITE_BLOCKED\]"):
        await enforce_select_only("ALTER TABLE customer ADD (x VARCHAR2(10)) )", dialect=dialect)
    with pytest.raises(AccessDeniedError, match=r"\[RISKY_SQL_BLOCKED\]"):
        await enforce_select_only("SELECT a FROM t WHERE b = 'x", dialect=dialect)


async def test_5_statement_level_codes():
    with pytest.raises(AccessDeniedError, match=r"\[FORBIDDEN_SQL_BLOCKED\]"):
        await enforce_select_only("SELECT a FROM t WHERE x = 1; SELECT 1")
    with pytest.raises(AccessDeniedError, match=r"\[WRITE_BLOCKED\]"):
        await enforce_select_only("SELECT a FROM t WHERE x = 1; DELETE FROM t")
    with pytest.raises(AccessDeniedError, match=r"\[WRITE_BLOCKED\]"):
        await enforce_select_only("WITH x AS (DELETE FROM film RETURNING *) SELECT * FROM x")
    with pytest.raises(AccessDeniedError, match=r"\[WRITE_BLOCKED\]"):
        await enforce_select_only("SELECT * INTO film_copy FROM film")


# ── 6. 모든 에러에 [CODE] 태그 ───────────────────────────────────────────────


async def test_6_too_many_tables_and_columns_tagged(mock_backend):
    from fastmcp.exceptions import ToolError

    from nl2sql_mcp.tools.search_columns import search_columns
    from nl2sql_mcp.tools.search_tables_schema import search_tables_schema

    with pytest.raises(ToolError, match=r"\[TOO_MANY_TABLES\]"):
        await search_tables_schema(pattern="%", limit=5)
    with pytest.raises(ToolError, match=r"\[TOO_MANY_COLUMNS\]"):
        await search_columns(column_pattern="%", limit=5)


@pytest.mark.parametrize(
    "sql",
    [
        "",
        "DELETE FROM film",
        "SELECT a FROM t WHERE x = 1; SELECT 1",
        "SELECT pg_sleep(1)",
        "SELECT email FROM customer WHERE active = 1",
        "SELECT rental_id FROM rental",
        "SELECT rental_id FROM rental WHERE rental_date >= DATE '2020-01-01'",
        "SELECT FROM WHERE",
    ],
)
async def test_6_guardrail_errors_have_code_tag(sql):
    import re

    with pytest.raises(Exception) as info:
        await _guard(sql)
    assert re.search(r"\[[A-Z_]+\]$", str(info.value)), str(info.value)


# ── 7. 날짜 조건이 LIMIT/FETCH FIRST, GROUP BY 앞에 들어감 ────────────────────


async def test_7_date_injection_before_row_limit_and_group_by():
    pg = await enforce_date_range(
        "SELECT customer_id, COUNT(*) FROM rental WHERE staff_id = 1 GROUP BY customer_id LIMIT 5",
        dialect=PG,
    )
    assert pg == (
        "SELECT customer_id, COUNT(*) FROM rental WHERE staff_id = 1 "
        "AND rental.rental_date >= CURRENT_DATE - INTERVAL '3 MONTHS' GROUP BY customer_id LIMIT 5"
    )
    ora = await enforce_date_range(
        "SELECT rental_id FROM rental WHERE staff_id = 1 FETCH FIRST 5 ROWS ONLY", dialect=ORA
    )
    assert ora == (
        "SELECT rental_id FROM rental WHERE staff_id = 1 "
        "AND rental.rental_date >= ADD_MONTHS(SYSDATE, -3) FETCH FIRST 5 ROWS ONLY"
    )


async def test_7_date_injection_without_where_and_with_or():
    sql = "SELECT r.rental_id FROM rental r WHERE r.staff_id = 1 OR r.staff_id = 2"
    out = await enforce_date_range(sql, dialect=PG)
    assert "WHERE (r.staff_id = 1 OR r.staff_id = 2) AND r.rental_date >=" in out


# ── 8. 날짜 컬럼이 여럿일 때 주입 대상이 결정적 ─────────────────────────────


@BOTH
async def test_8_injection_target_is_deterministic(dialect):
    sql = (
        "SELECT p.payment_id, r.rental_id, r.return_date, p.payment_date FROM rental r "
        "JOIN payment p ON p.rental_id = r.rental_id WHERE r.staff_id = 1"
    )
    results = {await enforce_date_range(sql, dialect=dialect) for _ in range(5)}
    assert len(results) == 1
    out = results.pop()
    assert "r.rental_date >=" in out  # FROM 의 첫 카탈로그 테이블(rental)의 기간 컬럼
    assert "p.payment_date >=" not in out


async def test_8_existing_date_condition_suppresses_injection():
    sql = "SELECT rental_id FROM rental WHERE return_date >= DATE '2026-09-01'"
    assert await enforce_date_range(sql, dialect=PG, today=TODAY) == sql
    is_null = "SELECT rental_id FROM rental WHERE return_date IS NULL"
    assert "rental.rental_date >=" in await enforce_date_range(is_null, dialect=PG)


async def test_8_date_column_catalog_setting():
    from nl2sql_mcp.date_catalog import resolve_date_columns

    assert resolve_date_columns("") == {"payment": "payment_date", "rental": "rental_date"}
    assert resolve_date_columns("public.Orders.Order_DT") == {"orders": "order_dt"}
    with pytest.raises(ValueError):
        resolve_date_columns("no_dot")


# ── 9. -- 주석으로 끝나는 SQL ───────────────────────────────────────────────


@BOTH
async def test_9_row_limit_not_inside_trailing_comment(dialect):
    sql = "SELECT customer_id FROM customer WHERE active = 1 -- 활성 고객;"
    out = await enforce_row_limit(sql, max_rows=10, dialect=dialect)
    tail = "LIMIT 11" if dialect is PG else "FETCH FIRST 11 ROWS ONLY"
    assert out == f"SELECT customer_id FROM customer WHERE active = 1 {tail}"


# ── 10. LIMIT 은 max_rows + 1, truncated 정확 ──────────────────────────────


@BOTH
async def test_10_limit_is_max_rows_plus_one_and_overrides_large_limit(dialect):
    sql = "SELECT film_id FROM film WHERE film_id > 0"
    out = await enforce_row_limit(sql, max_rows=3, dialect=dialect)
    assert out.endswith("LIMIT 4" if dialect is PG else "FETCH FIRST 4 ROWS ONLY")
    big = sql + (" LIMIT 5000" if dialect is PG else " FETCH FIRST 5000 ROWS ONLY")
    assert (await enforce_row_limit(big, max_rows=3, dialect=dialect)).endswith(
        "LIMIT 4" if dialect is PG else "FETCH FIRST 4 ROWS ONLY"
    )
    small = sql + (" LIMIT 2" if dialect is PG else " FETCH FIRST 2 ROWS ONLY")
    assert await enforce_row_limit(small, max_rows=3, dialect=dialect) == small


async def test_10_subquery_limit_does_not_count():
    sql = "SELECT film_id FROM (SELECT film_id FROM film WHERE film_id > 0 LIMIT 5000) f"
    assert (await enforce_row_limit(sql, max_rows=10)).endswith(") f LIMIT 11")


async def test_10_truncated_true_via_tool(mock_backend):
    from nl2sql_mcp.tools.run_sql_query import run_sql_query

    result = await run_sql_query(sql="SELECT film_id FROM film WHERE film_id > 0", max_rows=3)
    assert result.row_count == 3 and result.truncated is True
    exact = await run_sql_query(sql="SELECT film_id FROM film WHERE film_id > 0", max_rows=6)
    assert exact.row_count == 6 and exact.truncated is False


# ── 11. Postgres EXECUTE/COPY 는 문장 단위로만 차단 ─────────────────────────


async def test_11_columns_named_like_keywords_allowed():
    sql = "SELECT copy, execute, prepare, do FROM t WHERE copy = 1"
    assert await block_forbidden_constructs(sql, dialect=PG) == sql
    assert await enforce_select_only(sql, dialect=PG) == sql


@pytest.mark.parametrize(
    "sql",
    ["COPY film TO STDOUT", "EXECUTE customer_stmt(1)", "PREPARE p AS SELECT 1", "DO $$ BEGIN END $$"],
)
async def test_11_dynamic_statements_blocked(sql):
    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await enforce_select_only(sql, dialect=PG)
    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await block_forbidden_constructs(sql, dialect=PG)


# ── 12. numeric, 날짜 값 정규화 ─────────────────────────────────────────────


def test_12_normalize_values():
    from nl2sql_mcp.db.values import normalize_row

    row = [
        Decimal("4.99"),
        Decimal("16049"),
        Decimal("4.00"),
        Decimal("12345678901234567.89"),
        datetime.fromisoformat("2022-05-24T21:53:30+00:00"),
        date(2022, 2, 14),
        b"\x01\xff",
        [Decimal("1.5")],
    ]
    assert normalize_row(row) == [
        4.99,
        16049,
        4.0,
        "12345678901234567.89",
        "2022-05-24T21:53:30+00:00",
        "2022-02-14",
        "\\x01ff",
        [1.5],
    ]


async def test_12_mock_timestamps_are_iso_like_real_db():
    backend = MockBackend()
    result = await backend.execute_query("SELECT rental_date FROM rental WHERE rental_id = 1")
    assert result["rows"] == [["2022-05-24T21:53:30+00:00"]]


# ── 13. 뷰의 estimated_rows 는 0 이 아니라 None ─────────────────────────────


async def test_13_view_estimated_rows_is_none():
    backend = MockBackend()
    tables = {t["table_name"]: t for t in (await backend.search_tables("%", limit=50))["tables"]}
    assert tables["film_list"]["estimated_rows"] is None
    assert tables["rental_by_category"]["estimated_rows"] == 16  # 구체화 뷰는 통계가 있음
    assert tables["film"]["estimated_rows"] == 1000


# ── 14. Mock 보정 ───────────────────────────────────────────────────────────


async def test_14_mock_count_is_not_the_injected_limit():
    backend = MockBackend()
    result = await backend.execute_query("SELECT COUNT(*) FROM customer LIMIT 11", max_rows=10)
    assert result["rows"] == [[599]]
    filtered = await backend.execute_query("SELECT COUNT(*) AS n FROM customer WHERE store_id = 2")
    assert result["columns"] == ["count"] and filtered["columns"] == ["n"]
    assert filtered["rows"] == [[1]]


async def test_14_mock_group_by_uses_aliases_and_real_groups():
    backend = MockBackend()
    result = await backend.execute_query(
        "SELECT rating AS r, COUNT(*) AS n, MAX(length) AS longest FROM film "
        "WHERE film_id > 0 GROUP BY rating ORDER BY n DESC"
    )
    assert result["columns"] == ["r", "n", "longest"]
    assert result["rows"][0] == ["G", 3, 130]


async def test_14_mock_honors_where_limit_offset_and_oracle_labels():
    backend = MockBackend()
    rows = (await backend.execute_query("SELECT film_id FROM film WHERE rating = 'G' LIMIT 2"))["rows"]
    assert rows == [[2], [4]]
    rows = (await backend.execute_query("SELECT film_id FROM film WHERE film_id IN (1, 3, 5) OFFSET 1"))[
        "rows"
    ]
    assert rows == [[3], [5]]
    ora = MockBackend(dialect=ORA)
    result = await ora.execute_query("SELECT COUNT(*) FROM film FETCH FIRST 11 ROWS ONLY")
    assert result["columns"] == ["COUNT(*)"] and result["rows"] == [[1000]]


async def test_14_mock_union_and_distinct():
    backend = MockBackend()
    result = await backend.execute_query(
        "SELECT store_id FROM store WHERE store_id > 0 "
        "UNION SELECT store_id FROM inventory WHERE film_id = 1"
    )
    assert sorted(r[0] for r in result["rows"]) == [1, 2]


# ── 15. 작은 테이블은 WHERE 없이 허용 ───────────────────────────────────────


@BOTH
@pytest.mark.parametrize(
    "sql", ["SELECT * FROM film", "SELECT actor_id FROM actor", "SELECT COUNT(*) FROM customer"]
)
async def test_15_small_tables_allowed_without_where(dialect, sql):
    assert (await _guard(sql, dialect)).sql


@BOTH
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM rental",
        "SELECT COUNT(*) FROM payment",
        "SELECT customer_id, COUNT(*) FROM rental GROUP BY customer_id",
        "SELECT f.film_id FROM film f JOIN inventory i ON i.film_id = f.film_id "
        "JOIN rental r ON r.inventory_id = i.inventory_id",
    ],
)
async def test_15_large_tables_blocked_without_where(dialect, sql):
    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await _guard(sql, dialect)


async def test_15_unknown_row_count_and_threshold():
    # 추정 함수가 없으면 모르는 테이블 → 큰 테이블로 보고 차단
    with pytest.raises(AccessDeniedError, match="row count unknown"):
        await block_mass_scan("SELECT * FROM film")

    async def estimator(tables):
        return {t.name: 1000 for t in tables}

    assert await block_mass_scan("SELECT * FROM film", row_estimator=estimator) == "SELECT * FROM film"
    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await block_mass_scan("SELECT * FROM film", row_estimator=estimator, row_threshold=500)


async def test_15_subquery_and_cte_follow_outer_where():
    ok = "WITH x AS (SELECT rental_id, staff_id FROM rental) SELECT rental_id FROM x WHERE staff_id = 1"
    assert (await _guard(ok)).sql
    ok2 = "SELECT rental_id FROM (SELECT rental_id, staff_id FROM rental) r WHERE r.staff_id = 1"
    assert (await _guard(ok2)).sql


async def test_15_threshold_setting_via_tool(mock_backend, monkeypatch):
    from nl2sql_mcp.config import settings
    from nl2sql_mcp.tools.run_sql_query import run_sql_query

    assert (await run_sql_query(sql="SELECT film_id FROM film")).row_count > 0
    monkeypatch.setattr(settings, "guardrail_mass_scan_row_threshold", 100)
    with pytest.raises(AccessDeniedError, match="film"):
        await run_sql_query(sql="SELECT film_id FROM film")
