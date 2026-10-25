"""Oracle dialect. 드라이버는 optional extra(``uv sync --extra oracle``)인 oracledb 입니다."""

from __future__ import annotations

import re

from nl2sql_mcp.db.dialects.base import (
    ANSI_DATE_LITERAL_RE,
    MULTI_STATEMENT_RULE,
    CatalogQueries,
    SQLDialect,
)

# Oracle 내장 시스템 소유자. 카탈로그 검색에서 제외합니다.
SYSTEM_OWNERS = (
    "SYS",
    "SYSTEM",
    "MDSYS",
    "CTXSYS",
    "EXFSYS",
    "FLOWS_FILES",
    "OUTLN",
    "WMSYS",
    "XDB",
    "ANONYMOUS",
    "DBSNMP",
    "SYSMAN",
    "APEX_PUBLIC_USER",
)
_OWNERS_SQL = ",".join(f"'{o}'" for o in SYSTEM_OWNERS)

_FETCH_RE = re.compile(r"\bFETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY\b", re.IGNORECASE)
# ROWNUM <= N 은 N, ROWNUM < N 은 N-1 로 해석해야 하므로 값 추출은 extract_row_limit 에서 따로 처리
_ROWNUM_RE = re.compile(r"\bROWNUM\s*[<>=]", re.IGNORECASE)
_ROWNUM_VALUE_RE = re.compile(r"\bROWNUM\s*(<=?)\s*(\d+)", re.IGNORECASE)
_TRAILING_FETCH_RE = re.compile(
    r"\b(?:OFFSET\s+\d+\s+ROWS?\s+)?FETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY\s*$",
    re.IGNORECASE,
)
_TO_DATE_RE = re.compile(r"TO_DATE\s*\(\s*'(\d{4}-\d{2}-\d{2})'", re.IGNORECASE)

# 7.5 금지 구문. 주석을 지우고 문자열을 비운 코드 텍스트에 적용합니다(문자열 안의 '@', 'SYS.' 는 통과)
_SYSTEM_OBJECT_RE = re.compile(
    r"\b(?:SYS|SYSTEM|SYSMAN|XDB|MDSYS|CTXSYS|OUTLN|WMSYS|DBSNMP)\s*\."
    r"|\b(?:DBA|CDB)_\w+"
    r"|\bG?V_?\$\w+",
    re.IGNORECASE,
)
_FORBIDDEN_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"@[\w$#]+", re.IGNORECASE), "DBLINK (@) reference"),
    (
        re.compile(r"\b(?:SYS|SYSTEM|SYSMAN|XDB|MDSYS|CTXSYS|OUTLN|WMSYS|DBSNMP)\s*\.", re.IGNORECASE),
        "system schema reference (SYS, SYSTEM, etc.)",
    ),
    (re.compile(r"\b(?:DBA|CDB)_\w+", re.IGNORECASE), "admin dictionary view reference (DBA_, CDB_)"),
    (re.compile(r"\bG?V_?\$\w+", re.IGNORECASE), "dynamic performance view reference (V$, GV$)"),
    (re.compile(r"\bDBMS_", re.IGNORECASE), "DBMS_ package call"),
    (re.compile(r"\bEXECUTE\s+IMMEDIATE\b", re.IGNORECASE), "dynamic SQL (EXECUTE IMMEDIATE)"),
    MULTI_STATEMENT_RULE,
)

# 힌트는 주석 형태라 원문 SQL 에 적용합니다
_HINT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"/\*\+\s*(FULL|PARALLEL|NO_INDEX)\b", re.IGNORECASE), "risky hint"),
)

# 7.9 위험 함수: 파일, 네트워크, 동적 SQL, 파이프, 메타데이터 추출
_RISKY_FUNCTION_RE = re.compile(
    r"\b(UTL_FILE|UTL_HTTP|UTL_TCP|UTL_SMTP|UTL_INADDR|UTL_RAW|DBMS_SQL|DBMS_PIPE|DBMS_METADATA"
    r"|DBMS_XMLGEN|DBMS_LOCK|DBMS_SCHEDULER|DBMS_JAVA|HTTPURITYPE)\b",
    re.IGNORECASE,
)

