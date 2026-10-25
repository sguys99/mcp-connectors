"""테이블 인지형 PII 카탈로그(7.6) 테스트: 판정, 마스킹 계획, 결과 마스킹, 스키마 표시."""

from __future__ import annotations

import pytest

from _common.errors import AccessDeniedError
from nl2sql_mcp.db.dialects import get_dialect
from nl2sql_mcp.guardrails import analyze_pii, annotate_schema_pii, mask_pii_output
from nl2sql_mcp.guardrails.enforce_pii_control import PiiMaskPlan, mask_value
from nl2sql_mcp.pii_catalog import (
    PAGILA_PII_CATALOG,
    PiiAction,
    parse_pii_catalog,
    resolve_pii_catalog,
)
from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query
from nl2sql_mcp.tools.search_columns import search_columns

PG = get_dialect("postgres")
ORACLE = get_dialect("oracle")


# ── 카탈로그 정의와 설정 파싱 ────────────────────────────────────────────────


def test_actor_names_are_not_pii():
    assert ("actor", "first_name") not in PAGILA_PII_CATALOG
    assert ("actor", "last_name") not in PAGILA_PII_CATALOG
    assert PAGILA_PII_CATALOG[("customer", "first_name")] is PiiAction.BLOCK
    assert PAGILA_PII_CATALOG[("staff", "first_name")] is PiiAction.MASK


def test_parse_pii_catalog_format():
    catalog = parse_pii_catalog(" Member.EMAIL:block , public.member.nick:MASK, t.c ")
    assert catalog == {
        ("member", "email"): PiiAction.BLOCK,
        ("member", "nick"): PiiAction.MASK,
        ("t", "c"): PiiAction.BLOCK,
    }


@pytest.mark.parametrize("raw", ["email", "t.c:hide", ".c"])
def test_parse_pii_catalog_rejects_bad_items(raw):
    with pytest.raises(ValueError):
        parse_pii_catalog(raw)


def test_resolve_pii_catalog_default_and_override():
    assert resolve_pii_catalog("") == PAGILA_PII_CATALOG
    assert resolve_pii_catalog("a.b:mask") == {("a", "b"): PiiAction.MASK}


def test_settings_validates_pii_catalog_raw():
    from pydantic import ValidationError

    from nl2sql_mcp.config import Settings

    with pytest.raises(ValidationError):
        Settings(pii_catalog_raw="no_dot_here")
    assert Settings(pii_catalog_raw="x.y").pii_catalog == {("x", "y"): PiiAction.BLOCK}


# ── 입력 판정 (block) ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT email FROM customer WHERE active = 1",
        "SELECT c.email FROM customer c WHERE c.active = 1",
        "SELECT public.customer.email FROM public.customer WHERE active = 1",
        "SELECT COUNT(email) FROM customer WHERE active = 1",
        "SELECT * FROM customer WHERE active = 1",
        "SELECT c.* FROM customer c WHERE c.active = 1",
        "SELECT c.customer_id, a.phone FROM customer c JOIN address a ON c.address_id = a.address_id",
        "WITH x AS (SELECT email AS e FROM customer) SELECT e FROM x",
        "SELECT t.e FROM (SELECT email AS e FROM customer) t",
        "SELECT (SELECT MAX(email) FROM customer) AS m FROM film WHERE film_id = 1",
        "SELECT first_name FROM actor a JOIN customer c ON a.actor_id = c.customer_id",
        "SELECT password FROM staff WHERE staff_id = 1",
        "SELECT name FROM customer_list WHERE sid = 1",
    ],
)
def test_block_columns_rejected(sql):
    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        analyze_pii(sql, dialect=PG)


def test_block_message_names_table_and_column():
    with pytest.raises(AccessDeniedError, match=r"customer\.email"):
        analyze_pii("SELECT c.email FROM customer c", dialect=PG)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT first_name, last_name FROM actor WHERE actor_id < 5",
        "SELECT a.first_name FROM actor a JOIN film_actor fa ON a.actor_id = fa.actor_id",
        "SELECT * FROM film WHERE film_id = 1",
        "WITH cte AS (SELECT customer_id FROM customer WHERE active = 1) SELECT * FROM cte",
        "SELECT customer_id FROM customer WHERE email = 'a@b.com'",
        "SELECT p.payment_id, p.staff_id AS email FROM payment p WHERE p.amount > 1",
        "SELECT customer_id FROM payment WHERE customer_id IN "
        "(SELECT customer_id FROM customer WHERE email LIKE 'a%')",
        "SELECT customer_id FROM customer WHERE active = 1 ORDER BY last_name",
    ],
)
def test_non_pii_projection_passes(sql):
    assert not analyze_pii(sql, dialect=PG)


