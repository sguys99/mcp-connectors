"""NL2SQL 백엔드 팩토리.

- ``NL2SQL_DB_BACKEND=mock`` (기본): ``MockBackend`` (실 DB 없이 Pagila 픽스처)
- ``NL2SQL_DB_BACKEND=real``: ``NL2SQL_DB_DIALECT`` 에 맞는 커넥터
  - ``postgres`` (기본): ``PostgresConnectionManager`` (psycopg 3)
  - ``oracle``: ``OracleConnectionManager`` (oracledb, ``uv sync --extra oracle`` 필요)

드라이버 모듈은 고른 dialect 의 것만 import 합니다. oracledb 가 없어도 Postgres 와 Mock 은 동작해요.
"""

from __future__ import annotations

from nl2sql_mcp.config import settings
from nl2sql_mcp.db.dialects import get_dialect


async def get_backend():
    """설정에 따라 Mock 또는 실 DB 백엔드 인스턴스를 돌려줍니다."""
    dialect = get_dialect(settings.nl2sql_db_dialect)

    if settings.nl2sql_db_backend == "mock":
        from nl2sql_mcp.db.mock_backend import MockBackend

        return MockBackend(dialect=dialect, delay_sec=settings.nl2sql_mock_delay_sec)

    if dialect.name == "oracle":
        from nl2sql_mcp.db.oracle_connector import OracleConnectionManager

        return await OracleConnectionManager.create(settings, dialect)

    from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager

    return await PostgresConnectionManager.create(settings, dialect)
