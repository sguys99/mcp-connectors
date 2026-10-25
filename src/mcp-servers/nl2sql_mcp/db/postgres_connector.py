"""PostgresConnectionManager: 실 PostgreSQL 연결 관리자 (psycopg 3).

``NL2SQL_DB_BACKEND=real`` 이고 ``NL2SQL_DB_DIALECT=postgres`` 일 때 씁니다.

읽기 전용 경계를 두 겹으로 둡니다.
1. 접속 옵션 ``default_transaction_read_only=on`` 과 ``statement_timeout`` (세션 전체)
2. ``conn.set_read_only(True)`` 로 모든 트랜잭션을 ``BEGIN READ ONLY`` 로 시작

호출 빈도가 낮은 MCP 도구라 요청마다 연결을 새로 엽니다. 풀이 필요해지면
``psycopg_pool.AsyncConnectionPool`` 로 ``_connect`` 만 바꾸면 됩니다.

DB 가 돌려준 오류 중 가드레일과 의미가 같은 것은 같은 에러 코드로 바꿉니다
(``_translate_db_errors``). 그 밖의 SQL 오류(없는 컬럼 등)는 DB 메시지를 그대로 전달해
LLM 이 SQL 을 고쳐 다시 시도할 수 있게 둡니다.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import TYPE_CHECKING, Any

import psycopg
from psycopg import errors as pg_errors
from psycopg.conninfo import make_conninfo

from _common.errors import AccessDeniedError, BackendUnavailableError, InvalidInputError
from nl2sql_mcp.db.catalog_backend import CatalogBackend, FetchMode
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect

if TYPE_CHECKING:
    from nl2sql_mcp.config import Settings

logger = logging.getLogger(__name__)


def build_conninfo(settings: Settings) -> str:
    """DSN 이 있으면 그대로, 없으면 host/port/db/user/password 로 conninfo 를 만듭니다."""
    if settings.nl2sql_pg_dsn:
        return settings.nl2sql_pg_dsn
    return make_conninfo(
        host=settings.nl2sql_pg_host,
        port=settings.nl2sql_pg_port,
        dbname=settings.nl2sql_pg_database,
        user=settings.nl2sql_pg_user,
        password=settings.nl2sql_pg_password or None,
    )


def session_options(statement_timeout_sec: int) -> str:
    """libpq ``options`` 값. 세션 기본 트랜잭션을 읽기 전용으로 두고 타임아웃을 겁니다."""
    timeout_ms = max(int(statement_timeout_sec * 1000), 0)
    return f"-c default_transaction_read_only=on -c statement_timeout={timeout_ms}"


@contextmanager
def _translate_db_errors(statement_timeout_sec: int) -> Iterator[None]:
    """psycopg 예외 중 가드레일 코드와 대응되는 것을 도구 에러로 바꿉니다."""
    try:
        yield
    except pg_errors.QueryCanceled as e:
        # statement_timeout 초과 (asyncio 래퍼 7.4 와 같은 코드)
        raise BackendUnavailableError(
            f"Query execution exceeded {statement_timeout_sec} seconds and was cancelled by the DB. "
            "Narrow the WHERE condition and retry. [QUERY_TIMEOUT]"
        ) from e
    except pg_errors.ReadOnlySqlTransaction as e:
        # 가드레일(7.1)을 통과한 쓰기도 읽기 전용 트랜잭션에서 막힙니다
        raise AccessDeniedError(
            f"The connection is read-only, so data cannot be modified "
            f"({e.diag.message_primary}). [WRITE_BLOCKED]"
        ) from e
    except pg_errors.InsufficientPrivilege as e:
        raise AccessDeniedError(
            f"The DB account lacks permission ({e.diag.message_primary}). [ACCESS_DENIED]"
        ) from e
    except (psycopg.ProgrammingError, psycopg.DataError) as e:
        # 가드레일은 통과했지만 DB 가 거부한 SQL (없는 컬럼, 테이블, 함수, 잘못된 값 형식 등).
        # 태그가 없으면 CLI 와 감사 로그에 TOOL_ERROR 로 남으므로 정의서의 INVALID_SQL 로 바꿉니다
        detail = e.diag.message_primary or (str(e).splitlines() or [type(e).__name__])[0]
        raise InvalidInputError(
            f"SQL syntax error ({detail}). "
            "Check the column and table names with get_table_schema. [INVALID_SQL]"
        ) from e
    except psycopg.OperationalError as e:
        # 접속 실패, 연결 끊김 (SQL 오류는 OperationalError 가 아니라 ProgrammingError 계열)
        logger.warning("PostgreSQL 연결 오류: %s", e)
        raise BackendUnavailableError(
            "Cannot connect to PostgreSQL. Check the NL2SQL_PG_* settings and the DB status. "
            "[BACKEND_UNAVAILABLE]"
        ) from e


class PostgresConnectionManager(CatalogBackend):
    """요청마다 읽기 전용 연결을 여는 PostgreSQL 백엔드."""

    def __init__(
        self,
        conninfo: str,
        statement_timeout_sec: int = 30,
        dialect: SQLDialect | None = None,
    ) -> None:
        super().__init__(dialect or get_dialect("postgres"))
        self._conninfo = conninfo
        self._statement_timeout_sec = statement_timeout_sec

    @classmethod
    async def create(
        cls, settings: Settings, dialect: SQLDialect | None = None
    ) -> PostgresConnectionManager:
        manager = cls(
            build_conninfo(settings),
            statement_timeout_sec=settings.guardrail_timeout_sec,
            dialect=dialect,
        )
        logger.info(
            "PostgreSQL 백엔드 준비 (statement_timeout=%ss, read_only=on)",
            settings.guardrail_timeout_sec,
        )
        return manager

    @asynccontextmanager
    async def _connect(self) -> AsyncIterator[psycopg.AsyncConnection]:
        conn = await psycopg.AsyncConnection.connect(
            self._conninfo,
            options=session_options(self._statement_timeout_sec),
            autocommit=False,
        )
        try:
            await conn.set_read_only(True)
            yield conn
        finally:
            try:
                await conn.rollback()
            finally:
                await conn.close()

    async def _fetch(self, sql: str, params: dict[str, Any], mode: FetchMode = "all") -> Any:
        with _translate_db_errors(self._statement_timeout_sec):
            async with self._connect() as conn, conn.cursor() as cur:
                await cur.execute(sql, params)
                return await (cur.fetchone() if mode == "one" else cur.fetchall())

    async def _run_query(self, sql: str, max_rows: int) -> tuple[list[str], list[tuple[Any, ...]]]:
        with _translate_db_errors(self._statement_timeout_sec):
            async with self._connect() as conn, conn.cursor() as cur:
                # 파라미터 없이 실행하면 psycopg 는 SQL 안의 % 를 placeholder 로 해석하지 않습니다
                await cur.execute(sql)
                col_names = [d.name for d in (cur.description or [])]
                return col_names, await cur.fetchmany(max_rows + 1)

    async def close(self) -> None:
        # 요청마다 연결을 닫으므로 정리할 풀이 없습니다
        return None
