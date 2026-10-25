"""가드레일 7.1: SELECT 전용 차단형 가드레일.

SELECT, WITH ... SELECT 와 그 집합 연산(UNION, UNION ALL, INTERSECT, EXCEPT/MINUS)만 허용합니다.
sqlglot AST 로 문장 종류를 보고, 트리 안쪽에 숨은 쓰기(``WITH x AS (DELETE ... RETURNING *)``,
``SELECT ... INTO``)도 막습니다.

에러 코드 기준
- 빈 SQL, 공백만 있는 SQL: ``INVALID_INPUT``
- 쓰기, DDL, DCL 문장: ``WRITE_BLOCKED``
- 동적 SQL, 서버 파일 입출력 문장(EXECUTE, PREPARE, DEALLOCATE, DO, COPY): ``FORBIDDEN_SQL_BLOCKED``
  (7.5 와 같은 범주라 같은 코드를 씁니다. 7.5 를 꺼도 문장 자체는 여기서 막혀요)
- 여러 문장: 하나라도 쓰기면 ``WRITE_BLOCKED``, 모두 SELECT 면 stacked query 로 보고
  ``FORBIDDEN_SQL_BLOCKED``
- 따옴표가 맞지 않는 SQL: ``RISKY_SQL_BLOCKED`` (7.9 인용부호 불일치)
- 그 밖의 구문 오류: 첫 단어가 쓰기 키워드면 ``WRITE_BLOCKED``, 아니면 ``INVALID_SQL``
"""

from __future__ import annotations

import sqlglot.expressions as exp

from _common.errors import AccessDeniedError, InvalidInputError
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.sql_ast import ParseError, TokenError, first_keyword, parse_statements

# 7.1 denylist (정의서 §7.1). 파싱이 안 되는 SQL 도 첫 단어로 쓰기 의도를 판단합니다
WRITE_KEYWORDS = frozenset(
    {
        "INSERT",
        "UPDATE",
        "DELETE",
        "MERGE",
        "UPSERT",
        "REPLACE",
        "TRUNCATE",
        "DROP",
        "ALTER",
        "CREATE",
        "RENAME",
        "GRANT",
        "REVOKE",
        "COMMENT",
        "CALL",
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "SAVEPOINT",
        "SET",
        "LOCK",
        "VACUUM",
        "ANALYZE",
        "REINDEX",
        "CLUSTER",
        "REFRESH",
    }
)
# 동적 SQL, 파일 입출력 문장. sqlglot 은 대부분 Command 로 파싱합니다
DYNAMIC_KEYWORDS = frozenset({"EXECUTE", "EXEC", "PREPARE", "DEALLOCATE", "DO", "COPY"})

_WRITE_NODES: tuple[type[exp.Expression], ...] = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.TruncateTable,
)


def _forbidden(label: str) -> AccessDeniedError:
    return AccessDeniedError(f"Blocked by security policy: {label}. [FORBIDDEN_SQL_BLOCKED]")


def statement_kind(stmt: exp.Expression) -> str:
    """``select`` / ``dynamic`` / ``write`` 중 하나."""
    if isinstance(stmt, exp.Copy):
        return "dynamic"
    if isinstance(stmt, exp.Command):
        keyword = str(stmt.this).upper()
        return "dynamic" if keyword in DYNAMIC_KEYWORDS else "write"
    if isinstance(stmt, exp.Query) and isinstance(stmt, (exp.Select, exp.SetOperation)):
        if any(stmt.find_all(*_WRITE_NODES)):
            return "write"
        if any(s.args.get("into") for s in stmt.find_all(exp.Select)):
            return "write"  # SELECT ... INTO 는 테이블을 만듭니다
        return "select"
    return "write"


async def enforce_select_only(sql: str, dialect: SQLDialect | None = None) -> str:
    """SELECT 계열 이외의 SQL 구문을 차단한다. 통과 시 원본 SQL 반환."""
    dialect = dialect or get_dialect()
    stripped = sql.strip()
    if not stripped:
        raise InvalidInputError("The SQL is empty. Provide a SELECT statement. [INVALID_INPUT]")

    try:
        stmts = parse_statements(stripped, dialect)
    except TokenError as e:
        raise AccessDeniedError(
            "The SQL has an unclosed quote or comment (mismatched quotation marks). [RISKY_SQL_BLOCKED]"
        ) from e
    except ParseError as e:
        keyword = first_keyword(stripped, dialect)
        if keyword in WRITE_KEYWORDS:
            raise AccessDeniedError(
                f"'{keyword}' statements are not allowed. "
                "Only SELECT or WITH may be used. [WRITE_BLOCKED]"
            ) from e
        if keyword in DYNAMIC_KEYWORDS:
            raise _forbidden(f"dynamic SQL and file I/O ({keyword})") from e
        first_line = str(e).splitlines()[0] if str(e) else "syntax error"
        raise InvalidInputError(
            f"SQL syntax error ({first_line}). Check the column and table names with get_table_schema. "
            "[INVALID_SQL]"
        ) from e

    if not stmts:
        raise InvalidInputError("The SQL is empty. Provide a SELECT statement. [INVALID_INPUT]")

    kinds = [statement_kind(s) for s in stmts]
    if len(stmts) > 1:
        if "write" in kinds:
            raise AccessDeniedError(
                f"The multiple SQL statements ({len(stmts)}) include a write statement. [WRITE_BLOCKED]"
            )
        raise _forbidden(f"multiple SQL statements ({len(stmts)}, separated by semicolons)")

    if kinds[0] == "dynamic":
        raise _forbidden(f"dynamic SQL and file I/O ({first_keyword(stripped, dialect)})")
    if kinds[0] == "write":
        nested = next(iter(stmts[0].find_all(*_WRITE_NODES)), None)
        stmt_type = type(nested or stmts[0]).__name__
        if isinstance(stmts[0], exp.Query) and nested is None:
            stmt_type = "Select Into"
        raise AccessDeniedError(
            f"'{stmt_type}' statements are not allowed. Only SELECT or WITH may be used. [WRITE_BLOCKED]"
        )
    return sql
