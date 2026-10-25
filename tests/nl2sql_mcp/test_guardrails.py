"""nl2sql_mcp 가드레일 단위 테스트.

Oracle 문법을 직접 확인하는 케이스는 ``ORACLE`` dialect 를 명시합니다.
dialect 별 차이는 test_dialects.py 에서 다룹니다.
"""

from __future__ import annotations

import asyncio

import pytest

from _common.errors import AccessDeniedError, BackendUnavailableError, InvalidInputError
from nl2sql_mcp.db.dialects import get_dialect

ORACLE = get_dialect("oracle")

# ──────────────────────────── 7.1 enforce_select_only ────────────────────────────


async def test_delete_write_blocked():
    """DELETE 문 → WRITE_BLOCKED."""
    from nl2sql_mcp.guardrails.enforce_select_only import enforce_select_only

    with pytest.raises(AccessDeniedError, match="WRITE_BLOCKED"):
        await enforce_select_only("DELETE FROM customer WHERE customer_id = 1")


async def test_valid_select_passes():
    """유효한 SELECT → 원본 SQL 반환."""
    from nl2sql_mcp.guardrails.enforce_select_only import enforce_select_only

    sql = "SELECT customer_id FROM customer WHERE customer_id = 1"
    assert await enforce_select_only(sql) == sql


# ──────────────────────────── 7.2 enforce_date_range ─────────────────────────────


async def test_date_range_exceeded():
    """DATE 리터럴로 13개월 기간 조건 → DATE_RANGE_EXCEEDED."""
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    # 구현은 DATE '...' / TO_DATE('...') 리터럴 2개의 span을 계산한다
    sql = (
        "SELECT * FROM payment "
        "WHERE payment_date >= DATE '2024-01-01' AND payment_date < DATE '2025-03-01'"
    )
    with pytest.raises(InvalidInputError, match="DATE_RANGE_EXCEEDED"):
        await enforce_date_range(sql, date_columns=["PAYMENT_DATE"], max_months=12)


async def test_date_range_auto_inject():
    """기간 미지정 SELECT → default_months(3) 조건 자동 주입."""
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    sql = "SELECT * FROM payment WHERE customer_id = 1"
    result = await enforce_date_range(
        sql, date_columns=["PAYMENT_DATE"], default_months=3, dialect=ORACLE
    )
    assert "ADD_MONTHS" in result.upper()


# ──────────────────────────── 7.3 enforce_row_limit ──────────────────────────────


async def test_row_limit_fetch_injected():
    """(Oracle) 행 수 제한 없는 SELECT → FETCH FIRST 1001 ROWS ONLY 자동 주입 (truncated 판정용 +1)."""
    from nl2sql_mcp.guardrails.enforce_row_limit import enforce_row_limit

    sql = "SELECT * FROM customer WHERE customer_id = 1"
    result = await enforce_row_limit(sql, max_rows=1000, dialect=ORACLE)
    upper = result.upper()
    assert "FETCH FIRST" in upper
    assert "1001" in result


# ──────────────────────────── 7.4 enforce_timeout ────────────────────────────────


async def test_timeout_query_timeout():
    """쿼리 실행 타임아웃 초과 → QUERY_TIMEOUT."""
    from nl2sql_mcp.guardrails.enforce_timeout import enforce_timeout

    async def slow():
        await asyncio.sleep(10)

    with pytest.raises(BackendUnavailableError, match="QUERY_TIMEOUT"):
        await enforce_timeout(slow(), timeout_sec=0.01)


# ──────────────────────── 7.5 block_forbidden_constructs ─────────────────────────


async def test_dblink_forbidden_blocked():
    """DBLINK(@) 포함 SQL → FORBIDDEN_SQL_BLOCKED."""
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    sql = "SELECT * FROM customer@REMOTE WHERE customer_id = 1"
    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await block_forbidden_constructs(sql, enabled=True, dialect=ORACLE)


async def test_dblink_disabled_passes():
    """enabled=False 상태의 DBLINK → 통과."""
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    sql = "SELECT * FROM customer@REMOTE WHERE customer_id = 1"
    assert await block_forbidden_constructs(sql, enabled=False) == sql


# ──────────────────────────── 7.6 enforce_pii_control ────────────────────────────


async def test_pii_column_direct_select_blocked():
    """PII 컬럼(EMAIL) 직접 SELECT → PII_COLUMN_BLOCKED."""
    from nl2sql_mcp.guardrails.enforce_pii_control import enforce_pii_input

    sql = "SELECT email FROM customer WHERE customer_id = 1"
    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        await enforce_pii_input(sql)