_CATALOG = CatalogQueries(
    search_tables=f"""
        SELECT t.owner, t.table_name, tc.comments, t.num_rows,
               COUNT(*) OVER() AS match_count,
               (SELECT COUNT(*) FROM all_tab_columns tcol
                 WHERE tcol.owner = t.owner AND tcol.table_name = t.table_name)
        FROM all_tables t
        LEFT JOIN all_tab_comments tc
               ON tc.owner = t.owner AND tc.table_name = t.table_name
        WHERE t.table_name LIKE :pattern
          AND t.owner NOT IN ({_OWNERS_SQL})
        ORDER BY t.owner, t.table_name
        FETCH FIRST :lim ROWS ONLY
    """,
    search_columns=f"""
        SELECT col.owner, col.table_name, col.column_name, col.data_type,
               cc.comments, COUNT(*) OVER() AS match_count
        FROM all_tab_columns col
        LEFT JOIN all_col_comments cc
               ON cc.owner = col.owner
              AND cc.table_name = col.table_name
              AND cc.column_name = col.column_name
        WHERE col.column_name LIKE :pattern
          AND col.owner NOT IN ({_OWNERS_SQL})
        ORDER BY col.owner, col.table_name, col.column_id
        FETCH FIRST :lim ROWS ONLY
    """,
    # 시스템 스키마 객체는 search_* 와 마찬가지로 없는 테이블로 봅니다 (T03-009)
    table_meta=f"""
        SELECT t.owner, t.table_name, tc.comments
        FROM all_tables t
        LEFT JOIN all_tab_comments tc
               ON tc.owner = t.owner AND tc.table_name = t.table_name
        WHERE t.table_name = :tname
          AND t.owner NOT IN ({_OWNERS_SQL})
        FETCH FIRST 1 ROWS ONLY
    """,
    table_meta_with_owner=f"""
        SELECT t.owner, t.table_name, tc.comments
        FROM all_tables t
        LEFT JOIN all_tab_comments tc
               ON tc.owner = t.owner AND tc.table_name = t.table_name
        WHERE t.table_name = :tname AND t.owner = :owner
          AND t.owner NOT IN ({_OWNERS_SQL})
        FETCH FIRST 1 ROWS ONLY
    """,
    table_rows=f"""
        SELECT t.owner, t.table_name, 'r', t.num_rows
        FROM all_tables t
        WHERE t.table_name = :tname
          AND (:owner IS NULL OR t.owner = :owner)
          AND t.owner NOT IN ({_OWNERS_SQL})
        FETCH FIRST 1 ROWS ONLY
    """,
    columns="""
        SELECT col.column_name,
               col.data_type || CASE col.data_type
                   WHEN 'VARCHAR2'  THEN '(' || col.char_length || ')'
                   WHEN 'CHAR'      THEN '(' || col.char_length || ')'
                   WHEN 'NVARCHAR2' THEN '(' || col.char_length || ')'
                   WHEN 'NUMBER'    THEN
                       CASE WHEN col.data_precision IS NOT NULL
                            THEN '(' || col.data_precision || ','
                                 || NVL(col.data_scale, 0) || ')'
                            ELSE '' END
                   ELSE '' END AS data_type,
               col.nullable,
               cc.comments
        FROM all_tab_columns col
        LEFT JOIN all_col_comments cc
               ON cc.owner = col.owner
              AND cc.table_name = col.table_name
              AND cc.column_name = col.column_name
        WHERE col.owner = :owner AND col.table_name = :tname
        ORDER BY col.column_id
    """,
    primary_key="""
        SELECT cc.column_name
        FROM all_constraints c
        JOIN all_cons_columns cc
          ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        WHERE c.owner = :owner AND c.table_name = :tname AND c.constraint_type = 'P'
        ORDER BY cc.position
    """,
    foreign_keys="""
        SELECT cc.column_name, rc.table_name, rcc.column_name, c.constraint_name
        FROM all_constraints c
        JOIN all_cons_columns cc
          ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        JOIN all_constraints rc
          ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
        JOIN all_cons_columns rcc
          ON rcc.owner = rc.owner
         AND rcc.constraint_name = rc.constraint_name
         AND rcc.position = cc.position
        WHERE c.owner = :owner AND c.table_name = :tname AND c.constraint_type = 'R'
        ORDER BY c.constraint_name, cc.position
    """,
)


class OracleDialect(SQLDialect):
    name = "oracle"
    sqlglot_name = "oracle"
    identifier_case = "upper"

    @property
    def row_limit_patterns(self) -> tuple[re.Pattern[str], ...]:
        return (_FETCH_RE, _ROWNUM_RE)

    @property
    def trailing_row_limit_re(self) -> re.Pattern[str]:
        return _TRAILING_FETCH_RE

    def render_row_limit(self, n: int) -> str:
        return f"FETCH FIRST {n} ROWS ONLY"

    def extract_row_limit(self, sql: str) -> int | None:
        m = _ROWNUM_VALUE_RE.search(sql)
        if m:
            op, n = m.group(1), int(m.group(2))
            return n if op == "<=" else n - 1
        m = _FETCH_RE.search(sql)
        return int(m.group(1)) if m else None

    @property
    def date_literal_patterns(self) -> tuple[re.Pattern[str], ...]:
        return (ANSI_DATE_LITERAL_RE, _TO_DATE_RE)

    def current_date_expr(self) -> str:
        return "SYSDATE"

    def months_ago_expr(self, months: int) -> str:
        return f"ADD_MONTHS(SYSDATE, -{months})"

    @property
    def forbidden_rules(self) -> tuple[tuple[re.Pattern[str], str], ...]:
        return _FORBIDDEN_RULES

    @property
    def hint_rules(self) -> tuple[tuple[re.Pattern[str], str], ...]:
        return _HINT_RULES

    @property
    def system_object_re(self) -> re.Pattern[str]:
        return _SYSTEM_OBJECT_RE

    @property
    def risky_function_re(self) -> re.Pattern[str]:
        return _RISKY_FUNCTION_RE

    @property
    def risky_function_label(self) -> str:
        return "UTL_* / DBMS_* system packages (UTL_FILE, DBMS_SQL, DBMS_METADATA, etc.)"

    @property
    def catalog(self) -> CatalogQueries:
        return _CATALOG
