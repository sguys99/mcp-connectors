"""P2-6 가드레일 수정이 실 PostgreSQL(Pagila)에서도 올바른 SQL 을 만드는지 확인합니다."""

from __future__ import annotations

import pytest
from fastmcp.exceptions import ToolError

from nl2sql_mcp.db.mock_backend import MockBackend
from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager
from nl2sql_mcp.tools.run_sql_query import run_sql_query

pytestmark = pytest.mark.integration


async def test_date_injection_before_group_by_and_limit_runs(real_backend):
    """7.2 가 GROUP BY 와 LIMIT 앞에 조건을 넣어 실 DB 에서 문법 오류가 나지 않습니다(버그 7)."""
    result = await run_sql_query(
        sql=(
            "SELECT staff_id, COUNT(*) AS cnt FROM rental WHERE staff_id IN (1, 2) "
            "GROUP BY staff_id LIMIT 5"
        )
    )
    # Pagila 데이터는 2022년이라 "최근 3개월" 조건이 붙으면 0행입니다
    assert result.columns == ["staff_id", "cnt"]
    assert result.row_count == 0


async def test_trailing_line_comment_and_union(real_backend):
    """끝의 -- 주석(버그 9)과 정상 UNION(버그 2)이 실 DB 에서 실행됩니다."""
    result = await run_sql_query(
        sql=(
            "SELECT film_id AS id FROM film WHERE film_id <= 2 "
            "UNION ALL SELECT actor_id FROM actor WHERE actor_id <= 2 -- 끝 주석"
        ),
        max_rows=10,
    )
    assert sorted(r[0] for r in result.rows) == [1, 1, 2, 2]


async def test_truncated_is_reported(real_backend):
    """LIMIT 을 max_rows + 1 로 붙여 잘림 여부를 정확히 알립니다(버그 10)."""
    result = await run_sql_query(sql="SELECT film_id FROM film WHERE film_id > 0", max_rows=5)
    assert result.row_count == 5 and result.truncated is True
    exact = await run_sql_query(sql="SELECT film_id FROM film WHERE film_id <= 5", max_rows=5)
    assert exact.row_count == 5 and exact.truncated is False


async def test_numeric_and_timestamp_values_match_mock(real_backend):
    """numeric 은 숫자, timestamptz 는 ISO 8601 문자열로 Mock 과 같은 형식입니다(버그 12)."""
    sql = (
        "SELECT rental_id, rental_date FROM rental WHERE rental_id = 1 "
        "AND rental_date >= DATE '2022-05-01' AND rental_date < DATE '2022-06-01'"
    )
    real = await run_sql_query(sql=sql)
    mock = await MockBackend().execute_query(sql)
    assert real.rows == mock["rows"] == [[1, "2022-05-24T21:53:30+00:00"]]
    film = await run_sql_query(sql="SELECT rental_rate, replacement_cost FROM film WHERE film_id = 1")
    assert film.rows == [[0.99, 20.99]]


async def test_small_table_without_where_allowed_large_blocked(real_backend):
    """작은 테이블은 WHERE 없이 허용하고 큰 테이블은 막습니다(새 동작 15)."""
    assert (await run_sql_query(sql="SELECT film_id FROM film", max_rows=3)).truncated is True
    assert (await run_sql_query(sql="SELECT COUNT(*) AS n FROM customer")).rows == [[599]]
    with pytest.raises(ToolError, match="MASS_SCAN_BLOCKED"):
        await run_sql_query(sql="SELECT rental_id FROM rental")


async def test_estimate_rows_uses_stats_and_explain_for_views(pg_backend: PostgresConnectionManager):
    """테이블은 reltuples, 뷰는 EXPLAIN 추정치를 씁니다. 모르는 테이블은 None."""
    est = await pg_backend.estimate_rows(["film", "rental", "film_list", "no_such_table"])
    assert est["film"] == 1000
    assert est["rental"] > 10000
    assert est["film_list"] is not None and est["film_list"] > 0
    assert est["no_such_table"] is None


async def test_column_named_like_keyword_not_blocked(real_backend):
    """EXECUTE/COPY 는 문장 단위로만 막으므로 별칭 이름으로는 쓸 수 있습니다(버그 11)."""
    result = await run_sql_query(sql='SELECT film_id AS "copy" FROM film WHERE film_id = 1')
    assert result.columns == ["copy"] and result.rows == [[1]]
