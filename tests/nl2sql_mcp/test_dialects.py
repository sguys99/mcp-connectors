"""SQL dialect 어댑터 단위 테스트 (postgres 기본, oracle)."""

from __future__ import annotations

from datetime import date, datetime

import pytest

from _common.errors import AccessDeniedError
from nl2sql_mcp.db.dialects import (
    OracleDialect,
    PostgresDialect,
    SQLDialect,
    get_dialect,
)

PG = get_dialect("postgres")
ORA = get_dialect("oracle")


# ──────────────────────────── 선택 ────────────────────────────


def test_get_dialect_by_name_and_alias():
    assert isinstance(get_dialect("postgres"), PostgresDialect)
    assert isinstance(get_dialect("PostgreSQL"), PostgresDialect)
    assert isinstance(get_dialect(" oracle "), OracleDialect)
    assert get_dialect("postgres") is get_dialect("pg")  # 인스턴스 캐시


def test_get_dialect_unknown_raises():
    with pytest.raises(ValueError, match="NL2SQL_DB_DIALECT"):
        get_dialect("mysql")


def test_get_dialect_defaults_to_settings(monkeypatch):
    from nl2sql_mcp.config import settings

    monkeypatch.setattr(settings, "nl2sql_db_dialect", "oracle")
    assert get_dialect().name == "oracle"
    monkeypatch.setattr(settings, "nl2sql_db_dialect", "postgres")
    assert get_dialect().name == "postgres"


def test_settings_default_is_postgres_mock(monkeypatch):
    from nl2sql_mcp.config import Settings

    for key in ("NL2SQL_DB_DIALECT", "NL2SQL_DB_BACKEND"):
        monkeypatch.delenv(key, raising=False)
    s = Settings(_env_file=None)
    assert s.nl2sql_db_dialect == "postgres"
    assert s.nl2sql_db_backend == "mock"


def test_settings_reads_prefixed_env(monkeypatch):
    from nl2sql_mcp.config import Settings

    monkeypatch.setenv("NL2SQL_DB_DIALECT", "oracle")
    monkeypatch.setenv("NL2SQL_PG_HOST", "db.internal")
    monkeypatch.setenv("NL2SQL_ORACLE_SERVICE", "PAGILA")
    s = Settings(_env_file=None)
    assert s.nl2sql_db_dialect == "oracle"
    assert s.nl2sql_pg_host == "db.internal"
    assert s.nl2sql_oracle_service == "PAGILA"


def test_settings_rejects_unknown_dialect(monkeypatch):
    from pydantic import ValidationError

    from nl2sql_mcp.config import Settings

    monkeypatch.setenv("NL2SQL_DB_DIALECT", "sqlite")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


# ──────────────────────────── 행 수 제한 ────────────────────────────


@pytest.mark.parametrize(
    ("dialect", "expected"),
    [
        (PG, "SELECT a FROM t WHERE x = 1 LIMIT 50"),
        (ORA, "SELECT a FROM t WHERE x = 1 FETCH FIRST 50 ROWS ONLY"),
    ],
)
def test_apply_row_limit(dialect: SQLDialect, expected: str):
    assert dialect.apply_row_limit("SELECT a FROM t WHERE x = 1 ; ", 50) == expected


@pytest.mark.parametrize(
    ("dialect", "sql", "value"),
    [
        (PG, "SELECT a FROM t WHERE x = 1 LIMIT 7", 7),
        (PG, "select a from t where x = 1 limit 7 offset 3", 7),
        (PG, "SELECT a FROM t WHERE x = 1 FETCH FIRST 9 ROWS ONLY", 9),
        (PG, "SELECT a FROM t WHERE x = 1", None),
        (ORA, "SELECT a FROM t WHERE x = 1 FETCH FIRST 9 ROWS ONLY", 9),
        (ORA, "SELECT a FROM t WHERE ROWNUM <= 5", 5),
        (ORA, "SELECT a FROM t WHERE ROWNUM < 5", 4),
        (ORA, "SELECT a FROM t WHERE x = 1 LIMIT 7", None),
    ],
)
def test_extract_row_limit(dialect: SQLDialect, sql: str, value: int | None):
    assert dialect.extract_row_limit(sql) == value
    assert dialect.has_row_limit(sql) is (value is not None)


