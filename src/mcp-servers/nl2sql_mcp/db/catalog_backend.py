"""실 DB 커넥터 공통 로직.

카탈로그 조회 SQL 은 dialect(``db/dialects``)가 갖고, 이 클래스는 결과를 도구 응답 형태로
바꾸는 일만 합니다. 드라이버별 차이(연결 획득, 읽기 전용 세션, 커서 API)는 하위 클래스의
``_fetch`` 하나로 숨깁니다.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Iterable
from typing import Any, Literal

from nl2sql_mcp.db.dialects import SQLDialect
from nl2sql_mcp.db.values import normalize_row

logger = logging.getLogger(__name__)

FetchMode = Literal["all", "one"]


class CatalogBackend(ABC):
    """search_tables / search_columns / get_table_schema / execute_query 공통 구현."""

    def __init__(self, dialect: SQLDialect) -> None:
        self.dialect = dialect

    # ── 드라이버별 구현 ──────────────────────────────────────────────────
    @abstractmethod
    async def _fetch(self, sql: str, params: dict[str, Any], mode: FetchMode = "all") -> Any:
        """읽기 전용 세션에서 SQL 을 실행하고 ``fetchall`` 또는 ``fetchone`` 결과를 돌려줍니다."""

    @abstractmethod
    async def _run_query(self, sql: str, max_rows: int) -> tuple[list[str], list[tuple[Any, ...]]]:
        """사용자 SELECT 를 실행하고 ``(컬럼명 목록, 최대 max_rows+1 행)`` 을 돌려줍니다."""

    @abstractmethod
    async def close(self) -> None: ...

    # ── 공통 로직 ────────────────────────────────────────────────────────
    def _fold(self, name: str) -> str:
        return self.dialect.fold_identifier(name)

    async def search_tables(self, pattern: str, limit: int = 20) -> dict[str, Any]:
        rows = await self._fetch(
            self.dialect.catalog.search_tables, {"pattern": self._fold(pattern), "lim": limit}
        )
        match_count: int = rows[0][4] if rows else 0
        tables = [
            {
                "owner": r[0],
                "table_name": r[1],
                "comment": r[2],
                "column_count": (r[5] if len(r) > 5 else 0) or 0,
                # 통계가 없으면(뷰, ANALYZE 전) None. 0 은 "비어 있음"으로 읽히므로 쓰지 않습니다
                "estimated_rows": int(r[3]) if r[3] is not None else None,
            }
            for r in rows
        ]
        return {
            "tables": tables,
            "match_count": match_count,
            "truncated": len(tables) >= limit and match_count > limit,
        }

    async def search_columns(self, column_pattern: str, limit: int = 50) -> dict[str, Any]:
        rows = await self._fetch(
            self.dialect.catalog.search_columns,
            {"pattern": self._fold(column_pattern), "lim": limit},
        )
        match_count: int = rows[0][5] if rows else 0
        columns = [
            {
                "owner": r[0],
                "table_name": r[1],
                "column_name": r[2],
                "data_type": r[3],
                "comment": r[4],
            }
            for r in rows
        ]
        return {
            "columns": columns,
            "match_count": match_count,
            "truncated": len(columns) >= limit and match_count > limit,
        }

    async def get_table_schema(self, table_name: str) -> dict[str, Any] | None:
        """테이블 전체 스키마 조회. None 이면 TABLE_NOT_FOUND (처리는 도구에서)."""
        catalog = self.dialect.catalog
        parts = self._fold(table_name).split(".")
        if len(parts) == 2:
            meta = await self._fetch(
                catalog.table_meta_with_owner, {"owner": parts[0], "tname": parts[1]}, "one"
            )
        else:
            meta = await self._fetch(catalog.table_meta, {"tname": parts[-1]}, "one")
        if meta is None:
            return None
        owner, tname, table_comment = meta
        key = {"owner": owner, "tname": tname}

        col_rows = await self._fetch(catalog.columns, key)
        columns = [
            {"name": r[0], "data_type": r[1], "nullable": r[2] == "Y", "comment": r[3]} for r in col_rows
        ]
        primary_key = [r[0] for r in await self._fetch(catalog.primary_key, key)]

        fk_map: dict[str, dict[str, Any]] = {}
        for col_name, ref_table, ref_col, cname in await self._fetch(catalog.foreign_keys, key):
            entry = fk_map.setdefault(cname, {"columns": [], "ref_table": ref_table, "ref_columns": []})
            entry["columns"].append(col_name)
            entry["ref_columns"].append(ref_col)
        # 파티션마다 같은 FK 가 있으면(Postgres 파티션 테이블) 하나로 합칩니다
        foreign_keys: dict[tuple[Any, ...], dict[str, Any]] = {}
        for fk in fk_map.values():
            foreign_keys.setdefault(
                (tuple(fk["columns"]), fk["ref_table"], tuple(fk["ref_columns"])), fk
            )

        return {
            "owner": owner,
            "table_name": tname,
            "comment": table_comment,
            "columns": columns,
            "primary_key": primary_key,
            "foreign_keys": list(foreign_keys.values()),
        }

    async def get_tables_schema(self, table_names: list[str]) -> dict[str, Any]:
        tables: list[dict[str, Any]] = []
        not_found: list[str] = []
        for name in table_names:
            schema = await self.get_table_schema(name)
            if schema is not None:
                tables.append(schema)
            else:
                not_found.append(name)
        return {"tables": tables, "not_found": not_found}

    async def estimate_rows(self, tables: Iterable[Any]) -> dict[str, int | None]:
        """7.7 용 행 수 추정치. ``{테이블 이름(소문자): 행 수 또는 None}``.

        테이블과 구체화 뷰는 카탈로그 통계(Postgres ``reltuples``, Oracle ``num_rows``)를, 일반 뷰는
        dialect 가 지원하면 플래너 추정치(Postgres ``EXPLAIN``)를 씁니다. 모르면 None.
        """
        estimates: dict[str, int | None] = {}
        for ref in tables:
            name = str(getattr(ref, "name", ref)).lower()
            if name in estimates:
                continue
            owner = getattr(ref, "schema", None)
            estimates[name] = await self._estimate_one(name, owner)
        return estimates

    async def _estimate_one(self, name: str, owner: str | None) -> int | None:
        try:
            row = await self._fetch(
                self.dialect.catalog.table_rows,
                {"tname": self._fold(name), "owner": self._fold(owner) if owner else None},
                "one",
            )
            if row is None:
                return None
            real_owner, real_name, kind, rows = row
            if kind != "v":
                return int(rows) if rows is not None else None
            explain = self.dialect.explain_rows_sql(real_owner, real_name)
            if explain is None:
                return None
            plan = await self._fetch(explain, {}, "one")
            doc = plan[0] if plan else None
            if isinstance(doc, str):
                doc = json.loads(doc)
            return int(doc[0]["Plan"]["Plan Rows"])
        except Exception as e:  # 추정 실패는 "모름"으로 처리해 7.7 이 보수적으로 막게 둡니다
            logger.warning("행 수 추정 실패 (%s): %s", name, e)
            return None

    async def execute_query(self, sql: str, max_rows: int = 1000) -> dict[str, Any]:
        """가드레일을 통과한 SELECT 를 읽기 전용 세션에서 실행합니다."""
        col_names, raw_rows = await self._run_query(sql, max_rows)
        # numeric(Decimal), 시각(datetime) 등을 Mock 과 같은 JSON 형식으로 맞춥니다 (db/values.py)
        rows = [normalize_row(r) for r in raw_rows[:max_rows]]
        return {
            "columns": col_names,
            "rows": rows,
            "row_count": len(rows),
            "truncated": len(raw_rows) > max_rows,
            "masked_columns": [],
            "explain": {
                # 실행 계획 수집은 아직 하지 않습니다 (Oracle EXPLAIN PLAN 은 PLAN_TABLE 쓰기가 필요)
                "estimated_cost": None,
                "estimated_rows": None,
                "full_scan_tables": [],
            },
        }
