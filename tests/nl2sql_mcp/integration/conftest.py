"""실 PostgreSQL 샘플 DB(Pagila) 통합 테스트 공용 fixture.

`make sample-db-up` 으로 띄운 docker compose `postgres` 서비스에 읽기 전용 계정으로 접속합니다.
기본 `uv run pytest` 에서는 `-m "not integration"` 으로 빠지고, `make test-integration` 으로 실행해요.

접속 정보 우선순위
1. ``NL2SQL_IT_PG_DSN`` (통합 테스트 전용 override)
2. 서버와 같은 ``NL2SQL_PG_*`` 설정 (OS 환경 변수, 패키지 .env, 루트 .env)
   비밀번호가 비어 있으면 compose 와 같은 로컬 샘플 기본값을 씁니다.

DB 에 닿지 않으면 테스트를 실패시키지 않고 이유와 함께 skip 합니다.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from nl2sql_mcp.config import Settings
from nl2sql_mcp.db.postgres_connector import PostgresConnectionManager, build_conninfo
from nl2sql_mcp.state import state

# docker-compose.yaml 의 ${NL2SQL_PG_PASSWORD:-...} 기본값과 같아야 합니다 (로컬 샘플 전용 값)
SAMPLE_READER_SECRET = "nl2sql_ro_local_sample"


def _reader_conninfo() -> str:
    override = os.environ.get("NL2SQL_IT_PG_DSN")
    if override:
        return override
    settings = Settings()
    if settings.nl2sql_pg_dsn:
        return settings.nl2sql_pg_dsn
    if not settings.nl2sql_pg_password:
        settings = settings.model_copy(update={"nl2sql_pg_password": SAMPLE_READER_SECRET})
    return build_conninfo(settings)


@pytest.fixture(scope="session")
def reader_conninfo() -> str:
    """읽기 전용 계정 conninfo. 접속이 안 되면 session 전체를 skip 합니다."""
    conninfo = _reader_conninfo()
    shown = {k: v for k, v in conninfo_to_dict(conninfo).items() if k != "password"}
    try:
        with psycopg.connect(conninfo, connect_timeout=3) as conn:
            conn.execute("SELECT 1 FROM public.film LIMIT 1")
    except psycopg.Error as e:
        pytest.skip(
            f"샘플 DB 에 연결할 수 없어 통합 테스트를 건너뜁니다 ({shown}): {e}. "
            "`make sample-db-up` 으로 DB 를 띄운 뒤 `make test-integration` 을 다시 실행하세요."
        )
    return conninfo


@pytest.fixture
def raw_reader(reader_conninfo: str) -> Iterator[psycopg.Connection]:
    """커넥터의 접속 옵션 없이 읽기 전용 계정으로 바로 붙은 연결 (계정 자체 권한 확인용)."""
    with psycopg.connect(reader_conninfo, autocommit=True) as conn:
        yield conn


@pytest.fixture
def conninfo_for(reader_conninfo: str):
    """같은 계정으로 다른 데이터베이스에 붙는 conninfo 를 만듭니다."""

    def _make(**overrides: str) -> str:
        return make_conninfo(reader_conninfo, **overrides)

    return _make


@pytest.fixture
def pg_backend(reader_conninfo: str) -> PostgresConnectionManager:
    return PostgresConnectionManager(reader_conninfo, statement_timeout_sec=30)


@pytest.fixture
def real_backend(
    pg_backend: PostgresConnectionManager, monkeypatch
) -> Iterator[PostgresConnectionManager]:
    """도구 함수가 실 DB 백엔드를 쓰도록 state.backend 를 바꿉니다 (dialect 는 postgres)."""
    from nl2sql_mcp.config import settings

    monkeypatch.setattr(settings, "nl2sql_db_dialect", "postgres")
    monkeypatch.setattr(settings, "nl2sql_db_backend", "real")
    state.backend = pg_backend
    yield pg_backend
    state.backend = None