def test_oracle_rownum_greater_than_counts_as_limit():
    # 기존 동작 유지: ROWNUM 비교가 있으면 제한이 있다고 본다
    assert ORA.has_row_limit("SELECT a FROM t WHERE ROWNUM > 0")


@pytest.mark.parametrize(
    ("dialect", "sql", "body", "tail"),
    [
        (PG, "SELECT a FROM t WHERE x = 1 LIMIT 10;", "SELECT a FROM t WHERE x = 1", "LIMIT 10"),
        (PG, "SELECT a FROM t LIMIT 10 OFFSET 5", "SELECT a FROM t", "LIMIT 10 OFFSET 5"),
        (PG, "SELECT a FROM t FETCH FIRST 3 ROWS ONLY", "SELECT a FROM t", "FETCH FIRST 3 ROWS ONLY"),
        (PG, "SELECT a FROM t WHERE x = 1", "SELECT a FROM t WHERE x = 1", ""),
        (ORA, "SELECT a FROM t FETCH FIRST 3 ROWS ONLY", "SELECT a FROM t", "FETCH FIRST 3 ROWS ONLY"),
        (
            ORA,
            "SELECT a FROM t OFFSET 2 ROWS FETCH NEXT 3 ROWS ONLY",
            "SELECT a FROM t",
            "OFFSET 2 ROWS FETCH NEXT 3 ROWS ONLY",
        ),
    ],
)
def test_split_trailing_row_limit(dialect: SQLDialect, sql: str, body: str, tail: str):
    assert dialect.split_trailing_row_limit(sql) == (body, tail)


async def test_enforce_row_limit_uses_dialect():
    from nl2sql_mcp.guardrails.enforce_row_limit import enforce_row_limit

    # truncated 판정을 위해 max_rows + 1 을 주입합니다
    sql = "SELECT customer_id FROM customer WHERE active = 1"
    assert await enforce_row_limit(sql, max_rows=100, dialect=PG) == f"{sql} LIMIT 101"
    oracle_sql = await enforce_row_limit(sql, max_rows=100, dialect=ORA)
    assert oracle_sql.endswith("FETCH FIRST 101 ROWS ONLY")
    # 상한 클램핑 (max_limit 10000 + 1)
    assert (await enforce_row_limit(sql, max_rows=99999, dialect=PG)).endswith("LIMIT 10001")
    # 이미 제한이 있으면 그대로
    limited = f"{sql} LIMIT 5"
    assert await enforce_row_limit(limited, dialect=PG) == limited


async def test_enforce_row_limit_default_dialect_is_postgres():
    from nl2sql_mcp.guardrails.enforce_row_limit import enforce_row_limit

    result = await enforce_row_limit("SELECT a FROM t WHERE x = 1", max_rows=10)
    assert result.endswith("LIMIT 11")


# ──────────────────────────── 날짜 ────────────────────────────


def test_date_literal_and_functions():
    d = date(2026, 1, 31)
    assert PG.render_date_literal(d) == "DATE '2026-01-31'"
    assert ORA.render_date_literal(datetime(2026, 1, 31, 12)) == "DATE '2026-01-31'"
    assert PG.current_date_expr() == "CURRENT_DATE"
    assert ORA.current_date_expr() == "SYSDATE"
    assert PG.months_ago_expr(3) == "CURRENT_DATE - INTERVAL '3 months'"
    assert ORA.months_ago_expr(3) == "ADD_MONTHS(SYSDATE, -3)"


def test_postgres_extracts_cast_and_timestamp_literals():
    text = (
        "WHERE a >= DATE '2024-01-01' AND b < '2024-03-01'::date AND c < CAST('2024-05-01' AS DATE) "
        "AND d > TIMESTAMP '2024-07-01 00:00:00' AND e < to_date('2024-09-01', 'YYYY-MM-DD')"
    )
    months = sorted(d.month for d in PG.extract_dates(text))
    assert months == [1, 3, 5, 7, 9]


