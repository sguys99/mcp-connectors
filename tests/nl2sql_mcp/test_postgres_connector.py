"""PostgresConnectionManager 단위 테스트 (psycopg 를 가짜 객체로 대체, 실 DB 불필요)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from nl2sql_mcp.db import postgres_connector as pc
from nl2sql_mcp.db.postgres_connector import (
    PostgresConnectionManager,
    build_conninfo,
    session_options,
)


class FakeCursor:
    def __init__(self, conn: FakeConnection) -> None:
        self.conn = conn
        self.description: list[Any] | None = None

    async def __aenter__(self) -> FakeCursor:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def execute(self, sql: str, params: dict[str, Any] | None = None) -> None:
        self.conn.executed.append((sql, params))
        result = self.conn.results.pop(0) if self.conn.results else []
        self._rows = result
        self.description = [SimpleNamespace(name=n) for n in self.conn.columns]

    async def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    async def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows[0] if self._rows else None

    async def fetchmany(self, size: int) -> list[tuple[Any, ...]]:
        return self._rows[:size]


class FakeConnection:
    def __init__(self, results: list[list[tuple[Any, ...]]], columns: list[str]) -> None:
        self.results = results
        self.columns = columns
        self.executed: list[tuple[str, dict[str, Any] | None]] = []
        self.read_only: bool | None = None
        self.rolled_back = False
        self.closed = False

    async def set_read_only(self, value: bool) -> None:
        self.read_only = value

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    async def rollback(self) -> None:
        self.rolled_back = True

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def fake_pg(monkeypatch):
    """psycopg.AsyncConnection.connect 를 가로채 호출 인자와 연결 객체를 기록한다."""
    state: dict[str, Any] = {"calls": [], "conns": [], "results": [], "columns": []}

    async def fake_connect(conninfo: str, **kwargs: Any) -> FakeConnection:
        state["calls"].append((conninfo, kwargs))
        conn = FakeConnection(state["results"], state["columns"])
        state["conns"].append(conn)
        return conn

    monkeypatch.setattr(pc.psycopg.AsyncConnection, "connect", fake_connect)
    return state


async def test_connection_is_read_only_with_statement_timeout(fake_pg):
    fake_pg["columns"] = ["customer_id"]
    fake_pg["results"].append([(1,), (2,), (3,)])
    manager = PostgresConnectionManager("host=db dbname=pagila", statement_timeout_sec=7)

    result = await manager.execute_query("SELECT customer_id FROM customer WHERE x = 1", max_rows=2)

    conninfo, kwargs = fake_pg["calls"][0]
    assert conninfo == "host=db dbname=pagila"
    assert "default_transaction_read_only=on" in kwargs["options"]
    assert "statement_timeout=7000" in kwargs["options"]
    assert kwargs["autocommit"] is False

    conn = fake_pg["conns"][0]
    assert conn.read_only is True  # BEGIN READ ONLY
    assert conn.rolled_back and conn.closed  # 끝나면 rollback 후 닫음
    # 사용자 SQL 은 파라미터 없이 실행 (리터럴 % 보호)
    assert conn.executed == [("SELECT customer_id FROM customer WHERE x = 1", None)]

    assert result["columns"] == ["customer_id"]
    assert result["rows"] == [[1], [2]]
    assert result["row_count"] == 2
    assert result["truncated"] is True


async def test_connection_closed_even_when_query_fails(fake_pg, monkeypatch):
    async def boom(self, sql, params=None):
        raise RuntimeError("canceling statement due to statement timeout")

    monkeypatch.setattr(FakeCursor, "execute", boom)
    manager = PostgresConnectionManager("dbname=pagila", statement_timeout_sec=1)
    with pytest.raises(RuntimeError, match="statement timeout"):
        await manager.execute_query("SELECT pg_sleep(5)", max_rows=1)
    conn = fake_pg["conns"][0]
    assert conn.rolled_back and conn.closed


async def test_search_tables_uses_postgres_catalog(fake_pg):
    fake_pg["results"].append([("public", "customer", "Customer", 599, 1)])
    manager = PostgresConnectionManager("dbname=pagila")

    result = await manager.search_tables("CUST%", limit=20)

    sql, params = fake_pg["conns"][0].executed[0]
    assert "pg_catalog.pg_class" in sql and "ILIKE" in sql
    assert params == {"pattern": "cust%", "lim": 20}  # Postgres 식별자는 소문자로 접음
    assert result["match_count"] == 1
    assert result["tables"][0] == {
        "owner": "public",
        "table_name": "customer",
        "comment": "Customer",
        "column_count": 0,
        "estimated_rows": 599,
    }


async def test_get_table_schema_assembles_columns_pk_fk(fake_pg):
    fake_pg["results"].extend(
        [
            [("public", "payment", "Payment")],  # meta
            [("payment_id", "integer", "N", "PK"), ("amount", "numeric(5,2)", "Y", None)],  # columns
            [("payment_id",)],  # pk
            [("customer_id", "customer", "customer_id", "payment_customer_id_fkey")],  # fk
        ]
    )
    manager = PostgresConnectionManager("dbname=pagila")

    schema = await manager.get_table_schema("public.PAYMENT")

    meta_sql, meta_params = fake_pg["conns"][0].executed[0]
    assert meta_params == {"owner": "public", "tname": "payment"}
    assert "%(owner)s" in meta_sql
    assert schema == {
        "owner": "public",
        "table_name": "payment",
        "comment": "Payment",
        "columns": [
            {"name": "payment_id", "data_type": "integer", "nullable": False, "comment": "PK"},
            {"name": "amount", "data_type": "numeric(5,2)", "nullable": True, "comment": None},
        ],
        "primary_key": ["payment_id"],
        "foreign_keys": [
            {"columns": ["customer_id"], "ref_table": "customer", "ref_columns": ["customer_id"]}
        ],
    }


async def test_get_table_schema_not_found(fake_pg):
    fake_pg["results"].append([])
    manager = PostgresConnectionManager("dbname=pagila")
    assert await manager.get_table_schema("nope") is None


def test_build_conninfo_prefers_dsn():
    s = SimpleNamespace(nl2sql_pg_dsn="postgresql://ro@db/pagila")
    assert build_conninfo(s) == "postgresql://ro@db/pagila"


def test_build_conninfo_from_fields():
    s = SimpleNamespace(
        nl2sql_pg_dsn=None,
        nl2sql_pg_host="db",
        nl2sql_pg_port=5433,
        nl2sql_pg_database="pagila",
        nl2sql_pg_user="nl2sql_ro",
        nl2sql_pg_password="",
    )
    info = build_conninfo(s)
    assert "host=db" in info and "port=5433" in info
    assert "dbname=pagila" in info and "user=nl2sql_ro" in info
    assert "password" not in info  # 빈 비밀번호는 넣지 않음


def test_session_options():
    assert session_options(30) == "-c default_transaction_read_only=on -c statement_timeout=30000"


async def test_create_uses_guardrail_timeout():
    s = SimpleNamespace(
        nl2sql_pg_dsn="dbname=pagila",
        guardrail_timeout_sec=12,
    )
    manager = await PostgresConnectionManager.create(s)
    assert manager._statement_timeout_sec == 12
    assert manager.dialect.name == "postgres"


# ── P2-4: 실 DB 검증에서 보강한 동작 ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("exc", "error_cls", "code"),
    [
        (pc.pg_errors.QueryCanceled("canceling statement"), "BackendUnavailableError", "QUERY_TIMEOUT"),
        (pc.pg_errors.ReadOnlySqlTransaction("read-only"), "AccessDeniedError", "WRITE_BLOCKED"),
        (pc.pg_errors.InsufficientPrivilege("denied"), "AccessDeniedError", "ACCESS_DENIED"),
        (
            pc.psycopg.OperationalError("connection refused"),
            "BackendUnavailableError",
            "BACKEND_UNAVAILABLE",
        ),
    ],
)
async def test_db_errors_are_translated(fake_pg, monkeypatch, exc, error_cls, code):
    import _common.errors as errors

    async def boom(self, sql, params=None):
        raise exc

    monkeypatch.setattr(FakeCursor, "execute", boom)
    manager = PostgresConnectionManager("dbname=pagila", statement_timeout_sec=1)
    with pytest.raises(getattr(errors, error_cls), match=code):
        await manager.execute_query("SELECT 1", max_rows=1)
    with pytest.raises(getattr(errors, error_cls), match=code):
        await manager.search_tables("%")
    assert all(c.closed for c in fake_pg["conns"])


async def test_sql_errors_keep_db_message_and_get_invalid_sql_tag(fake_pg, monkeypatch):
    """없는 컬럼 같은 SQL 오류는 DB 메시지를 남기되 ``[INVALID_SQL]`` 태그를 붙입니다 (P2-7).

    태그가 없으면 CLI 와 감사 로그에 ``TOOL_ERROR`` 로 남아 정의서 §5 "모든 에러는 [CODE] 로 끝남"과
    어긋납니다. LLM 이 SQL 을 고칠 수 있게 DB 메시지는 그대로 담아요.
    """
    import _common.errors as errors

    async def boom(self, sql, params=None):
        raise pc.pg_errors.UndefinedColumn('column "x" does not exist')

    monkeypatch.setattr(FakeCursor, "execute", boom)
    manager = PostgresConnectionManager("dbname=pagila")
    with pytest.raises(errors.InvalidInputError, match=r'column "x" does not exist.*\[INVALID_SQL\]'):
        await manager.execute_query("SELECT x FROM film", max_rows=1)


async def test_data_errors_get_invalid_sql_tag(fake_pg, monkeypatch):
    import _common.errors as errors

    async def boom(self, sql, params=None):
        raise pc.pg_errors.InvalidDatetimeFormat('invalid input syntax for type date: "x"')

    monkeypatch.setattr(FakeCursor, "execute", boom)
    manager = PostgresConnectionManager("dbname=pagila")
    with pytest.raises(errors.InvalidInputError, match="INVALID_SQL"):
        await manager.execute_query("SELECT DATE 'x'", max_rows=1)


async def test_search_tables_reads_column_count(fake_pg):
    fake_pg["results"].append([("public", "film", "Film master", 1000, 1, 14)])
    manager = PostgresConnectionManager("dbname=pagila")
    result = await manager.search_tables("film", limit=20)
    sql, _ = fake_pg["conns"][0].executed[0]
    assert "NOT c.relispartition" in sql
    assert result["tables"][0]["column_count"] == 14


async def test_get_table_schema_merges_partition_foreign_keys(fake_pg):
    """파티션마다 있는 같은 FK(Pagila payment_p2022_xx)는 하나로 합칩니다."""
    fake_pg["results"].extend(
        [
            [("public", "payment", "Payment")],
            [("payment_id", "integer", "N", "PK")],
            [("payment_date",), ("payment_id",)],
            [
                ("customer_id", "customer", "customer_id", "payment_p2022_01_customer_id_fkey"),
                ("customer_id", "customer", "customer_id", "payment_p2022_02_customer_id_fkey"),
                ("staff_id", "staff", "staff_id", "payment_p2022_01_staff_id_fkey"),
            ],
        ]
    )
    manager = PostgresConnectionManager("dbname=pagila")
    schema = await manager.get_table_schema("payment")
    assert schema["primary_key"] == ["payment_date", "payment_id"]
    assert schema["foreign_keys"] == [
        {"columns": ["customer_id"], "ref_table": "customer", "ref_columns": ["customer_id"]},
        {"columns": ["staff_id"], "ref_table": "staff", "ref_columns": ["staff_id"]},
    ]
    fk_sql, _ = fake_pg["conns"][3].executed[0]  # 요청마다 새 연결
    assert "pg_inherits" in fk_sql and "conparentid = 0" in fk_sql
