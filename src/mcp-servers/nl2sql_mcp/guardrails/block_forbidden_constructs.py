"""가드레일 7.5: 금지 구문 차단형 가드레일 (optional).

금지 목록은 dialect 가 갖습니다.
- Oracle: DBLINK(@), SYS/SYSTEM 등 시스템 스키마, DBA_/CDB_ 딕셔너리 뷰, V$/GV$ 뷰, DBMS_ 패키지,
  EXECUTE IMMEDIATE, 위험 힌트
- Postgres: pg_catalog/information_schema 스키마, pg_* 시스템 카탈로그, dblink(), 위험 힌트(pg_hint_plan)

검사 텍스트
- 금지 객체와 다중 문장 규칙은 주석을 지우고 문자열 리터럴을 비운 코드 텍스트(:func:`code_text`)에
  적용합니다. ``WHERE email = 'a@b.com'``, ``/* @not_a_dblink */`` 는 통과해요.
- 힌트 규칙은 힌트가 주석 형태라 원문에 적용합니다.
- 동적 SQL(EXECUTE, PREPARE, DO)과 COPY 는 단어가 아니라 문장 종류(AST)로 판단합니다. 그래서
  ``copy``, ``execute`` 라는 이름의 컬럼은 막지 않습니다. 파이프라인에서는 7.1 이 먼저 막고,
  이 함수만 따로 불러도 같은 판단을 합니다.

GUARDRAIL_FORBIDDEN_ENABLED=False 시 pass-through.
"""

from __future__ import annotations

from _common.errors import AccessDeniedError
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.enforce_select_only import statement_kind
from nl2sql_mcp.guardrails.sql_ast import ParseError, TokenError, code_text, parse_statements


def _blocked(label: str) -> AccessDeniedError:
    return AccessDeniedError(f"Blocked by security policy: {label}. [FORBIDDEN_SQL_BLOCKED]")


async def block_forbidden_constructs(
    sql: str,
    enabled: bool = True,
    dialect: SQLDialect | None = None,
) -> str:
    """금지 구문이 포함된 SQL 을 차단한다. 통과 시 원본 SQL 반환."""
    if not enabled:
        return sql
    dialect = dialect or get_dialect()

    try:
        text = code_text(sql, dialect)
    except TokenError:
        text = sql  # 토큰화가 안 되면 원문으로 보수적으로 검사합니다

    for pattern, label in dialect.forbidden_rules:
        if pattern.search(text):
            raise _blocked(label)
    for pattern, label in dialect.hint_rules:
        if pattern.search(sql):
            raise _blocked(label)

    try:
        stmts = parse_statements(sql, dialect)
    except (ParseError, TokenError):
        stmts = []
    if any(statement_kind(s) == "dynamic" for s in stmts):
        raise _blocked("dynamic SQL and file I/O (EXECUTE, PREPARE, DO, COPY)")
    return sql
