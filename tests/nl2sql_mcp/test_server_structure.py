"""서버 구조와 설정 연결 테스트: 도구 등록 함수, import 순환 없음, 7.7 설정, Mock 지연, 출력 스키마."""

from __future__ import annotations

import subprocess
import sys

import pytest
from fastmcp import Client, FastMCP

from _common.env import REPO_ROOT
from _common.errors import AccessDeniedError, BackendUnavailableError
from nl2sql_mcp.tools import TOOLS, register_tools
from nl2sql_mcp.tools.run_sql_query import run_sql_query

EXPECTED = {
    "search_tables_schema",
    "search_columns",
    "get_table_schema",
    "get_tables_schema",
    "run_sql_query",
}


def test_tool_modules_import_without_server():
    """도구 모듈을 먼저 import 해도 server 모듈을 끌어오지 않습니다 (순환 import 없음)."""
    code = (
        "import sys; import nl2sql_mcp.tools.run_sql_query, nl2sql_mcp.tools; "
        "assert 'nl2sql_mcp.server' not in sys.modules, 'server imported'; print('ok')"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT / "src" / "mcp-servers",
        capture_output=True,
        text=True,
        check=False,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"


def test_server_entrypoint_help():
    """`python -m nl2sql_mcp.server` 진입점이 그대로 동작합니다."""
    out = subprocess.run(
        [sys.executable, "-m", "nl2sql_mcp.server", "--help"],
        cwd=REPO_ROOT / "src" / "mcp-servers",
        capture_output=True,
        text=True,
        check=False,
    )
    assert out.returncode == 0, out.stderr
    assert "--transport" in out.stdout


async def test_register_tools_on_fresh_instance():
    mcp = register_tools(FastMCP("t"))
    async with Client(mcp) as client:
        tools = {t.name: t for t in await client.list_tools()}
    assert set(tools) == EXPECTED == {fn.__name__ for fn in TOOLS}
    for tool in tools.values():
        assert tool.annotations.readOnlyHint is True
        assert tool.outputSchema, f"{tool.name} 에 outputSchema 가 없음 (models.py 반환 타입)"


async def test_structured_output_matches_model(mcp_client):
    result = await mcp_client.call_tool(
        "run_sql_query", {"sql": "SELECT staff_id, username FROM staff WHERE store_id = 1"}
    )
    data = result.structured_content
    assert set(data) >= {"columns", "rows", "row_count", "truncated", "masked_columns", "explain"}
    assert data["masked_columns"] == ["username"]
    # Mock 백엔드 결과는 표본 행이라는 사실을 출처 필드와 안내문으로 알린다 (실 DB 결과로 오인 방지)
    assert data["data_source"] == "mock_sample"
    assert "sample" in data["notice"]


# ── 7.7 설정 연결 ───────────────────────────────────────────────────────────


async def test_require_where_setting(mock_backend, monkeypatch):
    from nl2sql_mcp.config import settings

    sql = "SELECT rental_id FROM rental"  # 큰 테이블 (작은 테이블은 WHERE 없이도 허용)
    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await run_sql_query(sql=sql)
    monkeypatch.setattr(settings, "guardrail_require_where", False)
    assert (await run_sql_query(sql=sql)).row_count >= 0


async def test_block_tautology_setting(mock_backend, monkeypatch):
    from nl2sql_mcp.config import settings

    sql = "SELECT film_id FROM film WHERE 1=1"
    with pytest.raises(AccessDeniedError, match="MASS_SCAN_BLOCKED"):
        await run_sql_query(sql=sql)
    monkeypatch.setattr(settings, "guardrail_block_tautology", False)
    assert (await run_sql_query(sql=sql)).row_count >= 0


# ── Mock 지연 설정 ──────────────────────────────────────────────────────────


async def test_mock_delay_setting_reaches_backend(monkeypatch):
    from nl2sql_mcp.config import settings
    from nl2sql_mcp.db import get_backend

    monkeypatch.setattr(settings, "nl2sql_db_backend", "mock")
    monkeypatch.setattr(settings, "nl2sql_mock_delay_sec", 0.25)
    backend = await get_backend()
    assert backend.delay_sec == 0.25


async def test_mock_delay_triggers_timeout_guardrail(mock_backend, monkeypatch):
    from nl2sql_mcp.config import settings

    mock_backend.delay_sec = 0.2
    monkeypatch.setattr(settings, "guardrail_timeout_sec", 0.05)
    with pytest.raises(BackendUnavailableError, match="QUERY_TIMEOUT"):
        await run_sql_query(sql="SELECT film_id FROM film WHERE language_id = 1")


def test_removed_settings_are_gone():
    from nl2sql_mcp.config import Settings

    assert "guardrail_mock_delay_sec" not in Settings.model_fields
