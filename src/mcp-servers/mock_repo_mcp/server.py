"""mock-repo-mcp FastMCP 진입점.

``tools.py`` 의 plain async function 3 개를 ``mcp.add_tool`` 로 명시 등록한다.

실행:

    python -m mock_repo_mcp.server --transport http     # 기본 — 포트 8002
    python -m mock_repo_mcp.server --transport stdio    # 패턴 일관성용 (Makefile 미노출)
"""

from __future__ import annotations

import argparse

from fastmcp import FastMCP

from _common.auth import build_http_middleware
from mock_repo_mcp.config import settings
from mock_repo_mcp.tools import get_file_content, list_repositories, search_code

mcp = FastMCP("mock-repo-mcp")
mcp.add_tool(list_repositories)
mcp.add_tool(get_file_content)
mcp.add_tool(search_code)


def main() -> None:
    parser = argparse.ArgumentParser(prog="mock-repo-mcp")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default="http",
        help="MCP transport (default http, Streamable HTTP). Inspector and Chat connect directly.",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(
            transport="http",
            host="0.0.0.0",
            port=settings.mock_repo_mcp_port,
            middleware=build_http_middleware(
                settings.mcp_api_key,
                # CORS 도 설정과 같은 .env 파일(루트, 패키지 override)을 읽는다
                env_file=settings.model_config.get("env_file"),
            ),
        )


if __name__ == "__main__":
    main()
