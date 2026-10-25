"""가드레일 7.3: 행 수 제한 변환형 가드레일.

최상위 쿼리(UNION 이면 집합 전체)의 행 수 제한을 AST 로 확인합니다. 서브쿼리 안의 ``LIMIT`` 은 결과 행
수를 제한하지 않으므로 무시해요.

- 제한이 없으면 dialect 문법으로 ``max_rows + 1`` 을 덧붙입니다(Postgres ``LIMIT N``,
  Oracle ``FETCH FIRST N ROWS ONLY``). 한 행을 더 받아 보면 백엔드가 결과를 ``max_rows`` 로 자르면서
  ``truncated: true`` 를 정확히 표시할 수 있습니다.
- 명시한 제한이 ``max_rows`` 보다 크면 ``max_rows + 1`` 로 낮춥니다(같은 이유).
- ``max_rows`` 이하로 명시한 제한, Oracle ``ROWNUM`` 조건은 그대로 둡니다.
- 덧붙일 때는 끝의 세미콜론과 주석을 먼저 떼므로 ``... -- 주석`` 으로 끝나는 SQL 에서도 제한 절이
  주석 안으로 들어가지 않습니다.

``max_rows`` 는 ``max_limit`` 으로 먼저 클램핑합니다.
"""

from __future__ import annotations

import re

import sqlglot.expressions as exp

from _common.errors import InvalidInputError
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.sql_ast import code_end, parse_query

_LIMIT_ALL_RE = re.compile(r"\s+LIMIT\s+ALL\s*$", re.IGNORECASE)


def _literal_int(node: exp.Expression | None) -> int | None:
    if isinstance(node, exp.Literal) and not node.is_string:
        try:
            return int(node.name)
        except ValueError:
            return None
    return None


def top_level_limit(root: exp.Expression) -> tuple[exp.Expression | None, int | None]:
    """최상위 쿼리의 ``(제한 노드, 값)``. 제한이 없으면 ``(None, None)``, 값이 식이면 값만 None."""
    node = root.args.get("limit")
    if isinstance(node, exp.Limit):
        return node, _literal_int(node.expression)
    if isinstance(node, exp.Fetch):
        return node, _literal_int(node.args.get("count"))
    return None, None


def _has_rownum(root: exp.Expression) -> bool:
    where = root.args.get("where") if isinstance(root, exp.Select) else None
    return where is not None and any(c.name.upper() == "ROWNUM" for c in where.find_all(exp.Column))


async def enforce_row_limit(
    sql: str,
    max_rows: int = 1000,
    max_limit: int = 10000,
    dialect: SQLDialect | None = None,
) -> str:
    """행 수 제한 절을 자동 주입하고 상한을 클램핑한다. 보정된 SQL 반환."""
    if max_rows <= 0:
        raise InvalidInputError(f"max_rows must be 1 or greater (got: {max_rows}). [INVALID_INPUT]")
    dialect = dialect or get_dialect()
    effective = min(max_rows, max_limit)
    fetch_n = effective + 1  # truncated 판정용으로 한 행 더

    root = parse_query(sql, dialect)
    if root is None:
        # 파싱이 안 되는 SQL 은 7.1 이 이미 막습니다. 직접 부를 때만 예전 방식으로 처리
        return sql if dialect.has_row_limit(sql) else dialect.apply_row_limit(sql, fetch_n)

    node, value = top_level_limit(root)
    if node is not None:
        if value is not None and value <= effective:
            return sql
        if isinstance(node, exp.Fetch):
            node.set("count", exp.Literal.number(fetch_n))
        else:
            node.set("expression", exp.Literal.number(fetch_n))
        return root.sql(dialect=dialect.sqlglot_name)

    if dialect.name == "oracle" and _has_rownum(root):
        return sql

    body = sql[: code_end(sql, dialect)].rstrip()
    body = _LIMIT_ALL_RE.sub("", body)  # LIMIT ALL 은 제한이 없는 것과 같습니다
    return f"{body} {dialect.render_row_limit(fetch_n)}"
