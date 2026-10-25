"""PostgreSQL dialect (기본값). 드라이버는 psycopg 3 입니다."""

from __future__ import annotations

import re

from nl2sql_mcp.db.dialects.base import (
    ANSI_DATE_LITERAL_RE,
    MULTI_STATEMENT_RULE,
    CatalogQueries,
    SQLDialect,
)

# 카탈로그 검색에서 제외할 시스템 스키마
SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast")
_SCHEMAS_SQL = ",".join(f"'{s}'" for s in SYSTEM_SCHEMAS)
# 테이블, 뷰, 구체화 뷰, 파티션 테이블, 외부 테이블
_RELKINDS_SQL = "'r','v','m','p','f'"

_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)\b", re.IGNORECASE)
_FETCH_RE = re.compile(r"\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b", re.IGNORECASE)
_TRAILING_LIMIT_RE = re.compile(
    r"\b(?:LIMIT\s+(?:\d+|ALL)(?:\s+OFFSET\s+\d+)?"
    r"|OFFSET\s+\d+(?:\s+ROWS?)?\s+(?:LIMIT\s+\d+|FETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY)"
    r"|FETCH\s+(?:FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY)\s*$",
    re.IGNORECASE,
)

# 'YYYY-MM-DD'::date, CAST('YYYY-MM-DD' AS DATE), TIMESTAMP 'YYYY-MM-DD ...', to_date('YYYY-MM-DD', ...)
_CAST_SUFFIX_RE = re.compile(
    r"'(\d{4}-\d{2}-\d{2})[^']*'\s*::\s*(?:date|timestamp(?:tz)?)\b", re.IGNORECASE
)
_CAST_FUNC_RE = re.compile(
    r"\bCAST\s*\(\s*'(\d{4}-\d{2}-\d{2})[^']*'\s+AS\s+(?:DATE|TIMESTAMP)", re.IGNORECASE
)
_TIMESTAMP_LITERAL_RE = re.compile(r"\bTIMESTAMP(?:TZ)?\s+'(\d{4}-\d{2}-\d{2})[^']*'", re.IGNORECASE)
_TO_DATE_RE = re.compile(r"\bTO_(?:DATE|TIMESTAMP)\s*\(\s*'(\d{4}-\d{2}-\d{2})", re.IGNORECASE)

# 7.5 금지 구문: 시스템 카탈로그, 원격 DB 접속. 주석을 지우고 문자열을 비운 코드 텍스트에 적용합니다.
# 동적 SQL(EXECUTE, PREPARE, DO)과 COPY 는 문장 단위라 AST 로 막습니다
# (guardrails/enforce_select_only.statement_kind).
# 예전처럼 단어 정규식으로 막으면 copy, execute 같은 컬럼 이름까지 막혀요
_SYSTEM_OBJECT_RE = re.compile(
    r"\b(?:pg_catalog|information_schema|pg_toast)\s*\."
    r"|\bpg_(?:shadow|authid|roles|user|user_mappings?|auth_members|hba_file_rules"
    r"|file_settings|settings|stat_\w+|largeobject\w*|proc|class|namespace|database)\b",
    re.IGNORECASE,
)
_FORBIDDEN_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"\b(?:pg_catalog|information_schema|pg_toast)\s*\.", re.IGNORECASE),
        "system schema reference (pg_catalog, information_schema)",
    ),
    (
        re.compile(
            r"\bpg_(?:shadow|authid|roles|user|user_mappings?|auth_members|hba_file_rules"
            r"|file_settings|settings|stat_\w+|largeobject\w*|proc|class|namespace|database)\b",
            re.IGNORECASE,
        ),
        "system catalog object reference (pg_*)",
    ),
    (re.compile(r"\bdblink\w*\s*\(", re.IGNORECASE), "remote DB connection (dblink)"),
    MULTI_STATEMENT_RULE,
)

# 힌트는 주석 형태라 원문 SQL 에 적용합니다
_HINT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"/\*\+\s*(SeqScan|Parallel|NoIndexScan|NoIndexOnlyScan|NoBitmapScan)\b", re.IGNORECASE
        ),
        "risky hint (pg_hint_plan)",
    ),
)

# 7.9 위험 함수: 서버 파일 읽기, 대형 객체 입출력, 세션 종료, 지연, 설정 변경, 임의 쿼리 실행
_RISKY_FUNCTION_RE = re.compile(
    r"\b(pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|pg_sleep\w*"
    r"|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile"
    r"|pg_promote|lo_import|lo_export|lo_from_bytea|lo_put|set_config"
    r"|query_to_xml\w*|table_to_xml\w*|cursor_to_xml|database_to_xml\w*)\s*\(",
    re.IGNORECASE,
)

