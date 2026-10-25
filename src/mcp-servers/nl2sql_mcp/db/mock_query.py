"""Mock 백엔드의 작은 쿼리 해석기.

SQL 엔진을 흉내 내려는 것이 아니라, 가드레일을 통과한 SELECT 에 "그럴듯하고 일관된" 결과를 주려는
것입니다. sqlglot AST 를 보고 픽스처 샘플 행에 아래만 적용합니다.

- FROM 의 첫 테이블(또는 CTE, 서브쿼리)을 주 테이블로 씁니다. JOIN 한 테이블의 컬럼은 그 테이블 샘플의
  같은 순번 행에서 가져옵니다(실제 조인은 하지 않음).
- WHERE: ``=``, ``<>``, ``<``, ``<=``, ``>``, ``>=``, ``IN``, ``BETWEEN``, ``LIKE``, ``IS [NOT] NULL``,
  ``AND``/``OR``/``NOT`` 을 숫자, 문자열, 불리언 값에 적용합니다. 날짜 비교, 함수, 서브쿼리처럼 판단할 수
  없는 조건은 거르지 않습니다(샘플이 2022년 데이터라 7.2 가 넣은 "최근 N개월" 조건으로 모두 사라지지
  않게 하려는 것).
- 집계: ``GROUP BY`` 컬럼이 샘플에 있으면 실제로 묶고 ``COUNT``/``SUM``/``AVG``/``MIN``/``MAX`` 를
  계산합니다. 묶을 수 없으면 ``VAL_1``~``VAL_3`` 세 그룹을 만듭니다. GROUP BY 없는 ``COUNT(*)`` 는
  WHERE 가 없으면 카탈로그 행 수, 있으면 걸러진 샘플 행 수입니다.
- 결과 컬럼 이름은 별칭을 따릅니다. 별칭 없는 함수는 Postgres 처럼 함수 이름(``count``),
  Oracle 처럼 식 전체 대문자(``COUNT(*)``)로 씁니다.
- ``DISTINCT``, ``UNION``/``UNION ALL``/``INTERSECT``/``EXCEPT``, 단순 ``ORDER BY``,
  ``LIMIT``/``OFFSET``/``FETCH FIRST`` 를 적용합니다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import sqlglot.expressions as exp

from nl2sql_mcp.db.dialects import SQLDialect
from nl2sql_mcp.guardrails.sql_ast import parse_query

_UNKNOWN = object()
_DATE_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_AGG_TYPES: tuple[type[exp.Expression], ...] = (exp.Count, exp.Sum, exp.Avg, exp.Min, exp.Max)


@dataclass
class Relation:
    columns: list[str]
    rows: list[list[Any]]

    def index(self, name: str) -> int | None:
        lname = name.lower()
        for i, c in enumerate(self.columns):
            if c.lower() == lname:
                return i
        return None


@dataclass
class _Source:
    alias: str
    relation: Relation
    table: str | None  # 실제 테이블이면 이름


class MockQueryEngine:
    def __init__(
        self,
        dialect: SQLDialect,
        samples: dict[str, dict[str, Any]],
        schemas: dict[str, dict[str, Any]],
    ) -> None:
        self.dialect = dialect
        self.samples = samples
        self.schemas = schemas

    # ── 진입점 ──
    def run(self, sql: str) -> tuple[Relation, dict[str, Any]]:
        """``(결과, explain)``. 파싱이 안 되면 빈 결과."""
        root = parse_query(sql, self.dialect)
        if root is None:
            return Relation([], []), {
                "estimated_cost": None,
                "estimated_rows": 0,
                "full_scan_tables": [],
            }
        self._ctes: dict[str, exp.Expression] = {
            cte.alias_or_name.lower(): cte.this for cte in root.find_all(exp.CTE)
        }
        self._scanned: list[str] = []
        rel = self._query(root)
        explain = {
            "estimated_cost": float(max(len(rel.rows), 1) * 10),
            "estimated_rows": len(rel.rows),
            "full_scan_tables": list(dict.fromkeys(self._scanned)),
        }
        return rel, explain

    # ── 쿼리 ──
    def _query(self, node: exp.Expression) -> Relation:
        if isinstance(node, exp.Subquery):
            return self._query(node.this)
        if isinstance(node, exp.SetOperation):
            rel = self._set_operation(node)
        elif isinstance(node, exp.Select):
            rel = self._select(node)
        else:
            return Relation([], [])
        rel = self._order(node, rel)
        return self._limit(node, rel)

    def _set_operation(self, node: exp.SetOperation) -> Relation:
        left = self._query(node.this)
        right = self._query(node.expression)
        width = len(left.columns)
        right_rows = [(r + [None] * width)[:width] for r in right.rows]
        if isinstance(node, exp.Intersect):
            keys = {tuple(r) for r in right_rows}
            rows = [r for r in left.rows if tuple(r) in keys]
        elif isinstance(node, exp.Except):
            keys = {tuple(r) for r in right_rows}
            rows = [r for r in left.rows if tuple(r) not in keys]
        else:
            rows = left.rows + right_rows
        if node.args.get("distinct", True) and not isinstance(node, exp.Except):
            rows = _dedupe(rows)
        return Relation(left.columns, rows)

    def _sources(self, select: exp.Select) -> list[_Source]:
        nodes: list[exp.Expression] = []
        from_ = select.args.get("from_") or select.args.get("from")
        if from_ is not None:
            nodes.append(from_.this)
        nodes.extend(j.this for j in select.args.get("joins") or [])
        sources: list[_Source] = []
        for node in nodes:
            alias = node.alias_or_name
            if isinstance(node, exp.Subquery):
                sources.append(_Source(alias, self._query(node.this), None))
            elif isinstance(node, exp.Table):
                name = node.name.lower()
                if name in self._ctes and not node.db:
                    sources.append(_Source(alias, self._query(self._ctes[name]), None))
                else:
                    sources.append(_Source(alias, self._table(name), name))
        return sources

    def _table(self, name: str) -> Relation:
        sample = self.samples.get(name)
        if sample is not None:
            return Relation(list(sample["columns"]), [list(r) for r in sample["rows"]])
        schema = self.schemas.get(name)
        if schema is not None:
            return Relation([c["name"] for c in schema["columns"]], [])
        return Relation([], [])

    def _select(self, select: exp.Select) -> Relation:
        sources = self._sources(select)
        main = sources[0] if sources else _Source("", Relation([], [[]]), None)
        where = select.args.get("where")
        if where is None and main.table:
            self._scanned.append(main.table)

        contexts = [_Row(sources, i) for i in range(len(main.relation.rows))]
        if where is not None:
            contexts = [c for c in contexts if _truth(c.eval(where.this)) is not False]

        group = select.args.get("group")
        has_agg = any(e.find(*_AGG_TYPES) for e in select.expressions)
        if group is not None or has_agg:
            rel = self._aggregate(select, sources, contexts, group, where is not None)
        else:
            rel = self._project(select, sources, contexts)
        if select.args.get("distinct"):
            rel = Relation(rel.columns, _dedupe(rel.rows))
        return rel

    # ── 투영 ──
    def _label(self, expr: exp.Expression) -> str:
        if isinstance(expr, exp.Alias):
            return expr.alias
        if isinstance(expr, exp.Column):
            return expr.name
        if self.dialect.name == "oracle":
            return expr.sql(dialect=self.dialect.sqlglot_name).upper()
        if isinstance(expr, exp.Func):
            return (expr.sql_name() or "?column?").lower()
        return "?column?"

    def _expand(self, select: exp.Select, sources: list[_Source]) -> list[tuple[str, exp.Expression]]:
        items: list[tuple[str, exp.Expression]] = []
        for expr in select.expressions:
            inner = expr.this if isinstance(expr, exp.Alias) else expr
            star_qualifier: str | None = None
            if isinstance(inner, exp.Star):
                star_qualifier = ""
            elif isinstance(inner, exp.Column) and isinstance(inner.this, exp.Star):
                star_qualifier = inner.table.lower()
            if star_qualifier is not None:
                for src in sources:
                    if star_qualifier and src.alias.lower() != star_qualifier:
                        continue
                    for col in src.relation.columns:
                        items.append((col, exp.column(col, table=src.alias)))
                continue
            items.append((self._label(expr), inner))
        return items

    def _project(self, select: exp.Select, sources: list[_Source], contexts: list[_Row]) -> Relation:
        items = self._expand(select, sources)
        rows = [[_value(ctx.eval(e)) for _, e in items] for ctx in contexts]
        return Relation([label for label, _ in items], rows)

    # ── 집계 ──
    def _aggregate(
        self,
        select: exp.Select,
        sources: list[_Source],
        contexts: list[_Row],
        group: exp.Group | None,
        has_where: bool,
    ) -> Relation:
        items = self._expand(select, sources)
        labels = [label for label, _ in items]
        keys = list(group.expressions) if group is not None else []

        if keys and contexts and all(contexts[0].eval(k) is _UNKNOWN for k in keys):
            # 그룹 키를 샘플에서 찾을 수 없음 → 세 그룹을 합성합니다
            rows = []
            for i in range(1, 4):
                row = []
                for j, (_, e) in enumerate(items):
                    row.append(f"VAL_{i}" if not e.find(*_AGG_TYPES) else 100 * (j + 1))
                rows.append(row)
            return Relation(labels, rows)

        groups: dict[tuple[Any, ...], list[_Row]] = {}
        for ctx in contexts:
            groups.setdefault(tuple(_value(ctx.eval(k)) for k in keys), []).append(ctx)
        if not keys:
            groups = {(): contexts}

        main = sources[0] if sources else None
        catalog_rows: int | None = None
        if not keys and not has_where and main is not None and main.table:
            catalog_rows = self.schemas.get(main.table, {}).get("estimated_rows")

        rows = []
        for members in groups.values():
            row = []
            for j, (_, e) in enumerate(items):
                row.append(self._agg_value(e, members, j, catalog_rows))
            rows.append(row)
        return Relation(labels, rows)  # HAVING 은 판단하지 않습니다

    def _agg_value(
        self, e: exp.Expression, members: list[_Row], j: int, catalog_rows: int | None
    ) -> Any:
        if isinstance(e, exp.Count):
            arg = e.this
            if arg is None or isinstance(arg, exp.Star):
                return catalog_rows if catalog_rows is not None else len(members)
            vals = [_value(m.eval(arg)) for m in members]
            if catalog_rows is not None and all(v is None for v in vals):
                return catalog_rows
            return sum(1 for v in vals if v is not None)
        if isinstance(e, (exp.Sum, exp.Avg, exp.Min, exp.Max)):
            vals = [_value(m.eval(e.this)) for m in members]
            nums = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if not nums:
                return 100 * (j + 1) if any(m.eval(e.this) is _UNKNOWN for m in members) else None
            if isinstance(e, exp.Sum):
                return round(sum(nums), 2)
            if isinstance(e, exp.Avg):
                return round(sum(nums) / len(nums), 4)
            return min(nums) if isinstance(e, exp.Min) else max(nums)
        if e.find(*_AGG_TYPES):
            return 100 * (j + 1)
        return _value(members[0].eval(e)) if members else None

    # ── 정렬, 행 수 제한 ──
    def _order(self, node: exp.Expression, rel: Relation) -> Relation:
        order = node.args.get("order")
        if order is None or not rel.rows:
            return rel
        rows = list(rel.rows)
        for ordered in reversed(order.expressions):
            key = ordered.this
            idx: int | None = None
            if isinstance(key, exp.Literal) and not key.is_string:
                pos = int(key.name) - 1
                idx = pos if 0 <= pos < len(rel.columns) else None
            elif isinstance(key, exp.Column):
                idx = rel.index(key.name)
            if idx is None:
                continue
            desc = bool(ordered.args.get("desc"))
            present = [r for r in rows if r[idx] is not None]
            missing = [r for r in rows if r[idx] is None]
            try:
                present.sort(key=lambda r, i=idx: r[i], reverse=desc)
            except TypeError:
                present.sort(key=lambda r, i=idx: str(r[i]), reverse=desc)
            rows = present + missing
        return Relation(rel.columns, rows)

    def _limit(self, node: exp.Expression, rel: Relation) -> Relation:
        offset_node = node.args.get("offset")
        offset = _int(offset_node.expression) if isinstance(offset_node, exp.Offset) else None
        rows = rel.rows[offset or 0 :]
        limit = node.args.get("limit")
        n: int | None = None
        if isinstance(limit, exp.Limit):
            n = _int(limit.expression)
        elif isinstance(limit, exp.Fetch):
            n = _int(limit.args.get("count"))
        if n is not None:
            rows = rows[:n]
        return Relation(rel.columns, rows)


# ── 행 평가 ──


class _Row:
    def __init__(self, sources: list[_Source], index: int) -> None:
        self.sources = sources
        self.index = index

    def _lookup(self, column: exp.Column) -> Any:
        name, qualifier = column.name, column.table.lower()
        candidates = (
            [s for s in self.sources if s.alias.lower() == qualifier or (s.table or "") == qualifier]
            if qualifier
            else self.sources
        )
        for src in candidates:
            idx = src.relation.index(name)
            if idx is None or not src.relation.rows:
                continue
            is_main = src is self.sources[0]
            rows = src.relation.rows
            row = rows[self.index] if is_main else rows[self.index % len(rows)]
            return row[idx]
        return _UNKNOWN

    def eval(self, node: exp.Expression | None) -> Any:
        if node is None:
            return _UNKNOWN
        if isinstance(node, exp.Paren):
            return self.eval(node.this)
        if isinstance(node, exp.Column):
            return self._lookup(node)
        if isinstance(node, exp.Literal):
            if node.is_string:
                return node.name
            try:
                return int(node.name) if node.name.lstrip("-").isdigit() else float(node.name)
            except ValueError:
                return _UNKNOWN
        if isinstance(node, exp.Boolean):
            return bool(node.this)
        if isinstance(node, exp.Null):
            return None
        if isinstance(node, exp.Neg):
            v = self.eval(node.this)
            return -v if isinstance(v, (int, float)) else _UNKNOWN
        if isinstance(node, exp.And):
            return _and(_truth(self.eval(node.this)), _truth(self.eval(node.expression)))
        if isinstance(node, exp.Or):
            return _or(_truth(self.eval(node.this)), _truth(self.eval(node.expression)))
        if isinstance(node, exp.Not):
            t = _truth(self.eval(node.this))
            return None if t is None else not t
        if isinstance(node, exp.Is):
            v = self.eval(node.this)
            if v is _UNKNOWN or not isinstance(node.expression, exp.Null):
                return None
            return v is None
        if isinstance(node, exp.In):
            v = self.eval(node.this)
            if v is _UNKNOWN or node.args.get("query") is not None:
                return None
            opts = [self.eval(e) for e in node.expressions]
            if any(o is _UNKNOWN for o in opts):
                return None
            return any(_cmp(v, o) == 0 for o in opts)
        if isinstance(node, exp.Between):
            v = self.eval(node.this)
            lo, hi = self.eval(node.args.get("low")), self.eval(node.args.get("high"))
            a, b = _cmp(v, lo), _cmp(v, hi)
            return None if a is None or b is None else a >= 0 and b <= 0
        if isinstance(node, (exp.Like, exp.ILike)):
            v, pat = self.eval(node.this), self.eval(node.expression)
            if not isinstance(v, str) or not isinstance(pat, str):
                return None
            regex = (
                "^"
                + "".join(".*" if ch == "%" else "." if ch == "_" else re.escape(ch) for ch in pat)
                + "$"
            )
            flags = re.IGNORECASE if isinstance(node, exp.ILike) else 0
            return re.match(regex, v, flags) is not None
        ops = {exp.EQ: "==", exp.NEQ: "!=", exp.GT: ">", exp.GTE: ">=", exp.LT: "<", exp.LTE: "<="}
        op = ops.get(type(node))
        if op is not None:
            c = _cmp(self.eval(node.this), self.eval(node.expression))
            if c is None:
                return None
            return {"==": c == 0, "!=": c != 0, ">": c > 0, ">=": c >= 0, "<": c < 0, "<=": c <= 0}[op]
        return _UNKNOWN


def _truth(v: Any) -> bool | None:
    if v is _UNKNOWN or v is None:
        return None
    return bool(v)


def _and(a: bool | None, b: bool | None) -> bool | None:
    if a is False or b is False:
        return False
    if a is None or b is None:
        return None
    return True


def _or(a: bool | None, b: bool | None) -> bool | None:
    if a is True or b is True:
        return True
    if a is None or b is None:
        return None
    return False


def _cmp(a: Any, b: Any) -> int | None:
    """비교 결과(-1, 0, 1). 판단할 수 없으면 None (날짜 문자열 비교 포함)."""
    if a is _UNKNOWN or b is _UNKNOWN or a is None or b is None:
        return None
    if isinstance(a, str) and isinstance(b, str):
        if _DATE_LIKE.match(a) or _DATE_LIKE.match(b):
            return None
        return (a > b) - (a < b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return (a > b) - (a < b)
    return None


def _value(v: Any) -> Any:
    return None if v is _UNKNOWN else v


def _int(node: exp.Expression | None) -> int | None:
    if isinstance(node, exp.Literal) and not node.is_string:
        try:
            return int(node.name)
        except ValueError:
            return None
    return None


def _dedupe(rows: list[list[Any]]) -> list[list[Any]]:
    seen: set[str] = set()
    out: list[list[Any]] = []
    for r in rows:
        key = repr(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out