def test_oracle_uppercase_identifiers():
    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        analyze_pii("SELECT C.EMAIL FROM CUSTOMER C WHERE C.ACTIVE = 1", dialect=ORACLE)
    assert not analyze_pii("SELECT FIRST_NAME FROM ACTOR WHERE ACTOR_ID = 1", dialect=ORACLE)


def test_custom_catalog_replaces_default():
    catalog = {("actor", "first_name"): PiiAction.BLOCK}
    with pytest.raises(AccessDeniedError):
        analyze_pii("SELECT first_name FROM actor WHERE actor_id = 1", pii_catalog=catalog, dialect=PG)
    assert not analyze_pii(
        "SELECT email FROM customer WHERE active = 1", pii_catalog=catalog, dialect=PG
    )


# ── 마스킹 계획 (mask) ───────────────────────────────────────────────────────


def test_mask_plan_positions_and_aliases():
    plan = analyze_pii(
        "SELECT s.staff_id, s.username, s.first_name AS fn FROM staff s WHERE s.store_id = 1",
        dialect=PG,
    )
    assert plan.indices == {1, 2}
    assert plan.names == {"username", "fn"}


def test_mask_plan_through_derived_table_and_cte():
    plan = analyze_pii("SELECT t.x FROM (SELECT username AS x FROM staff) t", dialect=PG)
    assert plan.indices == {0}
    plan = analyze_pii("WITH x AS (SELECT last_name AS ln FROM staff) SELECT ln FROM x", dialect=PG)
    assert plan.indices == {0}


def test_mask_plan_for_star_uses_names():
    plan = analyze_pii("SELECT * FROM sales_by_store", dialect=PG)
    assert plan.indices == frozenset()
    assert plan.names == {"manager"}


def test_mask_value_keeps_first_character():
    assert mask_value("Mike") == "M***"
    assert mask_value("J") == "***"
    assert mask_value(12345) == "***"
    assert mask_value(None) is None


def test_mask_pii_output_applies_plan_and_regex():
    rows = [[1, "Mike", "call 010-1234-5678"], [2, None, "plain"]]
    plan = PiiMaskPlan(indices=frozenset({1}))
    masked, cols = mask_pii_output(rows, ["staff_id", "username", "memo"], plan)
    assert masked == [[1, "M***", "call 010-****-****"], [2, None, "plain"]]
    assert cols == ["username", "memo"]


# ── 스키마 도구 표시 ─────────────────────────────────────────────────────────


def test_annotate_schema_pii():
    cols = [{"name": "email"}, {"name": "username"}, {"name": "staff_id"}]
    annotate_schema_pii(cols, "public.staff")
    assert [c["pii"] for c in cols] == ["block", "mask", None]


async def test_get_table_schema_marks_pii(mock_backend):
    result = (await get_table_schema(table_name="customer")).model_dump()
    pii = {c["name"]: c["pii"] for c in result["columns"]}
    assert pii["email"] == "block"
    assert pii["customer_id"] is None
    actor = (await get_table_schema(table_name="actor")).model_dump()
    assert all(c["pii"] is None for c in actor["columns"])


async def test_search_columns_marks_pii_per_table(mock_backend):
    result = (await search_columns(column_pattern="first_name")).model_dump()
    pii = {c["table_name"]: c["pii"] for c in result["columns"]}
    assert pii == {"actor": None, "customer": "block", "staff": "mask", "actor_info": None}


# ── run_sql_query 연동 (Mock) ────────────────────────────────────────────────


async def test_run_sql_query_actor_names_not_masked(mock_backend):
    result = (
        await run_sql_query(sql="SELECT actor_id, first_name, last_name FROM actor WHERE actor_id < 6")
    ).model_dump()
    assert result["rows"][0] == [1, "PENELOPE", "GUINESS"]
    assert result["masked_columns"] == []


async def test_run_sql_query_masks_catalog_mask_columns(mock_backend):
    result = (
        await run_sql_query(sql="SELECT staff_id, username FROM staff WHERE store_id = 1")
    ).model_dump()
    assert result["rows"] == [[1, "M***"]]  # Mock 은 store_id = 1 조건을 샘플 행에 적용합니다
    assert result["masked_columns"] == ["username"]


async def test_run_sql_query_blocks_customer_email(mock_backend):
    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        await run_sql_query(sql="SELECT email FROM customer WHERE active = 1")
