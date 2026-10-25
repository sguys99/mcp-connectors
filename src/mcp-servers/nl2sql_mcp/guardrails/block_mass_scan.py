"""가드레일 7.7: 전수 스캔 차단형 가드레일.

SELECT 하나하나(UNION 가지, 서브쿼리, CTE 본문 포함)를 AST 로 보고 아래를 막습니다.

1. 무력화 조건: ``WHERE 1=1``, ``WHERE TRUE`` 로 시작하는 조건, ``OR 1=1`` 같은 항상 참인 OR 조건
2. 카티시안 조인: 테이블이 둘 이상인데 WHERE 도 없고 ON/USING 없는 조인(콤마, CROSS JOIN)이 있는 경우
3. WHERE 없는 조회(``require_where``): 그 SELECT 와 바깥 SELECT 어디에도 WHERE 가 없으면, 읽는 실제
   테이블이 모두 작은 테이블일 때만 허용합니다. 작은 테이블은 카탈로그 행 수 추정치가
   ``row_threshold``(``GUARDRAIL_MASS_SCAN_ROW_THRESHOLD``, 기본 10000) 이하인 테이블이에요.
   추정치를 모르는 테이블(통계 없는 뷰, 추정 함수를 주지 않은 경우)은 큰 테이블로 봅니다.

집계(``COUNT(*)``, ``GROUP BY``)도 같은 기준을 씁니다. 집계는 결과가 몇 행이든 테이블 전체를 읽기 때문에,
WHERE 없는 집계는 작은 테이블에서만 허용합니다. ``LIMIT`` 이 있어도 WHERE 없는 큰 테이블 조회는
막아요(7.3 이 모든 쿼리에 LIMIT 을 붙이므로 LIMIT 을 면제 조건으로 쓰면 이 가드레일이 의미가 없습니다).
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable

import sqlglot.expressions as exp

from _common.errors import AccessDeniedError
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.sql_ast import (
    TableRef,
    TokenError,
    code_text,
    parse_query,
    scope_tables,
    select_scopes,
)

# 행 수 추정 함수: 테이블 목록을 받아 {테이블 이름(소문자): 추정 행 수 또는 None} 을 돌려줍니다
RowEstimator = Callable[[list[TableRef]], Awaitable[dict[str, int | None]]]

DEFAULT_ROW_THRESHOLD = 10000

# 코드 텍스트(문자열은 '' 로 비워짐) 기준
_TAUTOLOGY = re.compile(
    r"\bWHERE\s+\(?\s*(?:1\s*=\s*1|TRUE|''\s*=\s*'')(?![\w.])"
    r"|\bOR\s+\(?\s*(?:1\s*=\s*1|TRUE|''\s*=\s*''|(\d+)\s*=\s*\1)(?![\w.])",
    re.IGNORECASE,
)


def _blocked(message: str) -> AccessDeniedError:
    return AccessDeniedError(f"{message} [MASS_SCAN_BLOCKED]")


def _has_where_in_chain(select: exp.Select) -> bool:
    node: exp.Expression | None = select
    while node is not None:
        if isinstance(node, exp.Select) and node.args.get("where") is not None:
            return True
        node = node.parent
    return False


def _is_cartesian(select: exp.Select) -> bool:
    if select.args.get("where") is not None:
        return False
    joins = select.args.get("joins") or []
    for join in joins:
        kind = (join.args.get("kind") or "").upper()
        has_cond = join.args.get("on") is not None or join.args.get("using")
        if kind == "CROSS" or not has_cond:
            # NATURAL JOIN 과 LATERAL 은 조건이 암묵적이라 제외합니다
            if join.args.get("method") or isinstance(join.this, exp.Lateral):
                continue
            return True
    return False


async def block_mass_scan(
    sql: str,
    require_where: bool = True,
    block_tautology: bool = True,
    block_cartesian: bool = True,
    row_estimator: RowEstimator | None = None,
    row_threshold: int = DEFAULT_ROW_THRESHOLD,
    dialect: SQLDialect | None = None,
) -> str:
    """전수 스캔 패턴의 SQL 을 차단한다. 통과 시 원본 SQL 반환."""
    dialect = dialect or get_dialect()
    try:
        text = code_text(sql, dialect)
    except TokenError:  # 따옴표 불일치는 7.1 이 이미 막습니다
        text = sql

    if block_tautology and _TAUTOLOGY.search(text):
        raise _blocked(
            "Full-scan conditions (WHERE 1=1, TRUE, OR 1=1) are not allowed. "
            "Narrow the scope with a real condition."
        )

    root = parse_query(sql, dialect)
    if root is None:
        return sql
    scopes = select_scopes(root)

    if block_cartesian:
        for select in scopes:
            if len(scope_tables(select)) + _derived_count(select) > 1 and _is_cartesian(select):
                raise _blocked(
                    "Cartesian joins without a join condition (ON/WHERE) are not allowed. "
                    "Narrow the scope with a join key."
                )

    if not require_where:
        return sql

    unfiltered: list[TableRef] = []
    for select in scopes:
        if _has_where_in_chain(select):
            continue
        unfiltered.extend(scope_tables(select))
    if not unfiltered:
        return sql

    estimates: dict[str, int | None] = {}
    if row_estimator is not None:
        try:
            estimates = await row_estimator(unfiltered)
        except Exception:
            # 추정에 실패하면 모든 테이블을 "모름"(큰 테이블)으로 봅니다
            estimates = {}

    large: list[str] = []
    for ref in dict.fromkeys(unfiltered):
        rows = estimates.get(ref.name)
        if rows is None:
            large.append(f"{ref.name} (row count unknown)")
        elif rows > row_threshold:
            large.append(f"{ref.name} (about {rows:,} rows)")
    if large:
        raise _blocked(
            f"Queries without a WHERE condition are allowed only on small tables of "
            f"{row_threshold:,} rows or fewer. "
            f"Large tables: {', '.join(large)}. Add a WHERE condition."
        )
    return sql


def _derived_count(select: exp.Select) -> int:
    """FROM/JOIN 의 서브쿼리 개수 (카티시안 판정용)."""
    nodes: list[exp.Expression] = []
    from_ = select.args.get("from_") or select.args.get("from")
    if from_ is not None:
        nodes.append(from_.this)
    nodes.extend(j.this for j in select.args.get("joins") or [])
    return sum(1 for n in nodes if isinstance(n, exp.Subquery))
