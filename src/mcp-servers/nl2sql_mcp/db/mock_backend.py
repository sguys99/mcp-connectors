"""MockBackend: 픽스처 데이터 기반 Mock 백엔드.

NL2SQL_DB_BACKEND=mock(기본) 일 때 실 DB 연결 없이 동작하는 인메모리 백엔드입니다.
SQL 파싱과 행 수 제한 해석은 주입받은 dialect(기본 postgres)를 따릅니다.
픽스처는 PostgreSQL Pagila 3.x 샘플 스키마(public)의 15개 테이블, 7개 뷰, 구체화 뷰 1개로 모두 23개이고,
docker/postgres 샘플 DB(upstream 커밋 5ba5a57)의 실제 카탈로그와 이름, 타입, NULL 허용, PK/FK,
코멘트(docker/postgres/initdb/03-pagila-comments.sql)가 같습니다. payment 의 월별 파티션
(payment_p2022_01~07)은 실 DB 카탈로그 검색에서도 빠지므로 픽스처에 없습니다.
estimated_rows 는 실제 행 수이고, 일반 뷰는 실 DB 처럼 None(통계 없음)으로 보고합니다.
시각 값은 실 DB 응답(db/values.py)과 같은 ISO 8601 문자열입니다.
식별자는 Pagila 원본과 같은 소문자로 보관하고, 조회는 대소문자를 구분하지 않습니다.
(테이블, 컬럼 대응 기준은 docs/revamp/nl2sql-pagila-mapping.md 참고)
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterable
from typing import Any

from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.db.mock_query import MockQueryEngine
from nl2sql_mcp.db.values import normalize_row

# ── 픽스처 스키마 (Pagila) ─────────────────────────────────────────────────────

_OWNER = "public"


def _col(name: str, data_type: str, nullable: bool, comment: str) -> dict[str, Any]:
    return {"name": name, "data_type": data_type, "nullable": nullable, "comment": comment}


def _fk(columns: list[str], ref_table: str, ref_columns: list[str]) -> dict[str, Any]:
    return {"columns": columns, "ref_table": ref_table, "ref_columns": ref_columns}


def _table(
    name: str,
    comment: str,
    columns: list[dict[str, Any]],
    estimated_rows: int,
    primary_key: list[str] | None = None,
    foreign_keys: list[dict[str, Any]] | None = None,
    kind: str = "table",
) -> dict[str, Any]:
    return {
        "kind": kind,
        "owner": _OWNER,
        "table_name": name,
        "comment": comment,
        "columns": columns,
        "primary_key": primary_key or [],
        "foreign_keys": foreign_keys or [],
        "estimated_rows": estimated_rows,
    }


_LAST_UPDATE = _col("last_update", "timestamp with time zone", False, "Last modified at")

_TABLES: list[dict[str, Any]] = [
    _table(
        "actor",
        "Actor",
        [
            _col("actor_id", "integer", False, "PK"),
            _col("first_name", "text", False, "First name (PII)"),
            _col("last_name", "text", False, "Last name (PII)"),
            _LAST_UPDATE,
        ],
        200,
        ["actor_id"],
    ),
    _table(
        "address",
        "Address",
        [
            _col("address_id", "integer", False, "PK"),
            _col("address", "text", False, "Street address (PII)"),
            _col("address2", "text", True, "Address line 2"),
            _col("district", "text", False, "District"),
            _col("city_id", "integer", False, "FK→city"),
            _col("postal_code", "text", True, "Postal code"),
            _col("phone", "text", False, "Phone number (PII)"),
            _LAST_UPDATE,
        ],
        603,
        ["address_id"],
        [_fk(["city_id"], "city", ["city_id"])],
    ),
    _table(
        "category",
        "Film category",
        [
            _col("category_id", "integer", False, "PK"),
            _col("name", "text", False, "Category name"),
            _LAST_UPDATE,
        ],
        16,
        ["category_id"],
    ),
    _table(
        "city",
        "City",
        [
            _col("city_id", "integer", False, "PK"),
            _col("city", "text", False, "City name"),
            _col("country_id", "integer", False, "FK→country"),
            _LAST_UPDATE,
        ],
        600,
        ["city_id"],
        [_fk(["country_id"], "country", ["country_id"])],
    ),
    _table(
        "country",
        "Country",
        [
            _col("country_id", "integer", False, "PK"),
            _col("country", "text", False, "Country name"),
            _LAST_UPDATE,
        ],
        109,
        ["country_id"],
    ),
    _table(
        "customer",
        "Customer master data",
        [
            _col("customer_id", "integer", False, "PK"),
            _col("store_id", "integer", False, "FK→store"),
            _col("first_name", "text", False, "First name (PII)"),
            _col("last_name", "text", False, "Last name (PII)"),
            _col("email", "text", True, "Email (PII)"),
            _col("address_id", "integer", False, "FK→address"),
            _col("activebool", "boolean", False, "Active flag (boolean)"),
            _col("create_date", "date", False, "Sign-up date"),
            _col("last_update", "timestamp with time zone", True, "Last modified at"),
            _col("active", "integer", True, "Active flag (1/0)"),
        ],
        599,
        ["customer_id"],
        [_fk(["store_id"], "store", ["store_id"]), _fk(["address_id"], "address", ["address_id"])],
    ),
    _table(
        "film",
        "Film master",
        [
            _col("film_id", "integer", False, "PK"),
            _col("title", "text", False, "Title"),
            _col("description", "text", True, "Synopsis"),
            _col("release_year", "year", True, "Release year (domain year, 1901 to 2155)"),
            _col("language_id", "integer", False, "FK→language"),
            _col("original_language_id", "integer", True, "FK→language (original language)"),
            _col("rental_duration", "smallint", False, "Rental duration (days)"),
            _col("rental_rate", "numeric(4,2)", False, "Rental rate"),
            _col("length", "smallint", True, "Running time (minutes)"),
            _col("replacement_cost", "numeric(5,2)", False, "Replacement cost"),
            _col("rating", "mpaa_rating", True, "MPAA rating (G/PG/PG-13/R/NC-17)"),
            _LAST_UPDATE,
            _col("special_features", "text[]", True, "Special features"),
            _col("fulltext", "tsvector", False, "Full-text search vector"),
        ],
        1000,
        ["film_id"],
        [
            _fk(["language_id"], "language", ["language_id"]),
            _fk(["original_language_id"], "language", ["language_id"]),
        ],
    ),
    _table(
        "film_actor",
        "Film to actor link",
        [
            _col("actor_id", "integer", False, "PK, FK→actor"),
            _col("film_id", "integer", False, "PK, FK→film"),
            _LAST_UPDATE,
        ],
        5462,
        ["actor_id", "film_id"],
        [_fk(["actor_id"], "actor", ["actor_id"]), _fk(["film_id"], "film", ["film_id"])],
    ),
    _table(
        "film_category",
        "Film to category link",
        [
            _col("film_id", "integer", False, "PK, FK→film"),
            _col("category_id", "integer", False, "PK, FK→category"),
            _LAST_UPDATE,
        ],
        2367,
        ["film_id", "category_id"],
        [_fk(["film_id"], "film", ["film_id"]), _fk(["category_id"], "category", ["category_id"])],
    ),
    _table(
        "inventory",
        "Film inventory per store",
        [
            _col("inventory_id", "integer", False, "PK"),
            _col("film_id", "integer", False, "FK→film"),
            _col("store_id", "integer", False, "FK→store"),
            _LAST_UPDATE,
        ],
        4581,
        ["inventory_id"],
        [_fk(["film_id"], "film", ["film_id"]), _fk(["store_id"], "store", ["store_id"])],
    ),
    _table(
        "language",
        "Language",
        [
            _col("language_id", "integer", False, "PK"),
            _col("name", "character(20)", False, "Language name"),
            _LAST_UPDATE,
        ],
        6,
        ["language_id"],
    ),
    _table(
        "payment",
        "Payments (partitioned by month on payment_date)",
        [
            _col("payment_id", "integer", False, "PK"),
            _col("customer_id", "integer", False, "FK→customer"),
            _col("staff_id", "integer", False, "FK→staff"),
            _col("rental_id", "integer", False, "FK→rental"),
            _col("amount", "numeric(5,2)", False, "Payment amount"),
            _col("payment_date", "timestamp with time zone", False, "Payment timestamp"),
        ],
        16049,
        ["payment_date", "payment_id"],
        [
            _fk(["customer_id"], "customer", ["customer_id"]),
            _fk(["staff_id"], "staff", ["staff_id"]),
            _fk(["rental_id"], "rental", ["rental_id"]),
        ],
    ),
    _table(
        "rental",
        "Rentals",
        [
            _col("rental_id", "integer", False, "PK"),
            _col("rental_date", "timestamp with time zone", False, "Rental timestamp"),
            _col("inventory_id", "integer", False, "FK→inventory"),
            _col("customer_id", "integer", False, "FK→customer"),
            _col(
                "return_date",
                "timestamp with time zone",
                True,
                "Return timestamp (NULL means not returned)",
            ),
            _col("staff_id", "integer", False, "FK→staff"),
            _LAST_UPDATE,
        ],
        16044,
        ["rental_id"],
        [
            _fk(["inventory_id"], "inventory", ["inventory_id"]),
            _fk(["customer_id"], "customer", ["customer_id"]),
            _fk(["staff_id"], "staff", ["staff_id"]),
        ],
    ),
    _table(
        "staff",
        "Staff",
        [
            _col("staff_id", "integer", False, "PK"),
            _col("first_name", "text", False, "First name (PII)"),
            _col("last_name", "text", False, "Last name (PII)"),
            _col("address_id", "integer", False, "FK→address"),
            _col("email", "text", True, "Email (PII)"),
            _col("store_id", "integer", False, "FK→store"),
            _col("active", "boolean", False, "Active employee flag"),
            _col("username", "text", False, "Login username"),
            _col("password", "text", True, "Password hash (PII)"),
            _LAST_UPDATE,
            _col("picture", "bytea", True, "Photo"),
        ],
        1500,
        ["staff_id"],
        [_fk(["address_id"], "address", ["address_id"]), _fk(["store_id"], "store", ["store_id"])],
    ),
    _table(
        "store",
        "Store",
        [
            _col("store_id", "integer", False, "PK"),
            _col("manager_staff_id", "integer", False, "FK→staff (store manager)"),
            _col("address_id", "integer", False, "FK→address"),
            _LAST_UPDATE,
        ],
        500,
        ["store_id"],
        [_fk(["address_id"], "address", ["address_id"])],
    ),
    # ── 뷰 7개와 구체화 뷰 1개 ──
    _table(
        "actor_info",
        "View: film summary per actor",
        [
            _col("actor_id", "integer", True, "Actor ID"),
            _col("first_name", "text", True, "First name (PII)"),
            _col("last_name", "text", True, "Last name (PII)"),
            _col("film_info", "text", True, "Films by category"),
        ],
        200,
        kind="view",
    ),
    _table(
        "customer_list",
        "View: customer list (joined with address)",
        [
            _col("id", "integer", True, "Customer ID"),
            _col("name", "text", True, "Full name (PII)"),
            _col("address", "text", True, "Street address (PII)"),
            _col("zip code", "text", True, "Postal code"),
            _col("phone", "text", True, "Phone number (PII)"),
            _col("city", "text", True, "City"),
            _col("country", "text", True, "Country"),
            _col("notes", "text", True, "Active status label"),
            _col("sid", "integer", True, "Store ID"),
        ],
        599,
        kind="view",
    ),
    _table(
        "film_list",
        "View: film list (joined with category and actors)",
        [
            _col("fid", "integer", True, "Film ID"),
            _col("title", "text", True, "Title"),
            _col("description", "text", True, "Synopsis"),
            _col("category", "text", True, "Category name"),
            _col("price", "numeric(4,2)", True, "Rental rate"),
            _col("length", "smallint", True, "Running time (minutes)"),
            _col("rating", "mpaa_rating", True, "Rating"),
            _col("actors", "text", True, "Cast list"),
        ],
        2360,
        kind="view",
    ),
    _table(
        "nicer_but_slower_film_list",
        "View: film list (tidier formatting, slower)",
        [
            _col("fid", "integer", True, "Film ID"),
            _col("title", "text", True, "Title"),
            _col("description", "text", True, "Synopsis"),
            _col("category", "text", True, "Category name"),
            _col("price", "numeric(4,2)", True, "Rental rate"),
            _col("length", "smallint", True, "Running time (minutes)"),
            _col("rating", "mpaa_rating", True, "Rating"),
            _col("actors", "text", True, "Cast list"),
        ],
        2360,
        kind="view",
    ),
    _table(
        "rental_by_category",
        "Materialized view: total sales per category (refreshed at init)",
        [
            _col("category", "text", True, "Category name"),
            _col("total_sales", "numeric", True, "Total sales"),
        ],
        16,
        kind="matview",
    ),
    _table(
        "sales_by_film_category",
        "View: total sales per category",
        [
            _col("category", "text", True, "Category name"),
            _col("total_sales", "numeric", True, "Total sales"),
        ],
        16,
        kind="view",
    ),
    _table(
        "sales_by_store",
        "View: total sales per store",
        [
            _col("store", "text", True, "Store location (city, country)"),
            _col("manager", "text", True, "Manager full name (PII)"),
            _col("total_sales", "numeric", True, "Total sales"),
        ],
        2,
        kind="view",
    ),
    _table(
        "staff_list",
        "View: staff list (joined with address)",
        [
            _col("id", "integer", True, "Staff ID"),
            _col("name", "text", True, "Full name (PII)"),
            _col("address", "text", True, "Street address (PII)"),
            _col("zip code", "text", True, "Postal code"),
            _col("phone", "text", True, "Phone number (PII)"),
            _col("city", "text", True, "City"),
            _col("country", "text", True, "Country"),
            _col("sid", "integer", True, "Store ID"),
        ],
        1500,
        kind="view",
    ),
]

_FIXTURE_SCHEMAS: dict[str, dict[str, Any]] = {t["table_name"]: t for t in _TABLES}


# ── SQL 쿼리 결과 샘플 픽스처 ────────────────────────────────────────────────────
# 카탈로그 block 컬럼(고객 이름, 이메일, 전화번호, 상세 주소, 비밀번호)은 가드레일 7.6 이 SELECT 단계에서
# 차단하므로 샘플에 넣지 않는다. mask 컬럼(staff 이름과 username, postal_code)은 원본 값을 넣어 두고
# 도구 레이어가 결과에서 가린다. actor 이름은 PII 가 아니다 (nl2sql_mcp/pii_catalog.py).

_FIXTURE_SAMPLE_ROWS: dict[str, dict[str, Any]] = {
    "customer": {
        "columns": ["customer_id", "store_id", "address_id", "activebool", "create_date", "active"],
        "rows": [
            [1, 1, 5, True, "2022-02-14", 1],
            [2, 1, 6, True, "2022-02-14", 1],
            [3, 1, 7, True, "2022-02-14", 1],
            [4, 2, 8, True, "2022-02-14", 1],
            [5, 1, 9, True, "2022-02-14", 1],
        ],
        "masked_columns": [],
    },
    "film": {
        "columns": [
            "film_id",
            "title",
            "release_year",
            "language_id",
            "rental_duration",
            "rental_rate",
            "length",
            "replacement_cost",
            "rating",
        ],
        "rows": [
            [1, "ACADEMY DINOSAUR", 2012, 1, 6, 0.99, 86, 20.99, "PG"],
            [2, "ACE GOLDFINGER", 2023, 1, 3, 4.99, 48, 12.99, "G"],
            [3, "ADAPTATION HOLES", 2017, 2, 7, 2.99, 50, 18.99, "NC-17"],
            [4, "AFFAIR PREJUDICE", 2023, 6, 5, 2.99, 117, 26.99, "G"],
            [5, "AFRICAN EGG", 2019, 4, 6, 2.99, 130, 22.99, "G"],
            [6, "AGENT TRUMAN", 2010, 1, 3, 2.99, 169, 17.99, "PG"],
        ],
        "masked_columns": [],
    },
    "category": {
        "columns": ["category_id", "name"],
        "rows": [
            [1, "Action"],
            [2, "Animation"],
            [3, "Children"],
            [4, "Classics"],
            [5, "Comedy"],
        ],
        "masked_columns": [],
    },
    "language": {
        "columns": ["language_id", "name"],
        "rows": [
            [1, "English"],
            [2, "Italian"],
            [3, "Japanese"],
            [4, "Mandarin"],
            [5, "French"],
            [6, "German"],
        ],
        "masked_columns": [],
    },
    "film_category": {
        "columns": ["film_id", "category_id"],
        "rows": [[1, 10], [1, 13], [1, 16], [2, 1], [2, 13]],
        "masked_columns": [],
    },
    "inventory": {
        "columns": ["inventory_id", "film_id", "store_id"],
        "rows": [[1, 1, 1], [2, 1, 1], [3, 1, 1], [4, 1, 1], [5, 1, 2]],
        "masked_columns": [],
    },
    "rental": {
        "columns": [
            "rental_id",
            "rental_date",
            "inventory_id",
            "customer_id",
            "return_date",
            "staff_id",
        ],
        "rows": [
            [1, "2022-05-24T21:53:30+00:00", 367, 130, "2022-05-26T21:04:30+00:00", 1],
            [2, "2022-05-24T21:54:33+00:00", 1525, 459, "2022-05-28T18:40:33+00:00", 1],
            [3, "2022-05-24T22:03:39+00:00", 1711, 408, "2022-06-01T21:12:39+00:00", 1],
            [4, "2022-05-24T22:04:41+00:00", 2452, 333, "2022-06-03T00:43:41+00:00", 2],
            [5, "2022-05-24T22:05:21+00:00", 2079, 222, "2022-06-02T03:33:21+00:00", 1],
        ],
        "masked_columns": [],
    },
    "payment": {
        "columns": ["payment_id", "customer_id", "staff_id", "rental_id", "amount", "payment_date"],
        "rows": [
            [16050, 269, 2, 7, 1.99, "2022-06-21T07:41:50.707316+00:00"],
            [16051, 269, 1, 98, 0.99, "2022-01-29T01:58:52.222594+00:00"],
            [16052, 269, 2, 678, 6.99, "2022-06-26T22:37:21.783785+00:00"],
            [16053, 269, 2, 703, 0.99, "2022-03-02T19:51:40.813503+00:00"],
            [16054, 269, 1, 750, 4.99, "2022-06-02T03:29:53.30199+00:00"],
        ],
        "masked_columns": [],
    },
    "store": {
        "columns": ["store_id", "manager_staff_id", "address_id"],
        "rows": [[1, 1, 1], [2, 2, 2]],
        "masked_columns": [],
    },
    "actor": {
        "columns": ["actor_id", "first_name", "last_name"],
        "rows": [
            [1, "PENELOPE", "GUINESS"],
            [2, "NICK", "WAHLBERG"],
            [3, "ED", "CHASE"],
            [4, "JENNIFER", "DAVIS"],
            [5, "JOHNNY", "LOLLOBRIGIDA"],
        ],
        "masked_columns": [],
    },
    "staff": {
        "columns": [
            "staff_id",
            "first_name",
            "last_name",
            "address_id",
            "store_id",
            "active",
            "username",
        ],
        "rows": [
            [1, "Mike", "Hillyer", 3, 1, True, "Mike"],
            [2, "Jon", "Stephens", 4, 2, True, "Jon"],
        ],
        "masked_columns": [],
    },
    "address": {
        "columns": ["address_id", "district", "city_id", "postal_code"],
        "rows": [
            [1, "Alberta", 300, None],
            [2, "QLD", 576, None],
            [3, "Alberta", 300, None],
        ],
        "masked_columns": [],
    },
    "city": {
        "columns": ["city_id", "city", "country_id"],
        "rows": [[1, "A Corua (La Corua)", 87], [2, "Abha", 82], [3, "Abu Dhabi", 101]],
        "masked_columns": [],
    },
    "country": {
        "columns": ["country_id", "country"],
        "rows": [[1, "Afghanistan"], [2, "Algeria"], [3, "American Samoa"]],
        "masked_columns": [],
    },
}


# ── 헬퍼 함수 ──────────────────────────────────────────────────────────────────


def _like_to_regex(pattern: str) -> re.Pattern[str]:
    """SQL LIKE 패턴(%, _)을 Python 정규식으로 변환."""
    regex = ""
    for ch in pattern:
        if ch == "%":
            regex += ".*"
        elif ch == "_":
            regex += "."
        else:
            regex += re.escape(ch)
    return re.compile(f"^{regex}$", re.IGNORECASE)


def _table_summary(schema: dict[str, Any]) -> dict[str, Any]:
    # 실 DB 처럼 일반 뷰는 통계가 없어 행 수를 모름(None)으로 보고합니다
    rows = None if schema.get("kind") == "view" else schema.get("estimated_rows")
    return {
        "owner": schema["owner"],
        "table_name": schema["table_name"],
        "comment": schema.get("comment"),
        "column_count": len(schema["columns"]),
        "estimated_rows": rows,
    }


# ── MockBackend ──────────────────────────────────────────────────────────


# run_sql_query 결과의 notice (LLM 과 Inspector 에 보이는 문자열이라 영어).
MOCK_RESULT_NOTICE = (
    "Mock backend: rows come from a small fixed sample of the Pagila tables, not a live database. "
    "Counts and totals describe the sample only."
)


class MockBackend:
    """테스트, 데모용 Mock 백엔드. 실 DB 연결 없이 Pagila 픽스처 데이터를 반환한다."""

    def __init__(self, dialect: SQLDialect | None = None, delay_sec: float = 0.0) -> None:
        self.dialect = dialect or get_dialect()
        # execute_query 앞의 인위적 지연(NL2SQL_MOCK_DELAY_SEC). 타임아웃 가드레일(7.4) 재현용
        self.delay_sec = max(delay_sec, 0.0)

    async def search_tables(self, pattern: str, limit: int = 20) -> dict[str, Any]:
        regex = _like_to_regex(pattern)
        matched = [_table_summary(s) for name, s in _FIXTURE_SCHEMAS.items() if regex.match(name)]
        truncated = len(matched) > limit
        return {
            "tables": matched[:limit],
            "match_count": len(matched),
            "truncated": truncated,
        }

    async def search_columns(self, column_pattern: str, limit: int = 50) -> dict[str, Any]:
        regex = _like_to_regex(column_pattern)
        results: list[dict[str, Any]] = []
        for schema in _FIXTURE_SCHEMAS.values():
            for col in schema["columns"]:
                if regex.match(col["name"]):
                    results.append(
                        {
                            "owner": schema["owner"],
                            "table_name": schema["table_name"],
                            "column_name": col["name"],
                            "data_type": col["data_type"],
                            "comment": col.get("comment"),
                        },
                    )
        truncated = len(results) > limit
        return {
            "columns": results[:limit],
            "match_count": len(results),
            "truncated": truncated,
        }

    async def get_table_schema(self, table_name: str) -> dict[str, Any] | None:
        """None 반환 시 테이블 없음(TABLE_NOT_FOUND 처리는 tool에서)."""
        key = table_name.lower().split(".")[-1]
        schema = _FIXTURE_SCHEMAS.get(key)
        if schema is None:
            return None
        result = dict(schema)
        result.pop("estimated_rows", None)
        result.pop("kind", None)
        return result

    async def get_tables_schema(self, table_names: list[str]) -> dict[str, Any]:
        # 중복 제거 (순서 유지)
        seen: set[str] = set()
        deduped = [n for n in table_names if not (n.lower() in seen or seen.add(n.lower()))]  # type: ignore[func-returns-value]
        tables: list[dict[str, Any]] = []
        not_found: list[str] = []
        for name in deduped:
            schema = await self.get_table_schema(name)
            if schema is not None:
                tables.append(schema)
            else:
                not_found.append(name)
        return {"tables": tables, "not_found": not_found}

    async def estimate_rows(self, tables: Iterable[Any]) -> dict[str, int | None]:
        """7.7 용 행 수 추정치. 뷰도 픽스처 행 수를 씁니다(실 DB 는 EXPLAIN 추정치)."""
        out: dict[str, int | None] = {}
        for ref in tables:
            name = str(getattr(ref, "name", ref)).lower().split(".")[-1]
            schema = _FIXTURE_SCHEMAS.get(name)
            out[name] = schema.get("estimated_rows") if schema else None
        return out

    async def execute_query(self, sql: str, max_rows: int = 1000) -> dict[str, Any]:
        """가드레일 통과 후 실행되는 쿼리. 샘플 행에 WHERE, 집계, 정렬, LIMIT 을 적용합니다.

        해석 규칙은 db/mock_query.py 에 있습니다.
        """
        if self.delay_sec:
            await asyncio.sleep(self.delay_sec)
        engine = MockQueryEngine(self.dialect, _FIXTURE_SAMPLE_ROWS, _FIXTURE_SCHEMAS)
        rel, explain = engine.run(sql)
        rows = [normalize_row(r) for r in rel.rows]
        return {
            "columns": rel.columns,
            "rows": rows[:max_rows],
            "row_count": min(len(rows), max_rows),
            "truncated": len(rows) > max_rows,
            "masked_columns": [],
            "explain": explain,
            # 결과를 보는 사람과 모델이 실 DB 결과로 오인하지 않도록 출처를 함께 돌려준다.
            "data_source": "mock_sample",
            "notice": MOCK_RESULT_NOTICE,
        }

    async def close(self) -> None:
        pass
