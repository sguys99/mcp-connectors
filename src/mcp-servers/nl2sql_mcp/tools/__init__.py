"""도구 함수 모음과 등록 함수.

도구 모듈은 서버 인스턴스를 import 하지 않는 평범한 async 함수입니다. 백엔드는
:mod:`nl2sql_mcp.state` 에서 꺼내므로, ``server.py`` 가 :func:`register_tools` 를 부르기 전후의
import 순서와 관계없이 순환 참조가 생기지 않아요.
"""

from __future__ import annotations

from fastmcp import FastMCP

from nl2sql_mcp.tools.get_table_schema import get_table_schema
from nl2sql_mcp.tools.get_tables_schema import get_tables_schema
from nl2sql_mcp.tools.run_sql_query import run_sql_query
from nl2sql_mcp.tools.search_columns import search_columns
from nl2sql_mcp.tools.search_tables_schema import search_tables_schema

# 모든 도구가 읽기 전용입니다 (스펙 §5.1)
READ_ONLY_ANNOTATIONS = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}

TOOLS = (
    search_tables_schema,
    search_columns,
    get_table_schema,
    get_tables_schema,
    run_sql_query,
)

__all__ = ["READ_ONLY_ANNOTATIONS", "TOOLS", "register_tools", *(t.__name__ for t in TOOLS)]


def register_tools(mcp: FastMCP) -> FastMCP:
    """``TOOLS`` 를 ``mcp`` 에 등록하고 같은 인스턴스를 돌려줍니다."""
    for fn in TOOLS:
        mcp.tool(fn, annotations=READ_ONLY_ANNOTATIONS)
    return mcp
