"""OracleConnectionManager: 실 Oracle DB 연결 관리자.

``NL2SQL_DB_BACKEND=real`` 이고 ``NL2SQL_DB_DIALECT=oracle`` 일 때만 import 됩니다.
oracledb 는 optional extra 라서 ``uv sync --extra oracle`` 로 설치해야 합니다.
Thin Mode 가 기본이고, ``NL2SQL_ORACLE_THICK_MODE=true`` 또는 lib 경로를 주면 Thick Mode 로 바뀝니다.
모든 세션은 ``SET TRANSACTION READ ONLY`` 로 시작하고 끝나면 rollback 합니다.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from nl2sql_mcp.db.catalog_backend import CatalogBackend, FetchMode
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect

try:
    import oracledb
except ImportError as e:  # pragma: no cover - extra 미설치 환경
    raise ImportError(
        "NL2SQL_DB_DIALECT=oracle with a real DB requires oracledb. "
        "Install it with `uv sync --extra oracle`."
    ) from e

if TYPE_CHECKING:
    from nl2sql_mcp.config import Settings

logger = logging.getLogger(__name__)


class OracleConnectionManager(CatalogBackend):
    """async oracledb 풀(min=1, max=5) 기반 Oracle 연결 관리자."""

    def __init__(self, dialect: SQLDialect | None = None) -> None:
        super().__init__(dialect or get_dialect("oracle"))
        self._pool: oracledb.AsyncConnectionPool | None = None

    @classmethod
    async def create(
        cls, settings: Settings, dialect: SQLDialect | None = None
    ) -> OracleConnectionManager:
        """Thin/Thick Mode 초기화 후 커넥션 풀을 만들고 인스턴스를 돌려줍니다."""
        if settings.nl2sql_oracle_thick_mode or settings.nl2sql_oracle_client_lib_dir:
            oracledb.init_oracle_client(lib_dir=settings.nl2sql_oracle_client_lib_dir)
            logger.info("Oracle Thick Mode 초기화 (lib_dir=%s)", settings.nl2sql_oracle_client_lib_dir)

        dsn = settings.nl2sql_oracle_dsn or oracledb.makedsn(
            settings.nl2sql_oracle_host,
            settings.nl2sql_oracle_port,
            service_name=settings.nl2sql_oracle_service,
        )
        manager = cls(dialect)
        manager._pool = oracledb.create_pool_async(
            user=settings.nl2sql_oracle_user,
            password=settings.nl2sql_oracle_password,
            dsn=dsn,
            min=1,
            max=5,
            increment=1,
        )
        logger.info("Oracle 커넥션 풀 초기화 완료")
        return manager

    @asynccontextmanager
    async def _acquire(self) -> AsyncIterator[oracledb.AsyncConnection]:
        """READ ONLY 트랜잭션으로 커넥션을 획득합니다. DB 레벨에서 쓰기를 막습니다."""
        if not self._pool:
            raise RuntimeError("The connection pool is not initialized.")
        async with self._pool.acquire() as conn:
            with conn.cursor() as cur:
                await cur.execute("SET TRANSACTION READ ONLY")
            try:
                yield conn
            finally:
                await conn.rollback()

    async def _fetch(self, sql: str, params: dict[str, Any], mode: FetchMode = "all") -> Any:
        async with self._acquire() as conn:
            with conn.cursor() as cur:
                await cur.execute(sql, params)
                return await (cur.fetchone() if mode == "one" else cur.fetchall())

    async def _run_query(self, sql: str, max_rows: int) -> tuple[list[str], list[tuple[Any, ...]]]:
        async with self._acquire() as conn:
            with conn.cursor() as cur:
                await cur.execute(sql)
                col_names = [d[0] for d in cur.description]
                # max_rows+1 fetch 로 truncated 여부 판별
                return col_names, await cur.fetchmany(max_rows + 1)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            logger.info("Oracle 커넥션 풀 종료")