def test_oracle_extracts_date_and_to_date():
    text = "WHERE a >= DATE '2024-01-01' AND b < TO_DATE('2024-03-01', 'YYYY-MM-DD')"
    assert [d.month for d in ORA.extract_dates(text)] == [1, 3]


async def test_enforce_date_range_injects_dialect_expression():
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    sql = "SELECT rental_id FROM rental WHERE customer_id = 1"
    pg = await enforce_date_range(sql, date_columns=["rental_date"], default_months=2, dialect=PG)
    ora = await enforce_date_range(sql, date_columns=["rental_date"], default_months=2, dialect=ORA)
    assert pg.endswith("AND rental_date >= CURRENT_DATE - INTERVAL '2 MONTHS'")
    assert ora.endswith("AND rental_date >= ADD_MONTHS(SYSDATE, -2)")


async def test_enforce_date_range_postgres_detects_cast_span():
    """Postgres 파서는 DATE 리터럴을 CAST 로 다시 쓰므로 CAST 형태도 범위 검사에 잡혀야 한다."""
    from _common.errors import InvalidInputError
    from nl2sql_mcp.guardrails.enforce_date_range import enforce_date_range

    sql = (
        "SELECT payment_id FROM payment "
        "WHERE payment_date >= '2024-01-01'::date AND payment_date < DATE '2025-06-01'"
    )
    with pytest.raises(InvalidInputError, match="DATE_RANGE_EXCEEDED"):
        await enforce_date_range(sql, max_months=12, dialect=PG)


# ──────────────────────────── 차단 목록 ────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT relname FROM pg_catalog.pg_class WHERE relkind = 'r'",
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        "SELECT usename FROM pg_shadow WHERE usesysid > 0",
        "SELECT rolname FROM pg_roles WHERE rolsuper",
        "SELECT a FROM dblink('dbname=x', 'SELECT 1') AS t(a int) WHERE a > 0",
        "SELECT /*+ SeqScan(customer) */ customer_id FROM customer WHERE active = 1",
        "SELECT a FROM t WHERE x = 1; SELECT 1",
    ],
)
async def test_postgres_forbidden_constructs(sql: str):
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await block_forbidden_constructs(sql, dialect=PG)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT customer_id FROM customer WHERE email = 'a@b.com'",  # Postgres 에는 @dblink 가 없음
        "SELECT /*+ IndexScan(p idx) */ payment_id FROM payment p WHERE staff_id = 1",
        "SELECT customer_id FROM customer WHERE active = 1 LIMIT 5;",  # 후행 세미콜론
    ],
)
async def test_postgres_forbidden_allows_safe_sql(sql: str):
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    assert await block_forbidden_constructs(sql, dialect=PG) == sql


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT customer_id FROM customer@remote WHERE customer_id = 1",
        "SELECT DUMMY FROM SYS.DUAL",
        "SELECT DBMS_OUTPUT.GET_LINE(1, 1) FROM DUAL",
        "SELECT /*+ FULL(customer) */ customer_id FROM customer WHERE active = 1",
    ],
)
async def test_oracle_forbidden_constructs_kept(sql: str):
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    with pytest.raises(AccessDeniedError, match="FORBIDDEN_SQL_BLOCKED"):
        await block_forbidden_constructs(sql, dialect=ORA)


async def test_oracle_rules_do_not_apply_to_postgres():
    from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs

    sql = "SELECT customer_id FROM customer WHERE note = 1 AND x = SYS.dual_x"
    # Postgres 에서 SYS. 는 의미가 없으므로 통과하고, Oracle 은 시스템 스키마로 막는다
    assert await block_forbidden_constructs(sql, dialect=PG) == sql
    with pytest.raises(AccessDeniedError):
        await block_forbidden_constructs(sql, dialect=ORA)
    # 문자열 리터럴 안의 SYS./DBMS_ 는 어느 dialect 에서도 오탐하지 않는다 (P2-6)
    literal = "SELECT customer_id FROM customer WHERE note = 'SYS.x DBMS_y'"
    assert await block_forbidden_constructs(literal, dialect=ORA) == literal


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT pg_ls_dir('.')",
        "SELECT pg_sleep(10)",
        "SELECT pg_terminate_backend(123)",
        "SELECT lo_export(16385, '/tmp/x')",
        "SELECT query_to_xml('SELECT 1', true, false, '')",
        "SELECT set_config('statement_timeout', '0', false)",
    ],
)
async def test_postgres_risky_functions(sql: str):
    from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql

    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(sql, dialect=PG)


