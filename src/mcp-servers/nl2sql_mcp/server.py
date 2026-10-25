"""nl2sql-mcp FastMCP 진입점.

대형 RDB 스키마 온디맨드 탐색 및 Read-Only SELECT 실행을 지원하는 MCP 서버.
DB 종류는 NL2SQL_DB_DIALECT(postgres 기본, oracle), 백엔드는 NL2SQL_DB_BACKEND(mock 기본, real)로 고른다.
스펙: docs/mcp-spec/nl2sql-mcp_v0.1.md

구조: 도구는 ``tools/`` 의 평범한 함수이고 :func:`create_server` 가 ``register_tools()`` 로 등록합니다.
도구는 이 모듈을 import 하지 않고 ``nl2sql_mcp.state`` 에서 백엔드를 꺼내므로 import 순환이 없어요.

실행:
    python -m nl2sql_mcp.server --transport stdio    # IDE 통합
    python -m nl2sql_mcp.server --transport http     # Streamable HTTP :8004
"""

from __future__ import annotations

import argparse
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastmcp import FastMCP

from _common.auth import build_http_middleware
from _common.logging import setup_logger
from nl2sql_mcp.config import settings
from nl2sql_mcp.db import get_backend
from nl2sql_mcp.guardrails import purge_old_audit_records
from nl2sql_mcp.state import state
from nl2sql_mcp.tools import register_tools

logger = setup_logger("nl2sql_mcp")


@asynccontextmanager
async def lifespan(app: FastMCP) -> AsyncIterator[None]:
    """서버 시작 시 DB 백엔드 초기화와 오래된 감사 로그 정리, 종료 시 정리."""
    state.backend = await get_backend()
    purged = await purge_old_audit_records(
        db_path=settings.audit_log_path,
        retention_days=settings.audit_retention_days,
    )
    logger.info(
        "nl2sql-mcp 시작. dialect=%s backend=%s audit=%s (보존 %d일, 정리 %d건)",
        settings.nl2sql_db_dialect,
        settings.nl2sql_db_backend,
        settings.audit_log_path,
        settings.audit_retention_days,
        purged,
    )
    try:
        yield
    finally:
        if hasattr(state.backend, "close"):
            await state.backend.close()
        state.backend = None
        logger.info("nl2sql-mcp 종료.")


def create_server() -> FastMCP:
    """도구 5종을 등록한 FastMCP 인스턴스를 만듭니다."""
    return register_tools(FastMCP("nl2sql-mcp", lifespan=lifespan))


mcp = create_server()


def main() -> None:
    parser = argparse.ArgumentParser(prog="nl2sql-mcp")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default="http",
        help="MCP transport (default http, Streamable HTTP).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=settings.nl2sql_mcp_port,
        help=f"HTTP port (default {settings.nl2sql_mcp_port})",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="HTTP host (default 0.0.0.0)",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(
            transport="http",
            host=args.host,
            port=args.port,
            middleware=build_http_middleware(
                settings.mcp_api_key,
                # CORS 도 설정과 같은 .env 파일(루트, 패키지 override)을 읽는다
                env_file=settings.model_config.get("env_file"),
            ),
        )


if __name__ == "__main__":
    main()