def test_pii_output_number_pattern_masked():
    """결과 행에 카드번호 패턴 → 마스킹 반환."""
    from nl2sql_mcp.guardrails.enforce_pii_control import mask_pii_output

    rows = [["1234-5678-9012-3456", "홍길동"]]
    masked_rows, masked_columns = mask_pii_output(rows, ["card_no", "name"])
    assert "1234-5678-9012-3456" not in str(masked_rows[0][0])
    assert masked_columns == ["card_no"]


# ──────────────────────────── 7.7 block_mass_scan ────────────────────────────────


async def test_no_where_mass_scan_blocked():
    """WHERE 절 없는 전체 조회 → MASS_SCAN_BLOCKED."""
    from nl2sql_mcp.guardrails.block_mass_scan import block_mass_scan

    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await block_mass_scan("SELECT * FROM customer")


async def test_tautology_where_blocked():
    """WHERE 1=1 무력화 조건 → MASS_SCAN_BLOCKED."""
    from nl2sql_mcp.guardrails.block_mass_scan import block_mass_scan

    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await block_mass_scan("SELECT * FROM customer WHERE 1=1")


async def test_cartesian_join_blocked():
    """ON/WHERE 없는 카티시안 조인 → MASS_SCAN_BLOCKED."""
    from nl2sql_mcp.guardrails.block_mass_scan import block_mass_scan

    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await block_mass_scan("SELECT * FROM customer, payment")


# ──────────────────────────── 7.9 detect_risky_sql ───────────────────────────────


async def test_union_injection_blocked():
    """UNION 으로 시스템 카탈로그를 읽는 SQL Injection → RISKY_SQL_BLOCKED (dialect 별)."""
    from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql

    sql = "SELECT customer_id FROM customer WHERE customer_id = 1 UNION SELECT PASSWORD FROM SYS.USER$"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(sql, enabled=True, dialect=ORACLE)
    pg_sql = "SELECT customer_id FROM customer WHERE customer_id = 1 UNION SELECT usename FROM pg_shadow"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(pg_sql, enabled=True)


async def test_risky_sql_disabled_passes():
    """enabled=False + UNION injection → 통과."""
    from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql

    sql = "SELECT customer_id FROM customer WHERE customer_id = 1 UNION SELECT PASSWORD FROM SYS.USER$"
    assert await detect_risky_sql(sql, enabled=False) == sql


# ──────────────────────────── Pagila PII 카탈로그 / 날짜 컬럼 ────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT first_name FROM customer WHERE customer_id = 1",
        "SELECT last_name FROM customer WHERE customer_id = 1",
        "SELECT phone FROM address WHERE address_id = 1",
        "SELECT address FROM address WHERE address_id = 1",
        "SELECT password FROM staff WHERE staff_id = 1",
        "SELECT COUNT(email) FROM customer WHERE active = 1",
    ],
)
async def test_pii_pagila_columns_blocked(sql):
    """Pagila PII 컬럼(이름, 전화번호, 주소, 비밀번호 등) 직접 SELECT → PII_COLUMN_BLOCKED."""
    from nl2sql_mcp.config import settings
    from nl2sql_mcp.guardrails.enforce_pii_control import enforce_pii_input

    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        await enforce_pii_input(sql, pii_catalog=settings.pii_catalog)


async def test_pii_non_pii_columns_pass():
    """PII 가 아닌 컬럼(customer_id, store_id, active)과 WHERE 의 email 사용 → 통과."""
    from nl2sql_mcp.config import settings
    from nl2sql_mcp.guardrails.enforce_pii_control import enforce_pii_input

    sql = "SELECT customer_id, store_id, active FROM customer WHERE email = 'a@b.com'"
    assert await enforce_pii_input(sql, pii_catalog=settings.pii_catalog) == sql


def test_pii_output_phone_digits_masked():
    """Pagila 형식(하이픈 없는 11자리) 전화번호 값 → 마스킹."""
    from nl2sql_mcp.guardrails.enforce_pii_control import mask_pii_output

    masked_rows, masked_columns = mask_pii_output([["28303384290"]], ["phone"])
    assert masked_rows[0][0] == "*" * 11
    assert masked_columns == ["phone"]


async def test_date_range_auto_inject_rental_date():
    """rental_date 는 `_DATE` 접미사 휴리스틱으로 감지되어 기간 조건이 주입된다."""
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    sql = "SELECT rental_id, rental_date FROM rental WHERE customer_id = 1"
    result = await enforce_date_range(sql, default_months=3, dialect=ORACLE)
    assert "RENTAL_DATE >= ADD_MONTHS(SYSDATE, -3)" in result.upper()


async def test_date_range_skipped_without_date_column():
    """날짜 컬럼이 없는 대형 테이블(inventory)은 SQL 을 변경하지 않는다."""
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    sql = "SELECT inventory_id, film_id FROM inventory WHERE store_id = 1"
    assert await enforce_date_range(sql) == sql
