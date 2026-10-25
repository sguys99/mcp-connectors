"""가드레일 7.6: 테이블 인지형 PII 통제 (입력 차단 + 결과 마스킹).

입력 단계 (:func:`analyze_pii`)
    sqlglot AST 로 SELECT 목록의 각 컬럼이 어느 테이블에서 왔는지 풉니다. 별칭(``c.email``),
    스키마 접두사, JOIN, 서브쿼리와 CTE(바깥 SELECT 가 안쪽 별칭을 다시 고르는 경우), ``SELECT *`` 와
    ``t.*`` 를 따라가며, :mod:`nl2sql_mcp.pii_catalog` 의 ``(테이블, 컬럼)`` 조치를 적용해요.

    - ``block`` 컬럼이 어떤 SELECT 목록에든 나오면 ``PII_COLUMN_BLOCKED`` 로 거부합니다.
      집계 함수 안(``COUNT(email)``)과 WHERE 의 서브쿼리 SELECT 목록도 포함합니다.
    - ``mask`` 컬럼은 통과시키고, 최종 결과에서 가릴 위치(열 번호)와 이름을
      :class:`PiiMaskPlan` 에 담습니다.
    - 테이블을 특정할 수 없는 컬럼(한정자 없는 컬럼이 여러 테이블에 걸친 경우)은 후보 테이블 중
      가장 강한 조치를 따릅니다. 실제 DB 라면 모호한 컬럼 오류가 날 쿼리라 보수적으로 판단해요.
    - 조건절(WHERE, JOIN ON, GROUP BY, ORDER BY)에서만 쓰는 PII 컬럼은 결과로 나가지 않으므로 허용합니다.

출력 단계 (:func:`mask_pii_output`)
    계획에 든 열은 값 전체를 가리고, 나머지 문자열은 ``_common/masking.py`` 의 정규식으로
    한 번 더 가립니다.
    정규식 정본은 ``_common`` 이며 이 모듈은 따로 정의하지 않습니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sqlglot
import sqlglot.expressions as exp

from _common.errors import AccessDeniedError
from _common.masking import mask_pii
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.pii_catalog import PiiAction, PiiCatalog, resolve_pii_catalog

_NONE, _MASK, _BLOCK = 0, 1, 2
_LEVEL = {PiiAction.MASK: _MASK, PiiAction.BLOCK: _BLOCK}


@dataclass(frozen=True)
class PiiMaskPlan:
    """결과에서 가릴 열. ``indices`` 는 SELECT 목록 위치, ``names`` 는 결과 컬럼 이름(소문자)."""

    indices: frozenset[int] = frozenset()
    names: frozenset[str] = frozenset()

    def applies(self, index: int, column_name: str | None) -> bool:
        return index in self.indices or (column_name or "").lower() in self.names

    def __bool__(self) -> bool:
        return bool(self.indices or self.names)


@dataclass
class _Shape:
    """한 쿼리의 결과 열 PII 수준. ``levels`` 는 위치별(``SELECT *`` 뒤는 위치를 모름)."""

    levels: dict[int, int] = field(default_factory=dict)
    names: dict[str, int] = field(default_factory=dict)

    def max_level(self) -> int:
        return max([*self.levels.values(), *self.names.values(), _NONE])


class _PiiBlocked(Exception):
    def __init__(self, table: str, column: str) -> None:
        self.table, self.column = table, column


# 소스: ("table", 테이블명) 또는 ("query", 서브쿼리/CTE 본문)
_Source = tuple[str, Any]


class _Analyzer:
    def __init__(self, root: exp.Expression, catalog: PiiCatalog) -> None:
        self.catalog = catalog
        self.ctes: dict[str, exp.Expression] = {
            cte.alias_or_name.lower(): cte.this for cte in root.find_all(exp.CTE)
        }
        self._shapes: dict[int, _Shape] = {}
        self._in_progress: set[int] = set()

    # ── 카탈로그 조회 ──
    def _table_level(self, table: str, column: str) -> int:
        action = self.catalog.get((table, column))
        if action is None:
            return _NONE
        if action is PiiAction.BLOCK:
            raise _PiiBlocked(table, column)
        return _LEVEL[action]

    def _table_columns(self, table: str) -> dict[str, PiiAction]:
        return {c: a for (t, c), a in self.catalog.items() if t == table}

    # ── 소스 해석 ──
    def _sources(self, select: exp.Select) -> dict[str, _Source]:
        nodes: list[exp.Expression] = []
        from_ = select.args.get("from_")
        if from_ is not None:
            nodes.append(from_.this)
        nodes.extend(j.this for j in select.args.get("joins") or [])
        sources: dict[str, _Source] = {}
        for node in nodes:
            if isinstance(node, exp.Table):
                name = node.name.lower()
                if not name:
                    continue
                src: _Source = (
                    ("query", self.ctes[name]) if name in self.ctes and not node.db else ("table", name)
                )
                sources[node.alias_or_name.lower()] = src
                sources.setdefault(name, src)
            elif isinstance(node, exp.Subquery):
                sources[node.alias_or_name.lower()] = ("query", node.this)
        return sources

    def _source_level(self, src: _Source, column: str) -> int:
        kind, target = src
        if kind == "table":
            return self._table_level(target, column)
        return self.shape(target).names.get(column, _NONE)

    def _column_level(self, col: exp.Column, select: exp.Select) -> int:
        column = col.name.lower()
        qualifier = col.table.lower()
        scope: exp.Expression | None = select
        while isinstance(scope, exp.Select):
            sources = self._sources(scope)
            if qualifier:
                if qualifier in sources:
                    return self._source_level(sources[qualifier], column)
            elif sources:
                return max(self._source_level(s, column) for s in sources.values())
            # 상관 서브쿼리: 바깥 SELECT 의 별칭을 찾아 올라갑니다
            scope = scope.parent.find_ancestor(exp.Select) if scope.parent else None
        return _NONE

    def _star_names(self, select: exp.Select, qualifier: str) -> dict[str, int]:
        sources = self._sources(select)
        chosen = [sources[qualifier]] if qualifier in sources else list(dict.fromkeys(sources.values()))
        names: dict[str, int] = {}
        for kind, target in chosen:
            if kind == "table":
                for column in self._table_columns(target):
                    names[column] = max(names.get(column, _NONE), self._table_level(target, column))
            else:
                for column, level in self.shape(target).names.items():
                    names[column] = max(names.get(column, _NONE), level)
        return names

    # ── 쿼리 모양 계산 ──
    def shape(self, query: exp.Expression) -> _Shape:
        key = id(query)
        if key in self._shapes:
            return self._shapes[key]
        if key in self._in_progress:  # 재귀 CTE 자기 참조
            return _Shape()
        self._in_progress.add(key)
        try:
            result = self._compute_shape(query)
        finally:
            self._in_progress.discard(key)
        self._shapes[key] = result
        return result

    def _compute_shape(self, query: exp.Expression) -> _Shape:
        if isinstance(query, exp.Subquery):
            return self.shape(query.this)
        if isinstance(query, exp.SetOperation):
            left, right = self.shape(query.this), self.shape(query.expression)
            merged = _Shape(dict(left.levels), dict(left.names))
            for i, level in right.levels.items():
                merged.levels[i] = max(merged.levels.get(i, _NONE), level)
            for name, level in right.names.items():
                merged.names[name] = max(merged.names.get(name, _NONE), level)
            return merged
        if not isinstance(query, exp.Select):
            return _Shape()

        out = _Shape()
        positional = True
        for i, proj in enumerate(query.expressions):
            inner = proj.this if isinstance(proj, exp.Alias) else proj
            if isinstance(inner, exp.Star) or (isinstance(inner, exp.Column) and inner.is_star):
                qualifier = inner.table.lower() if isinstance(inner, exp.Column) else ""
                for name, level in self._star_names(query, qualifier).items():
                    out.names[name] = max(out.names.get(name, _NONE), level)
                positional = False  # * 뒤의 열 번호는 실제 컬럼 수를 몰라 알 수 없음
                continue
            level = _NONE
            for col in proj.find_all(exp.Column):
                if col.find_ancestor(exp.Select) is query:
                    level = max(level, self._column_level(col, query))
            for sub in proj.find_all(exp.Select):
                level = max(level, self.shape(sub).max_level())
            name = proj.alias_or_name.lower()
            if name:
                out.names[name] = max(out.names.get(name, _NONE), level)
            if positional:
                out.levels[i] = level
        return out


def _parse(sql: str, sqlglot_dialect: str) -> exp.Expression | None:
    try:
        stmts = sqlglot.parse(sql, dialect=sqlglot_dialect)
    except Exception:
        # 파싱 실패는 7.1 이 먼저 거르므로 여기서는 판단하지 않고 통과시킵니다
        return None
    return stmts[0] if stmts and stmts[0] is not None else None


def analyze_pii(
    sql: str,
    pii_catalog: PiiCatalog | None = None,
    dialect: SQLDialect | None = None,
) -> PiiMaskPlan:
    """SQL 의 PII 사용을 판정합니다. block 컬럼이면 AccessDeniedError, 아니면 마스킹 계획을 돌려줘요."""
    dialect = dialect or get_dialect()
    catalog = pii_catalog if pii_catalog is not None else resolve_pii_catalog(None)
    root = _parse(sql, dialect.sqlglot_name)
    if root is None or not catalog:
        return PiiMaskPlan()

    analyzer = _Analyzer(root, catalog)
    try:
        # WHERE 서브쿼리 등 결과로 나가지 않는 SELECT 목록도 block 컬럼은 막습니다
        for select in root.find_all(exp.Select):
            analyzer.shape(select)
        top = analyzer.shape(root)
    except _PiiBlocked as e:
        raise AccessDeniedError(
            f"PII column '{e.table}.{e.column}' cannot be selected. "
            "Remove it from the SELECT list and retry (it may be used in the WHERE clause). "
            "[PII_COLUMN_BLOCKED]",
        ) from None

    return PiiMaskPlan(
        indices=frozenset(i for i, level in top.levels.items() if level >= _MASK),
        names=frozenset(n for n, level in top.names.items() if level >= _MASK),
    )


async def enforce_pii_input(
    sql: str,
    pii_catalog: PiiCatalog | None = None,
    dialect: SQLDialect | None = None,
) -> str:
    """block 컬럼을 고르는 SQL 을 차단한다. 통과 시 원본 SQL 반환 (마스킹 계획은 :func:`analyze_pii`)."""
    analyze_pii(sql, pii_catalog=pii_catalog, dialect=dialect)
    return sql


def mask_value(value: Any) -> Any:
    """카탈로그 mask 컬럼 값 가리기. 문자열은 앞 1글자만 남기고, 그 밖의 값은 ``***``."""
    if value is None:
        return None
    if isinstance(value, str):
        return f"{value[:1]}***" if len(value) > 1 else "***"
    return "***"


def mask_pii_output(
    rows: list[list[Any]],
    columns: list[str] | None = None,
    plan: PiiMaskPlan | None = None,
) -> tuple[list[list[Any]], list[str]]:
    """결과 행을 마스킹하고 ``(행, 마스킹된 컬럼 이름 목록)`` 을 돌려줍니다.

    ``plan`` 에 든 열은 :func:`mask_value` 로 통째로 가리고, 나머지 문자열 값은
    ``_common.masking.mask_pii`` 정규식으로 가립니다. 컬럼 이름이 없으면 ``col_<번호>`` 로 표시해요.
    """
    plan = plan or PiiMaskPlan()
    columns = columns or []
    masked_idx: set[int] = set()
    masked_rows: list[list[Any]] = []

    for row in rows:
        new_row: list[Any] = []
        for i, val in enumerate(row):
            name = columns[i] if i < len(columns) else None
            if plan.applies(i, name):
                new_val = mask_value(val)
            elif isinstance(val, str):
                new_val = mask_pii(val)
            else:
                new_val = val
            if new_val != val:
                masked_idx.add(i)
            new_row.append(new_val)
        masked_rows.append(new_row)

    masked_columns = [columns[i] if i < len(columns) else f"col_{i}" for i in sorted(masked_idx)]
    return masked_rows, masked_columns