async def test_risky_functions_are_dialect_specific():
    from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql

    ora_sql = "SELECT UTL_FILE.GET_LINE(1, 1) FROM DUAL"
    with pytest.raises(AccessDeniedError, match="RISKY_SQL_BLOCKED"):
        await detect_risky_sql(ora_sql, dialect=ORA)
    assert await detect_risky_sql(ora_sql, dialect=PG) == ora_sql
    assert await detect_risky_sql("SELECT pg_sleep(1)", dialect=ORA) == "SELECT pg_sleep(1)"


# ──────────────────────────── 카탈로그 SQL ────────────────────────────


def test_postgres_catalog_sql():
    cat = PG.catalog
    assert "pg_catalog.pg_class" in cat.search_tables
    assert "ILIKE %(pattern)s" in cat.search_tables
    assert "LIMIT %(lim)s" in cat.search_tables
    # 시스템 스키마는 검색에서 제외
    assert "'pg_catalog','information_schema','pg_toast'" in cat.search_tables
    assert "format_type" in cat.columns
    assert "contype = 'p'" in cat.primary_key
    assert "contype = 'f'" in cat.foreign_keys
    for sql in (cat.columns, cat.primary_key, cat.foreign_keys, cat.table_meta_with_owner):
        assert "%(owner)s" in sql and "%(tname)s" in sql
    assert ":pattern" not in cat.search_tables


def test_oracle_catalog_sql():
    cat = ORA.catalog
    assert "all_tables" in cat.search_tables
    assert "LIKE :pattern" in cat.search_tables
    assert "FETCH FIRST :lim ROWS ONLY" in cat.search_tables
    assert "'SYS','SYSTEM'" in cat.search_tables
    assert "all_cons_columns" in cat.foreign_keys
    assert "%(" not in cat.columns


def test_fold_identifier():
    assert PG.fold_identifier("Customer") == "customer"
    assert ORA.fold_identifier("Customer") == "CUSTOMER"


@pytest.mark.parametrize("dialect", [PG, ORA])
def test_sqlglot_dialect_parses_pagila_select(dialect: SQLDialect):
    import sqlglot

    stmt = sqlglot.parse_one(
        "SELECT payment_id FROM payment WHERE payment_date >= DATE '2026-01-01'",
        dialect=dialect.sqlglot_name,
    )
    assert stmt.find(sqlglot.exp.Where) is not None


# ──────────────────────────── 백엔드 팩토리 ────────────────────────────


async def test_get_backend_mock_carries_dialect(monkeypatch):
    from nl2sql_mcp.config import settings
    from nl2sql_mcp.db import get_backend
    from nl2sql_mcp.db.mock_backend import MockBackend

    monkeypatch.setattr(settings, "nl2sql_db_backend", "mock")
    monkeypatch.setattr(settings, "nl2sql_db_dialect", "oracle")
    backend = await get_backend()
    assert isinstance(backend, MockBackend)
    assert backend.dialect.name == "oracle"


async def test_get_backend_real_postgres_does_not_need_oracledb(monkeypatch):
    import sys

    from nl2sql_mcp.config import settings
    from nl2sql_mcp.db import get_backend
    from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager

    monkeypatch.setattr(settings, "nl2sql_db_backend", "real")
    monkeypatch.setattr(settings, "nl2sql_db_dialect", "postgres")
    backend = await get_backend()
    assert isinstance(backend, PostgresConnectionManager)
    assert "nl2sql_mcp.db.oracle_connector" not in sys.modules
