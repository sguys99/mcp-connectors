"""감사 로그(7.8) 테스트: 설정 경로, 상태 어휘, 차단 기록, error_type, session_id, SQL 마스킹, 정리."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastmcp.exceptions import ToolError

from _common.errors import AccessDeniedError, BackendUnavailableError, InvalidInputError, NotFoundError
from nl2sql_mcp.guardrails.audit_log import (
    AUDIT_STATUSES,
    audit_call,
    error_code,
    purge_old_audit_records,
    status_for,
)
from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query
from nl2sql_mcp.tools.search_tables_schema import search_tables_schema


def _rows(path: Path) -> list[dict]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY id")]
    finally:
        conn.close()


# ── 설정 경로 ────────────────────────────────────────────────────────────────


def test_default_audit_path_is_absolute_under_repo_var():
    from _common.env import REPO_ROOT
    from nl2sql_mcp.config import DEFAULT_AUDIT_LOG_PATH, Settings

    assert DEFAULT_AUDIT_LOG_PATH == REPO_ROOT / "var" / "nl2sql_mcp" / "audit.db"
    assert Settings(audit_log_path=DEFAULT_AUDIT_LOG_PATH).audit_log_path.is_absolute()


def test_relative_audit_path_resolves_against_repo_root(monkeypatch, tmp_path):
    from _common.env import REPO_ROOT
    from nl2sql_mcp.config import Settings

    monkeypatch.chdir(tmp_path)  # CWD 와 무관해야 함
    assert Settings(audit_log_path="logs/a.db").audit_log_path == (REPO_ROOT / "logs" / "a.db").resolve()


def test_audit_path_env_override(monkeypatch, tmp_path):
    from nl2sql_mcp.config import Settings

    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "x.db"))
    assert Settings().audit_log_path == tmp_path / "x.db"


# ── 어휘와 코드 ─────────────────────────────────────────────────────────────


def test_status_vocabulary():
    assert AUDIT_STATUSES == ("success", "blocked", "error")
    assert status_for(None) == "success"
    assert status_for("PII_COLUMN_BLOCKED") == "blocked"
    assert status_for("WRITE_BLOCKED") == "blocked"
    assert status_for("DATE_RANGE_EXCEEDED") == "blocked"
    assert status_for("QUERY_TIMEOUT") == "error"
    assert status_for("TABLE_NOT_FOUND") == "error"


@pytest.mark.parametrize(
    "exc,code",
    [
        (AccessDeniedError("막힘 [MASS_SCAN_BLOCKED]"), "MASS_SCAN_BLOCKED"),
        (BackendUnavailableError("느림 [QUERY_TIMEOUT]"), "QUERY_TIMEOUT"),
        (InvalidInputError("태그 없음"), "INVALID_INPUT"),
        (NotFoundError("태그 없음"), "NOT_FOUND"),
        (ValueError("x"), "ValueError"),
    ],
)
def test_error_code(exc, code):
    assert error_code(exc) == code


# ── 도구 호출 기록 ──────────────────────────────────────────────────────────


async def test_success_row_records_sql_latency_and_count(mock_backend, audit_db):
    sql = "SELECT film_id, title FROM film WHERE language_id = 1"
    result = await run_sql_query(sql=sql, max_rows=10)
    [row] = _rows(audit_db)
    assert row["tool_name"] == "run_sql_query"
    assert row["result_status"] == "success"
    assert row["sql_text"] == sql
    assert row["latency_ms"] > 0
    assert row["row_count"] == result.row_count
    assert row["error_type"] is None
    assert row["session_id"]
    assert datetime.fromisoformat(row["call_time"]).tzinfo is not None


@pytest.mark.parametrize(
    "sql,code",
    [
        ("DELETE FROM customer WHERE active = 0", "WRITE_BLOCKED"),
        ("SELECT rental_id, inventory_id FROM rental", "MASS_SCAN_BLOCKED"),
        ("SELECT email FROM customer WHERE active = 1", "PII_COLUMN_BLOCKED"),
    ],
)
async def test_guardrail_rejection_recorded_as_blocked(mock_backend, audit_db, sql, code):
    with pytest.raises(ToolError, match=code):
        await run_sql_query(sql=sql)
    [row] = _rows(audit_db)
    assert row["result_status"] == "blocked"
    assert row["error_type"] == code
    assert row["latency_ms"] >= 0
    assert row["sql_text"]


async def test_invalid_input_recorded_as_error(mock_backend, audit_db):
    with pytest.raises(InvalidInputError):
        await run_sql_query(sql="SELECT 1", max_rows=0)
    [row] = _rows(audit_db)
    assert (row["result_status"], row["error_type"]) == ("error", "INVALID_INPUT")


async def test_timeout_recorded_as_error(mock_backend, audit_db, monkeypatch):
    from nl2sql_mcp.config import settings

    mock_backend.delay_sec = 0.2
    monkeypatch.setattr(settings, "guardrail_timeout_sec", 0.05)
    with pytest.raises(BackendUnavailableError, match="QUERY_TIMEOUT"):
        await run_sql_query(sql="SELECT film_id FROM film WHERE language_id = 1")
    [row] = _rows(audit_db)
    assert (row["result_status"], row["error_type"]) == ("error", "QUERY_TIMEOUT")


async def test_schema_tools_recorded_with_params(mock_backend, audit_db):
    await search_tables_schema(pattern="CUST%")
    with pytest.raises(NotFoundError):
        await get_table_schema(table_name="no_such_table")
    ok, missing = _rows(audit_db)
    assert (ok["tool_name"], ok["result_status"], ok["row_count"]) == (
        "search_tables_schema",
        "success",
        2,
    )
    assert '"pattern": "CUST%"' in ok["params"]
    assert (missing["result_status"], missing["error_type"]) == ("error", "TABLE_NOT_FOUND")


async def test_too_many_tables_error_type(mock_backend, audit_db):
    async def _many(pattern, limit):
        return {"tables": [], "match_count": limit + 1, "truncated": True}

    mock_backend.search_tables = _many
    with pytest.raises(ToolError):
        await search_tables_schema(pattern="%")
    [row] = _rows(audit_db)
    assert (row["result_status"], row["error_type"]) == ("error", "TOO_MANY_TABLES")


async def test_sql_literals_masked_in_audit(mock_backend, audit_db):
    sql = "SELECT customer_id FROM customer WHERE email = 'kim@example.com' AND customer_id = 5"
    await run_sql_query(sql=sql)
    [row] = _rows(audit_db)
    assert "kim@example.com" not in row["sql_text"]
    assert "***@***.***" in row["sql_text"]
    assert "customer_id = 5" in row["sql_text"]  # 짧은 숫자 조건은 감사용으로 남김


async def test_session_id_from_mcp_context(mcp_client, audit_db):
    await mcp_client.call_tool("search_tables_schema", {"pattern": "FILM%"})
    await mcp_client.call_tool("search_columns", {"column_pattern": "AMOUNT"})
    rows = _rows(audit_db)
    assert len(rows) == 2
    assert rows[0]["session_id"] == rows[1]["session_id"]
    assert not rows[0]["session_id"].startswith("proc-")  # 요청 컨텍스트의 세션 ID


async def test_session_id_fallback_outside_request(audit_db):
    async with audit_call("unit", db_path=audit_db):
        pass
    [row] = _rows(audit_db)
    assert row["session_id"].startswith("proc-")


async def test_write_failure_does_not_break_tool(mock_backend, monkeypatch, tmp_path):
    from nl2sql_mcp.config import settings

    blocker = tmp_path / "file"
    blocker.write_text("x")
    monkeypatch.setattr(settings, "audit_log_path", blocker / "audit.db")  # 부모가 파일이라 기록 불가
    result = await search_tables_schema(pattern="CUST%")
    assert result.match_count == 2


async def test_old_schema_file_gets_params_column(audit_db):
    conn = sqlite3.connect(audit_db)
    conn.execute(
        "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, call_time TEXT NOT NULL, "
        "session_id TEXT, tool_name TEXT, sql_text TEXT, result_status TEXT, latency_ms REAL, "
        "row_count INTEGER, error_type TEXT)"
    )
    conn.commit()
    conn.close()
    async with audit_call("unit", params={"a": 1}, db_path=audit_db):
        pass
    assert _rows(audit_db)[0]["params"] == '{"a": 1}'


# ── 보존 기간 정리 ──────────────────────────────────────────────────────────


async def test_purge_old_records(audit_db):
    async with audit_call("recent", db_path=audit_db):
        pass
    old = (datetime.now(UTC) - timedelta(days=31)).isoformat()
    conn = sqlite3.connect(audit_db)
    conn.execute("INSERT INTO audit_log (call_time, tool_name) VALUES (?, 'old')", (old,))
    conn.commit()
    conn.close()

    assert await purge_old_audit_records(db_path=audit_db, retention_days=30) == 1
    assert [r["tool_name"] for r in _rows(audit_db)] == ["recent"]


async def test_purge_missing_file_is_noop(tmp_path):
    assert await purge_old_audit_records(db_path=tmp_path / "none.db") == 0
    assert not (tmp_path / "none.db").exists()
