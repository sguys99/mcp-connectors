"""가드레일 공용 SQL 분석 도구 (sqlglot 기반).

정규식 가드레일이 주석과 문자열 리터럴 안의 글자에 반응하던 오탐을 없애려고, 검사 대상 텍스트를
sqlglot 토크나이저로 다시 만듭니다. 쿼리 구조(SELECT 범위, 테이블, 행 수 제한)는 AST 로 봅니다.

- :func:`code_text` 는 주석을 빼고 문자열 리터럴을 ``''`` 로 바꾼 "코드만 남은" SQL 입니다.
  ``WHERE email = 'a@b.com'`` 의 ``@``, ``/* UNION SELECT */`` 같은 글자는 여기서 사라져요.
- :func:`code_end` 는 끝의 주석과 세미콜론을 뺀 본문 끝 위치입니다. 행 수 제한 절을 덧붙일 때
  ``-- 주석`` 안으로 들어가지 않게 합니다.
- :func:`select_scopes` 는 UNION 가지, 서브쿼리, CTE 본문을 포함한 모든 SELECT 를 돌려줍니다.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlglot
import sqlglot.expressions as exp
from sqlglot.errors import ParseError, TokenError
from sqlglot.tokens import Token, TokenType

from nl2sql_mcp.db.dialects import SQLDialect

__all__ = [
    "ParseError",
    "TokenError",
    "TableRef",
    "code_end",
    "code_text",
    "parse_statements",
    "parse_query",
    "select_scopes",
    "scope_tables",
    "base_tables",
    "first_keyword",
]


def tokenize(sql: str, dialect: SQLDialect) -> list[Token]:
    """dialect 토크나이저로 토큰을 만듭니다. 따옴표가 맞지 않으면 TokenError."""
    return sqlglot.Dialect.get_or_raise(dialect.sqlglot_name).tokenize(sql)


def _is_string(token: Token) -> bool:
    return token.token_type.name.endswith("STRING")


def code_text(sql: str, dialect: SQLDialect) -> str:
    """주석을 지우고 문자열 리터럴을 ``''`` 로 바꾼 SQL. 토큰 사이는 공백 하나로 잇습니다."""
    parts: list[str] = []
    for token in tokenize(sql, dialect):
        parts.append("''" if _is_string(token) else sql[token.start : token.end + 1])
    return " ".join(parts)


def code_end(sql: str, dialect: SQLDialect) -> int:
    """끝의 세미콜론과 주석을 뺀 본문이 끝나는 위치(슬라이스 끝 인덱스)."""
    tokens = [t for t in tokenize(sql, dialect) if t.token_type != TokenType.SEMICOLON]
    return tokens[-1].end + 1 if tokens else 0


def first_keyword(sql: str, dialect: SQLDialect) -> str:
    """첫 토큰의 대문자 텍스트. 토큰화가 안 되면 첫 단어를 씁니다."""
    try:
        tokens = tokenize(sql, dialect)
    except TokenError:
        words = sql.split()
        return words[0].upper() if words else ""
    return tokens[0].text.upper() if tokens else ""


def parse_statements(sql: str, dialect: SQLDialect) -> list[exp.Expression]:
    """여러 문장을 파싱합니다(빈 문장 제외). ParseError/TokenError 는 호출자가 처리합니다."""
    return [s for s in sqlglot.parse(sql, dialect=dialect.sqlglot_name) if s is not None]


def parse_query(sql: str, dialect: SQLDialect) -> exp.Expression | None:
    """단일 문장을 파싱합니다. 실패하거나 문장이 하나가 아니면 None."""
    try:
        stmts = parse_statements(sql, dialect)
    except (ParseError, TokenError):
        return None
    return stmts[0] if len(stmts) == 1 else None


def select_scopes(root: exp.Expression) -> list[exp.Select]:
    """트리 안의 모든 SELECT (UNION 가지, 서브쿼리, CTE 본문 포함). 순서는 바깥에서 안쪽."""
    return list(root.find_all(exp.Select, bfs=True))


@dataclass(frozen=True)
class TableRef:
    """SELECT 의 FROM/JOIN 에 직접 나온 실제 테이블 (CTE 이름 제외)."""

    name: str  # 소문자
    schema: str | None  # 소문자, 없으면 None
    alias: str  # 별칭이 없으면 테이블 이름 (원래 표기)


def _cte_names(node: exp.Expression) -> set[str]:
    names: set[str] = set()
    cur: exp.Expression | None = node
    while cur is not None:
        with_ = cur.args.get("with_") or cur.args.get("with")
        if isinstance(with_, exp.With):
            names.update(cte.alias_or_name.lower() for cte in with_.expressions)
        cur = cur.parent
    return names


def scope_tables(select: exp.Select) -> list[TableRef]:
    """SELECT 하나의 FROM 과 JOIN 에 직접 나온 실제 테이블을 FROM 순서대로 돌려줍니다."""
    nodes: list[exp.Expression] = []
    from_ = select.args.get("from_") or select.args.get("from")
    if from_ is not None:
        nodes.append(from_.this)
        # 콤마 조인은 sqlglot 버전에 따라 From.expressions 에 들어가기도 합니다
        nodes.extend(from_.expressions or [])
    nodes.extend(j.this for j in select.args.get("joins") or [])
    ctes = _cte_names(select)
    refs: list[TableRef] = []
    for node in nodes:
        if not isinstance(node, exp.Table) or not node.name:
            continue
        name = node.name.lower()
        if name in ctes and not node.db:
            continue
        refs.append(
            TableRef(name=name, schema=node.db.lower() or None, alias=node.alias_or_name),
        )
    return refs


def base_tables(root: exp.Expression) -> list[TableRef]:
    """쿼리 전체에서 참조한 실제 테이블 (중복 제거, 처음 나온 순서)."""
    seen: dict[tuple[str | None, str], TableRef] = {}
    for select in select_scopes(root):
        for ref in scope_tables(select):
            seen.setdefault((ref.schema, ref.name), ref)
    return list(seen.values())
