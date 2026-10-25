"""starter-mcp FastMCP 진입점.

``tools.py`` 의 plain async function 4 개를 ``mcp.add_tool`` 로, ``primitives.py`` 의
Resources 와 Prompts 를 ``mcp.resource`` / ``mcp.prompt`` 로 명시 등록한다.
이렇게 분리하면 본문에 FastMCP 데코레이터 잡음이 없고, 결합은 본 파일 한 곳에만 존재한다.
리소스나 프롬프트를 하나라도 등록하면 FastMCP 가 ``initialize`` 응답의 capabilities 에
``resources``, ``prompts`` 를 자동으로 싣는다 (stdio, Streamable HTTP 공통).

실행:

    python -m starter_mcp.server --transport stdio    # 기본
    python -m starter_mcp.server --transport http     # 포트 8001
"""

from __future__ import annotations

import argparse

from fastmcp import FastMCP

from _common.auth import build_http_middleware
from starter_mcp import primitives
from starter_mcp.config import settings
from starter_mcp.tools import add, current_time, echo, sample_content

mcp = FastMCP("starter-mcp")

# ── Tools ──
mcp.add_tool(echo)
mcp.add_tool(add)
mcp.add_tool(current_time)
mcp.add_tool(sample_content)

# ── Resources ──
# URI 에 {param} 이 있으면 resource template 으로, 없으면 고정 리소스로 등록된다.
mcp.resource(
    primitives.ABOUT_URI,
    name="about",
    description="Static markdown overview of what starter-mcp provides.",
    mime_type="text/markdown",
)(primitives.about)
mcp.resource(
    primitives.CONFIG_URI,
    name="config",
    description="Non-secret server configuration as JSON (ports, auth on/off, primitive names).",
    mime_type="application/json",
)(primitives.config_info)
mcp.resource(
    primitives.GREETING_URI_TEMPLATE,
    name="greeting",
    description="Greeting for the given name. The name is untrusted input, returned as JSON.",
    mime_type="application/json",
)(primitives.greeting)
mcp.resource(
    primitives.LOGO_URI,
    name="logo",
    description="Small gradient PNG, a binary (blob) resource sample.",
    mime_type="image/png",
)(primitives.logo)

# ── Prompts ──
mcp.prompt(
    name="explain_tool",
    description="Ask the model to explain one tool of this server for a chosen audience.",
)(primitives.explain_tool)
mcp.prompt(
    name="code_review_session",
    description="Multi-message code review setup (user, assistant, user) for a given language.",
)(primitives.code_review_session)


def main() -> None:
    parser = argparse.ArgumentParser(prog="starter-mcp")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default="stdio",
        help="MCP transport (default stdio). http means Streamable HTTP.",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(
            transport="http",
            host="0.0.0.0",
            port=settings.starter_mcp_port,
            middleware=build_http_middleware(
                settings.mcp_api_key,
                # CORS 도 설정과 같은 .env 파일(루트, 패키지 override)을 읽는다
                env_file=settings.model_config.get("env_file"),
            ),
        )


if __name__ == "__main__":
    main()
