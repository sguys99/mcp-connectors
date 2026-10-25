"""가드레일 7.9: 위험 SQL 탐지 차단형 가드레일 (optional).

정상적인 ``UNION``/``UNION ALL`` 은 허용하고, 정적 분석으로 알 수 있는 injection 신호만 막습니다.

- UNION 가지가 FROM 없이 상수만 고르는 경우(``... UNION SELECT 1``, ``UNION SELECT NULL FROM DUAL``):
  컬럼 수를 맞춰 보는 전형적인 injection 탐색이라 막습니다.
- UNION 가지가 시스템 카탈로그(``pg_shadow``, ``SYS.USER$``, ``DBA_USERS`` 등)를 읽는 경우.
  7.5 를 꺼도 UNION 으로 시스템 정보를 빼내는 길은 막히게 둡니다.
- dialect 별 위험 시스템 함수 (Oracle UTL_*/DBMS_SQL/DBMS_PIPE/DBMS_METADATA, Postgres
  pg_read_file/pg_sleep 등)
- object_whitelist 가 주어지면 허용 테이블 밖의 참조

함수와 UNION 검사는 주석을 지우고 문자열 리터럴을 비운 코드 텍스트와 AST 로 합니다.
``WHERE title = 'UNION SELECT'`` 나 ``/* UNION SELECT */`` 주석은 오탐하지 않아요.
따옴표가 맞지 않는 SQL(인용부호 불일치)은 7.1 이 ``RISKY_SQL_BLOCKED`` 로 먼저 막습니다.
GUARDRAIL_RISKY_SQL_ENABLED=False 시 pass-through.
"""

from __future__ import annotations

import sqlglot.expressions as exp

from _common.errors import AccessDeniedError
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.sql_ast import (
    TokenError,
    base_tables,
    code_text,
    parse_query,
    scope_tables,
)


def _risky(message: str) -> AccessDeniedError:
    return AccessDeniedError(f"{message} [RISKY_SQL_BLOCKED]")


def _branches(node: exp.Expression) -> list[exp.Expression]:
    """집합 연산의 가지를 펼칩니다 (괄호로 감싼 가지 포함)."""
    if isinstance(node, exp.SetOperation):
        return [*_branches(node.this), *_branches(node.expression)]
    if isinstance(node, exp.Subquery):
        return _branches(node.this)
    return [node]


def _is_constant_branch(branch: exp.Expression) -> bool:
    """FROM 이 없거나 DUAL 만 읽는 SELECT 가지."""
    if not isinstance(branch, exp.Select):
        return False
    tables = scope_tables(branch)
    from_ = branch.args.get("from_") or branch.args.get("from")
    if from_ is None:
        return True
    return bool(tables) and all(t.name == "dual" for t in tables) and not branch.args.get("joins")


def _check_unions(root: exp.Expression, dialect: SQLDialect) -> None:
    for setop in root.find_all(exp.SetOperation):
        for branch in _branches(setop):
            if _is_constant_branch(branch):
                raise _risky(
                    "A UNION branch selects only constants without a table (the UNION SELECT 1 form). "
                    "It is blocked as a SQL injection probing pattern. "
                    "Combine only SELECTs that read real tables."
                )
            branch_sql = code_text(branch.sql(dialect=dialect.sqlglot_name), dialect)
            if dialect.system_object_re.search(branch_sql):
                raise _risky(
                    "Detected a SQL injection pattern that reads the system catalog through UNION."
                )


async def detect_risky_sql(
    sql: str,
    enabled: bool = True,
    object_whitelist: list[str] | None = None,
    dialect: SQLDialect | None = None,
) -> str:
    """위험 SQL 패턴을 탐지하고 차단한다. 통과 시 원본 SQL 반환."""
    if not enabled:
        return sql
    dialect = dialect or get_dialect()

    try:
        clean = code_text(sql, dialect)
    except TokenError as e:
        raise _risky("The SQL has an unclosed quote or comment (mismatched quotation marks).") from e

    if dialect.risky_function_re.search(clean):
        raise _risky(f"Calling {dialect.risky_function_label} is not allowed.")

    root = parse_query(sql, dialect)
    if root is not None:
        _check_unions(root, dialect)

        # object_whitelist 기반 허용 테이블 외 참조 차단
        if object_whitelist:
            allowed = {t.lower() for t in object_whitelist}
            for ref in base_tables(root):
                if ref.name not in allowed:
                    raise _risky(f"Reference to the disallowed table '{ref.name}'.")

    return sql
