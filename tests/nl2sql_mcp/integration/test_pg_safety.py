"""DB 수준 안전장치: 가드레일을 건너뛰어도 읽기 전용 계정과 세션 설정이 막는지 확인합니다.

커넥터(PostgresConnectionManager)를 직접 호출하거나 계정으로 바로 접속해, 가드레일(7.1 등)이
놓친 SQL 이 DB 에 도달했을 때를 재현합니다.
"""

from __future__ import annotations

import psycopg
import pytest
from psycopg import errors as pg_errors

from _common.errors import AccessDeniedError, BackendUnavailableError
from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager

pytestmark = pytest.mark.integration


# ── 커넥터 경유 (가드레일 우회) ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO category (name) VALUES ('integration-test')",
        "UPDATE film SET rental_rate = 0 WHERE film_id = 1",
        "DELETE FROM payment WHERE payment_id = 16050",
        "CREATE TABLE public.it_should_not_exist (id int)",
        "CREATE TEMP TABLE it_tmp (id int)",
        "TRUNCATE rental",
    ],
)
async def test_connector_rejects_writes(pg_backend: PostgresConnectionManager, sql: str):
    with pytest.raises(AccessDeniedError, match=r"\[(WRITE_BLOCKED|ACCESS_DENIED)\]"):
        await pg_backend.execute_query(sql)


async def test_connector_rejects_write_after_reenabling_read_write(
    pg_backend: PostgresConnectionManager,
):
    """한 번에 여러 문장을 보내 세션을 읽기/쓰기로 바꾸려 해도 트랜잭션은 이미 READ ONLY 입니다."""
    sql = "SET default_transaction_read_only = off; INSERT INTO category (name) VALUES ('x')"
    with pytest.raises(AccessDeniedError):
        await pg_backend.execute_query(sql)


async def test_connector_statement_timeout(reader_conninfo: str):
    backend = PostgresConnectionManager(reader_conninfo, statement_timeout_sec=1)
    with pytest.raises(BackendUnavailableError, match="QUERY_TIMEOUT"):
        await backend.execute_query("SELECT pg_sleep(3)")


async def test_connector_cannot_read_pg_authid(pg_backend: PostgresConnectionManager):
    with pytest.raises(AccessDeniedError, match="ACCESS_DENIED"):
        await pg_backend.execute_query("SELECT rolname, rolpassword FROM pg_authid")


async def test_connector_cannot_read_server_files(pg_backend: PostgresConnectionManager):
    with pytest.raises(AccessDeniedError, match="ACCESS_DENIED"):
        await pg_backend.execute_query("SELECT pg_read_file('/etc/passwd')")


async def test_connector_unreachable_db_maps_to_backend_unavailable():
    backend = PostgresConnectionManager(
        "host=127.0.0.1 port=1 dbname=pagila user=nl2sql_ro connect_timeout=2"
    )
    with pytest.raises(BackendUnavailableError, match="BACKEND_UNAVAILABLE"):
        await backend.search_tables("%")


# ── 계정 자체 권한 (커넥터 접속 옵션 없이) ────────────────────────────────────


def test_reader_role_attributes(raw_reader: psycopg.Connection):
    row = raw_reader.execute(
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit "
        "FROM pg_roles WHERE rolname = current_user"
    ).fetchone()
    assert row == (False, False, False, False, False, False)


def test_reader_session_defaults(raw_reader: psycopg.Connection):
    """ALTER ROLE ... SET 으로 계정 기본값이 읽기 전용과 타임아웃입니다."""
    assert raw_reader.execute("SHOW default_transaction_read_only").fetchone() == ("on",)
    assert raw_reader.execute("SHOW statement_timeout").fetchone() == ("30s",)


def test_reader_has_select_only(raw_reader: psycopg.Connection):
    rows = raw_reader.execute(
        """
        SELECT c.relname,
               has_table_privilege(c.oid, 'SELECT'),
               has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
        """
    ).fetchall()
    assert len(rows) == 30  # 23개 + payment 파티션 7개
    assert all(can_select for _, can_select, _ in rows)
    assert not any(can_write for _, _, can_write in rows)


def test_reader_write_denied_even_when_read_write(raw_reader: psycopg.Connection):
    """세션을 읽기/쓰기로 돌려도 INSERT 권한이 없어 거부됩니다 (두 번째 방어선)."""
    raw_reader.execute("SET default_transaction_read_only = off")
    with pytest.raises(pg_errors.InsufficientPrivilege):
        raw_reader.execute("INSERT INTO category (name) VALUES ('integration-test')")


@pytest.mark.parametrize(
    "sql",
    [
        "CREATE TABLE public.it_should_not_exist (id int)",
        "CREATE TEMP TABLE it_tmp (id int)",
        "CREATE SCHEMA it_schema",
    ],
)
def test_reader_cannot_create_objects(raw_reader: psycopg.Connection, sql: str):
    raw_reader.execute("SET default_transaction_read_only = off")
    with pytest.raises(pg_errors.InsufficientPrivilege):
        raw_reader.execute(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM pg_authid",
        "SELECT * FROM pg_shadow",
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT pg_ls_dir('.')",
    ],
)
def test_reader_cannot_read_secrets(raw_reader: psycopg.Connection, sql: str):
    with pytest.raises(pg_errors.InsufficientPrivilege):
        raw_reader.execute(sql)


@pytest.mark.parametrize("dbname", ["postgres", "template1"])
def test_reader_cannot_connect_other_databases(conninfo_for, dbname: str):
    with pytest.raises(psycopg.OperationalError, match="permission denied"):
        psycopg.connect(conninfo_for(dbname=dbname), connect_timeout=3).close()
