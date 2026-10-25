"""nl2sql_mcp 테스트 공용 fixture."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastmcp import Client

from nl2sql_mcp.db.mock_backend import MockBackend
from nl2sql_mcp.server import mcp
from nl2sql_mcp.state import state


@pytest.fixture(autouse=True)
def audit_db(tmp_path, monkeypatch):
    """감사 로그를 테스트마다 임시 파일에 씁니다 (저장소 var/ 나 CWD 에 audit.db 를 만들지 않음)."""
    from nl2sql_mcp.config import settings

    path = tmp_path / "audit.db"
    monkeypatch.setattr(settings, "audit_log_path", path)
    return path


@pytest.fixture
def mock_backend() -> MockBackend:
    """tool 단위 테스트용. state.backend를 MockBackend로 교체한다."""
    backend = MockBackend()
    state.backend = backend
    yield backend
    state.backend = None


@pytest_asyncio.fixture
async def mcp_client(monkeypatch) -> AsyncIterator[Client]:
    """FastMCP in-memory client. lifespan 실행 → MockBackend 자동 주입."""
    from nl2sql_mcp.config import settings

    monkeypatch.setattr(settings, "nl2sql_db_backend", "mock")
    async with Client(mcp) as client:
        yield client
