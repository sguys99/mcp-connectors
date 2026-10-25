"""테이블 인지형 PII(7.6)와 감사 로그(7.8)를 실 Pagila 샘플 DB 에서 확인합니다."""

from __future__ import annotations

import sqlite3

import pytest

from _common.errors import AccessDeniedError
from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query

pytestmark = pytest.mark.integration


async def test_actor_names_are_returned_unmasked(real_backend):
    result = await run_sql_query(
        sql="SELECT actor_id, first_name, last_name FROM actor WHERE actor_id <= 2 ORDER BY actor_id"
    )
    assert result.rows == [[1, "PENELOPE", "GUINESS"], [2, "NICK", "WAHLBERG"]]
    assert result.masked_columns == []


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT customer_id, email FROM customer WHERE store_id = 1",
        "SELECT c.first_name FROM customer c JOIN rental r ON c.customer_id = r.customer_id "
        "WHERE r.rental_date >= DATE '2022-06-01'",
        "SELECT * FROM customer WHERE customer_id = 1",
        "SELECT a.phone FROM store s JOIN address a ON s.address_id = a.address_id WHERE s.store_id = 1",
        "SELECT password FROM staff WHERE staff_id = 1",
    ],
)
async def test_block_columns_rejected_before_db(real_backend, sql):
    with pytest.raises(AccessDeniedError, match="PII_COLUMN_BLOCKED"):
        await run_sql_query(sql=sql)


async def test_staff_mask_columns_are_masked(real_backend):
    result = await run_sql_query(
        sql="SELECT staff_id, first_name, username FROM staff WHERE staff_id IN (1, 2) ORDER BY staff_id"
    )
    assert [r[0] for r in result.rows] == [1, 2]
    for _, first_name, username in result.rows:
        assert first_name.endswith("***") and len(first_name) == 4
        assert username.endswith("***") and len(username) == 4
    assert result.masked_columns == ["first_name", "username"]


async def test_mask_through_join_alias(real_backend):
    result = await run_sql_query(
        sql="SELECT s.store_id, m.last_name AS manager FROM store s "
        "JOIN staff m ON s.manager_staff_id = m.staff_id WHERE s.store_id = 1"
    )
    assert result.rows == [[1, "H***"]]
    assert result.masked_columns == ["manager"]


async def test_pii_column_allowed_in_where(real_backend):
    result = await run_sql_query(
        sql="SELECT customer_id FROM customer WHERE email = 'MARY.SMITH@sakilacustomer.org'"
    )
    assert result.rows == [[1]]


async def test_schema_marks_pii_on_real_catalog(real_backend):
    staff = await get_table_schema(table_name="staff")
    pii = {c.name: c.pii for c in staff.columns}
    assert pii["password"] == "block"
    assert pii["username"] == "mask"
    assert pii["staff_id"] is None


async def test_audit_rows_for_real_backend(real_backend, audit_db):
    await run_sql_query(sql="SELECT film_id FROM film WHERE film_id < 3")
    with pytest.raises(AccessDeniedError):
        await run_sql_query(sql="SELECT email FROM customer WHERE customer_id = 1")
    conn = sqlite3.connect(audit_db)
    rows = conn.execute(
        "SELECT result_status, error_type, row_count, latency_ms FROM audit_log ORDER BY id"
    ).fetchall()
    conn.close()
    assert rows[0][:3] == ("success", None, 2)
    assert rows[0][3] > 0
    assert rows[1][:2] == ("blocked", "PII_COLUMN_BLOCKED")
