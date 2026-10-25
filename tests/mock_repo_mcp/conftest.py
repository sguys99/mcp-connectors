"""mock-repo-mcp 테스트 fixture."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest_asyncio
from fastmcp import Client

from mock_repo_mcp.server import mcp


@pytest_asyncio.fixture
async def mcp_client() -> AsyncIterator[Client]:
    """FastMCP in-memory client. 외부 프로세스 spawn 없이 동일 프로세스에서 호출."""
    async with Client(mcp) as client:
        yield client
