"""가드레일 7.8 — 감사 로깅 (전 도구 공통).

모든 도구는 본문을 :func:`audit_call` 로 감쌉니다. 성공, 가드레일 차단, 실행 오류를 가리지 않고
호출 한 건마다 SQLite(``AUDIT_LOG_PATH``, 기본 ``<저장소>/var/nl2sql_mcp/audit.db``)에 한 행을 남겨요.
aiosqlite 없이 stdlib sqlite3 + asyncio.to_thread 로 구현합니다.

``result_status`` 값은 세 가지뿐입니다 (:data:`AUDIT_STATUSES`).

- ``success``: 정상 응답
- ``blocked``: 가드레일이나 DB 권한 경계가 거부함 (:data:`BLOCKED_CODES`, 예: ``PII_COLUMN_BLOCKED``)
- ``error``: 그 밖의 실패 (입력 오류, 타임아웃, 테이블 없음, 접속 실패 등)

``error_type`` 은 에러 메시지의 ``[CODE]`` 태그(없으면 에러 클래스에 대응하는 코드)이고,
``session_id`` 는 MCP 세션 ID(Streamable HTTP 는 ``mcp-session-id``, stdio/in-memory 는
연결마다 만든 UUID)입니다. 요청 컨텍스트 밖에서 부르면 프로세스 단위 ID 를 씁니다.

``sql_text`` 는 사용자가 보낸 원문 SQL 에 ``_common/masking.py`` 정규식을 적용한 값입니다. 구조와
날짜, ID 같은 조건 값은 감사에 필요해 남기고, 리터럴 안의 이메일, 전화번호, 카드번호,
10~14자리 숫자열은 가려요.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sqlite3
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from _common.errors import (
    AccessDeniedError,
    BackendUnavailableError,
    InvalidInputError,
    NotFoundError,
    ResponseTooLargeError,
)
from _common.masking import mask_pii
from nl2sql_mcp.error_codes import BLOCKED_CODES

logger = logging.getLogger(__name__)

AUDIT_STATUSES = ("success", "blocked", "error")

# 차단(blocked)으로 기록하는 에러 코드(BLOCKED_CODES)의 정본은 nl2sql_mcp/error_codes.py 입니다.
_CODE_TAG = re.compile(r"\[([A-Z][A-Z0-9_]+)\]")
_CLASS_CODES: tuple[tuple[type[Exception], str], ...] = (
    (InvalidInputError, "INVALID_INPUT"),
    (NotFoundError, "NOT_FOUND"),
    (AccessDeniedError, "ACCESS_DENIED"),
    (BackendUnavailableError, "BACKEND_UNAVAILABLE"),
    (ResponseTooLargeError, "RESPONSE_TOO_LARGE"),
)

# 요청 컨텍스트가 없을 때(직접 호출, 테스트) 쓰는 프로세스 단위 세션 ID
_PROCESS_SESSION_ID = f"proc-{os.getpid()}-{uuid.uuid4().hex[:8]}"

_DDL = """
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    call_time     TEXT    NOT NULL,
    session_id    TEXT,
    tool_name     TEXT,
    sql_text      TEXT,
    result_status TEXT,
    latency_ms    REAL,
    row_count     INTEGER,
    error_type    TEXT,
    params        TEXT
)
"""
_COLUMNS = (
    "call_time",
    "session_id",
    "tool_name",
    "sql_text",
    "result_status",
    "latency_ms",
    "row_count",
    "error_type",
    "params",
)


@dataclass
class AuditEvent:
    """한 번의 도구 호출 기록. 도구는 ``row_count`` 와 (필요하면) ``error_type`` 을 채웁니다."""

    tool: str
    sql: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    row_count: int | None = None
    error_type: str | None = None


def error_code(exc: BaseException) -> str:
    """예외에서 에러 코드를 뽑습니다. 메시지의 마지막 ``[CODE]`` 태그가 우선이에요."""
    tags = _CODE_TAG.findall(str(exc))
    if tags:
        return tags[-1]
    for cls, code in _CLASS_CODES:
        if isinstance(exc, cls):
            return code
    return type(exc).__name__


def status_for(code: str | None) -> str:
    """에러 코드를 ``result_status`` 로 바꿉니다 (코드가 없으면 success)."""
    if code is None:
        return "success"
    return "blocked" if code in BLOCKED_CODES else "error"


def current_session_id() -> str:
    """MCP 세션 ID. 요청 컨텍스트 밖이면 프로세스 단위 ID 를 돌려줍니다."""
    try:
        from fastmcp.server.dependencies import get_context

        return get_context().session_id
    except Exception:
        return _PROCESS_SESSION_ID


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(_DDL)
    # 예전 스키마(params 없음)로 만든 파일도 그대로 쓰도록 빠진 컬럼을 붙입니다
    existing = {row[1] for row in conn.execute("PRAGMA table_info(audit_log)")}
    if "params" not in existing:
        conn.execute("ALTER TABLE audit_log ADD COLUMN params TEXT")
    return conn


def _sync_insert(db_path: Path, record: dict[str, Any]) -> None:
    conn = _connect(db_path)
    try:
        placeholders = ", ".join(f":{c}" for c in _COLUMNS)
        conn.execute(f"INSERT INTO audit_log ({', '.join(_COLUMNS)}) VALUES ({placeholders})", record)
        conn.commit()
    finally:
        conn.close()


def _sync_purge(db_path: Path, retention_days: int) -> int:
    if not db_path.exists():
        return 0
    cutoff = (datetime.now(UTC) - timedelta(days=retention_days)).isoformat()
    conn = sqlite3.connect(db_path)
    try:
        # call_time 은 UTC ISO 8601 문자열이라 문자열 비교로 시간 순서를 비교할 수 있습니다
        cur = conn.execute("DELETE FROM audit_log WHERE call_time < ?", (cutoff,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def _resolve_path(db_path: str | Path | None) -> Path:
    if db_path is not None:
        return Path(db_path)
    from nl2sql_mcp.config import settings

    return Path(settings.audit_log_path)


def build_record(
    event: AuditEvent,
    *,
    status: str,
    latency_ms: float,
    session_id: str,
    call_time: datetime | None = None,
) -> dict[str, Any]:
    """DB 에 넣을 한 행. SQL 과 파라미터 값은 PII 정규식으로 가린 뒤 저장합니다."""
    params = {k: mask_pii(v) if isinstance(v, str) else v for k, v in event.params.items()}
    return {
        "call_time": (call_time or datetime.now(UTC)).isoformat(),
        "session_id": session_id,
        "tool_name": event.tool,
        "sql_text": mask_pii(event.sql) if event.sql else None,
        "result_status": status,
        "latency_ms": latency_ms,
        "row_count": event.row_count,
        "error_type": event.error_type,
        "params": json.dumps(params, ensure_ascii=False, default=str) if params else None,
    }


async def write_audit_record(record: dict[str, Any], db_path: str | Path | None = None) -> None:
    """한 행을 기록합니다. 기록 실패는 도구 응답을 막지 않고 경고 로그만 남겨요."""
    try:
        await asyncio.to_thread(_sync_insert, _resolve_path(db_path), record)
    except Exception as e:
        logger.warning("감사 로그 기록 실패: %s", e)


@asynccontextmanager
async def audit_call(
    tool: str,
    *,
    sql: str | None = None,
    params: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> AsyncIterator[AuditEvent]:
    """도구 호출 한 건을 감싸 성공, 차단, 오류와 소요 시간을 기록하는 async context manager.

    Usage:
        async with audit_call("run_sql_query", sql=sql) as event:
            result = ...
            event.row_count = result["row_count"]
    """
    event = AuditEvent(tool=tool, sql=sql, params=dict(params or {}))
    session_id = current_session_id()
    start = time.perf_counter()
    try:
        yield event
    except BaseException as exc:
        if isinstance(exc, asyncio.CancelledError):
            event.error_type = event.error_type or "CANCELLED"
        else:
            event.error_type = event.error_type or error_code(exc)
        raise
    finally:
        latency_ms = round((time.perf_counter() - start) * 1000, 3)
        record = build_record(
            event,
            status=status_for(event.error_type),
            latency_ms=latency_ms,
            session_id=session_id,
        )
        await write_audit_record(record, db_path)
        logger.debug("audit: %s", json.dumps(record, ensure_ascii=False, default=str))


async def purge_old_audit_records(
    db_path: str | Path | None = None,
    retention_days: int = 30,
) -> int:
    """``retention_days`` 보다 오래된 감사 로그를 지우고 지운 행 수를 돌려줍니다 (서버 시작 시 1회)."""
    return await asyncio.to_thread(_sync_purge, _resolve_path(db_path), retention_days)