_CATALOG = CatalogQueries(
    # 파티션(relispartition)은 부모 테이블 하나로 보여 줍니다 (Pagila payment_p2022_01~07)
    search_tables=f"""
        SELECT n.nspname, c.relname,
               obj_description(c.oid, 'pg_class'),
               -- 뷰는 통계가 없고, reltuples = -1 은 ANALYZE 전이라 0 대신 NULL(모름)로 돌려줍니다
               CASE WHEN c.relkind = 'v' OR c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END,
               COUNT(*) OVER() AS match_count,
               (SELECT COUNT(*) FROM pg_catalog.pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)::int
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ({_RELKINDS_SQL})
          AND NOT c.relispartition
          AND c.relname ILIKE %(pattern)s
          AND n.nspname NOT IN ({_SCHEMAS_SQL})
          AND n.nspname NOT LIKE 'pg\\_temp%%'
        ORDER BY n.nspname, c.relname
        LIMIT %(lim)s
    """,
    search_columns=f"""
        SELECT n.nspname, c.relname, a.attname,
               format_type(a.atttypid, a.atttypmod),
               col_description(c.oid, a.attnum),
               COUNT(*) OVER() AS match_count
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0 AND NOT a.attisdropped
          AND c.relkind IN ({_RELKINDS_SQL})
          AND NOT c.relispartition
          AND a.attname ILIKE %(pattern)s
          AND n.nspname NOT IN ({_SCHEMAS_SQL})
          AND n.nspname NOT LIKE 'pg\\_temp%%'
        ORDER BY n.nspname, c.relname, a.attnum
        LIMIT %(lim)s
    """,
    table_meta=f"""
        SELECT n.nspname, c.relname, obj_description(c.oid, 'pg_class')
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ({_RELKINDS_SQL})
          AND lower(c.relname) = lower(%(tname)s)
          AND n.nspname NOT IN ({_SCHEMAS_SQL})
        ORDER BY (n.nspname = ANY (current_schemas(false))) DESC, n.nspname
        LIMIT 1
    """,
    table_meta_with_owner=f"""
        SELECT n.nspname, c.relname, obj_description(c.oid, 'pg_class')
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ({_RELKINDS_SQL})
          AND lower(c.relname) = lower(%(tname)s)
          AND lower(n.nspname) = lower(%(owner)s)
          -- 스키마를 직접 적어도 시스템 스키마는 없는 테이블로 봅니다 (pg_catalog.pg_class, T03-009)
          AND n.nspname NOT IN ({_SCHEMAS_SQL})
          AND n.nspname NOT LIKE 'pg\\_temp%%'
        LIMIT 1
    """,
    table_rows=f"""
        SELECT n.nspname, c.relname, c.relkind,
               CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ({_RELKINDS_SQL})
          AND lower(c.relname) = lower(%(tname)s)
          AND (%(owner)s::text IS NULL OR lower(n.nspname) = lower(%(owner)s::text))
          AND n.nspname NOT IN ({_SCHEMAS_SQL})
        ORDER BY (n.nspname = ANY (current_schemas(false))) DESC, n.nspname
        LIMIT 1
    """,
    columns="""
        SELECT a.attname,
               format_type(a.atttypid, a.atttypmod),
               CASE WHEN a.attnotnull THEN 'N' ELSE 'Y' END,
               col_description(c.oid, a.attnum)
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = %(owner)s AND c.relname = %(tname)s
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
    """,
    primary_key="""
        SELECT a.attname
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        WHERE n.nspname = %(owner)s AND c.relname = %(tname)s AND con.contype = 'p'
        ORDER BY k.ord
    """,
    # 파티션 테이블은 FK 를 파티션마다 따로 둘 수 있어(Pagila payment) 부모와 직속 파티션의 FK 를
    # 함께 모읍니다. 부모 FK 를 복제한 파티션 FK(conparentid <> 0)는 빼고, 남은 중복은
    # catalog_backend 가 (컬럼, 참조 테이블, 참조 컬럼) 기준으로 합칩니다.
    foreign_keys="""
        WITH target AS (
            SELECT c.oid
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %(owner)s AND c.relname = %(tname)s
        ), rels AS (
            SELECT oid FROM target
            UNION
            SELECT i.inhrelid FROM pg_catalog.pg_inherits i JOIN target t ON t.oid = i.inhparent
            JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent AND pc.relkind = 'p'
        )
        SELECT a.attname, rc.relname, ra.attname, con.conname
        FROM pg_catalog.pg_constraint con
        CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, refnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
        JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
        JOIN pg_catalog.pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refnum
        WHERE con.conrelid IN (SELECT oid FROM rels) AND con.contype = 'f' AND con.conparentid = 0
        ORDER BY con.conname, k.ord
    """,
)


class PostgresDialect(SQLDialect):
    name = "postgres"
    sqlglot_name = "postgres"
    identifier_case = "lower"

    @property
    def row_limit_patterns(self) -> tuple[re.Pattern[str], ...]:
        # LIMIT ALL 은 제한이 없는 것과 같으므로 감지 대상에서 뺍니다
        return (_LIMIT_RE, _FETCH_RE)

    @property
    def trailing_row_limit_re(self) -> re.Pattern[str]:
        return _TRAILING_LIMIT_RE

    def render_row_limit(self, n: int) -> str:
        return f"LIMIT {n}"

    @property
    def date_literal_patterns(self) -> tuple[re.Pattern[str], ...]:
        return (
            ANSI_DATE_LITERAL_RE,
            _TIMESTAMP_LITERAL_RE,
            _CAST_SUFFIX_RE,
            _CAST_FUNC_RE,
            _TO_DATE_RE,
        )

    def current_date_expr(self) -> str:
        return "CURRENT_DATE"

    def months_ago_expr(self, months: int) -> str:
        return f"CURRENT_DATE - INTERVAL '{months} months'"

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
        return "system functions that touch server files, sessions, or settings (pg_read_file, pg_sleep)"

    @property
    def catalog(self) -> CatalogQueries:
        return _CATALOG

    def explain_rows_sql(self, owner: str, name: str) -> str | None:
        """뷰의 행 수를 플래너 추정치로 구할 EXPLAIN 문. 결과 JSON 의 ``Plan Rows`` 를 씁니다."""

        def q(ident: str) -> str:
            return '"' + ident.replace('"', '""') + '"'

        return f"EXPLAIN (FORMAT JSON) SELECT * FROM {q(owner)}.{q(name)}"
