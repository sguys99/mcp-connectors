"""가드레일 7.2: 날짜 범위 제한 변환형 가드레일.

SELECT 하나하나(UNION 가지, 서브쿼리, CTE 본문 포함)를 sqlglot AST 로 봅니다.

기간 검사 (``DATE_RANGE_EXCEEDED``)
    WHERE 의 날짜 컬럼 비교(``>=``, ``>``, ``<=``, ``<``, ``=``, ``BETWEEN``)에서 하한과 상한을 구해
    ``max_months`` 를 넘는지 봅니다. 날짜 컬럼은 기간 컬럼 카탈로그의 컬럼과 이름이
    ``_date``/``_at``/``_dt``/``_time`` 으로 끝나는 컬럼입니다.

    - 값으로 읽는 형태: ``DATE '2026-01-01'``, ``'2026-01-01'::date``, ``CAST(... AS DATE)``,
      ``TIMESTAMP '...'``, ``TO_DATE('2026-01-01', ...)``, 날짜 모양 문자열, 그리고 상대식
      ``CURRENT_DATE``/``NOW()``/``SYSDATE`` 와 ``± INTERVAL 'N months|days|years'``,
      ``ADD_MONTHS(SYSDATE, -N)``,
      ``SYSDATE - N``(일)
    - 하한만 있으면 상한을 오늘로 보고 계산합니다
      (``rental_date >= DATE '2022-01-01'`` 은 오늘까지의 기간)
    - 상한만 있으면 기간이 끝없이 열려 있으므로 초과로 봅니다
    - 서브쿼리처럼 값을 계산할 수 없는 경계는 검사에서 뺍니다
    - 경계 판정은 달력 기준입니다: 하한이 ``상한 - max_months 개월`` 보다 이르면 초과

기간 조건 주입
    기간 컬럼 카탈로그(``GUARDRAIL_DATE_COLUMNS``, 기본 Pagila ``payment.payment_date``,
    ``rental.rental_date``)에 있는 테이블을 읽는 SELECT 에 날짜 컬럼 비교가 하나도 없으면
    ``<별칭>.<기간 컬럼> >= <N개월 전>`` 을 WHERE 에 AND 로 붙입니다
    (Postgres ``CURRENT_DATE - INTERVAL 'N months'``, Oracle ``ADD_MONTHS(SYSDATE, -N)``).

    - 주입 대상은 결정적입니다: 그 SELECT 의 FROM, JOIN 순서에서 카탈로그에 있는 첫 테이블의 기간 컬럼
    - AST 에 조건을 넣고 SQL 을 다시 만들므로 GROUP BY, ORDER BY, LIMIT/FETCH FIRST 앞의 올바른 자리에
      들어갑니다
    - 날짜 컬럼 비교가 이미 있는 SELECT 는 건드리지 않습니다 (``IS NULL`` 은 기간 조건이 아님)

``date_columns`` 에 리스트(예: ``["payment_date"]``)를 주면 테이블 구분 없이 그 컬럼들을 날짜 컬럼으로
보고, 첫 컬럼을 테이블을 읽는 가장 바깥 SELECT 에 한정자 없이 주입합니다(이전 동작 호환).
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

import sqlglot
import sqlglot.expressions as exp

from _common.errors import InvalidInputError
from nl2sql_mcp.date_catalog import DEFAULT_DATE_COLUMNS, resolve_date_columns
from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.sql_ast import parse_query, scope_tables, select_scopes

__all__ = [
    "DEFAULT_DATE_COLUMNS",
    "enforce_date_range",
    "resolve_date_columns",
    "add_months",
    "eval_date",
]

_DATE_NAME_RE = re.compile(r"(?:_AT|_DT|_DATE|_TIME)$", re.IGNORECASE)
_DATE_STR_RE = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")


# ── 날짜 계산 ────────────────────────────────────────────────────────────────


def add_months(d: date, months: int) -> date:
    """달력 기준으로 months 개월을 더합니다(말일 보정)."""
    total = d.year * 12 + (d.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _months_between(d1: date, d2: date) -> float:
    """메시지용 근사 개월 수 (연 평균 일수 기준)."""
    return round(abs((d2 - d1).days) / 30.4375, 2)


def _parse_date_str(text: str) -> date | None:
    m = _DATE_STR_RE.match(text)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


_NOW_FUNCS = {"NOW", "SYSDATE", "SYSTIMESTAMP", "CURRENT_DATE", "CURRENT_TIMESTAMP", "LOCALTIMESTAMP"}


def _interval_shift(interval: exp.Interval) -> tuple[str, int] | None:
    """``INTERVAL '3 months'`` / ``INTERVAL '3' MONTH`` → ("months", 3)."""
    raw = interval.this.name if interval.this is not None else ""
    unit = interval.args.get("unit")
    unit_text = unit.name if unit is not None else ""
    parts = str(raw).split()
    if len(parts) == 2 and not unit_text:
        raw, unit_text = parts
    try:
        n = int(float(raw))
    except ValueError:
        return None
    unit_text = unit_text.lower().rstrip("s")
    if unit_text in {"month", "mon"}:
        return ("months", n)
    if unit_text in {"year", "yr"}:
        return ("months", n * 12)
    if unit_text == "day":
        return ("days", n)
    if unit_text == "week":
        return ("days", n * 7)
    return None


def _shift(d: date, kind: str, n: int) -> date:
    return add_months(d, n) if kind == "months" else d + timedelta(days=n)


def eval_date(node: exp.Expression | None, today: date) -> date | None:
    """날짜 값으로 읽을 수 있는 식이면 날짜를, 아니면 None 을 돌려줍니다."""
    if node is None:
        return None
    if isinstance(node, exp.Paren):
        return eval_date(node.this, today)
    if isinstance(node, exp.Literal):
        return _parse_date_str(node.name) if node.is_string else None
    if isinstance(node, (exp.Cast, exp.TryCast)):
        return eval_date(node.this, today)
    if isinstance(node, (exp.StrToDate, exp.StrToTime, exp.TsOrDsToDate, exp.Date)):
        return eval_date(node.this, today)
    if (
        isinstance(node, exp.Func)
        and re.search(r"Date|Time", type(node).__name__)
        and isinstance(node.this, exp.Literal)
    ):
        # DateStrToDate(Oracle DATE '...'), TimeStrToTime 등 문자열 리터럴을 날짜로 바꾸는 함수
        return eval_date(node.this, today)
    if isinstance(node, (exp.CurrentDate, exp.CurrentTimestamp, exp.CurrentDatetime)):
        return today
    if isinstance(node, exp.Anonymous) and node.name.upper() in {"NOW", "TO_DATE", "TO_TIMESTAMP"}:
        return today if node.name.upper() == "NOW" else eval_date(seq_first(node), today)
    if isinstance(node, (exp.Column, exp.Var)) and node.name.upper() in _NOW_FUNCS:
        return today
    if isinstance(node, exp.AddMonths):
        base = eval_date(node.this, today)
        n = _eval_int(node.expression)
        return add_months(base, n) if base is not None and n is not None else None
    if isinstance(node, (exp.Sub, exp.Add)):
        base = eval_date(node.this, today)
        if base is None:
            return None
        sign = -1 if isinstance(node, exp.Sub) else 1
        right = node.expression
        if isinstance(right, exp.Interval):
            shift = _interval_shift(right)
            return _shift(base, shift[0], sign * shift[1]) if shift else None
        n = _eval_int(right)  # Oracle: SYSDATE - 30 은 30일 전
        return base + timedelta(days=sign * n) if n is not None else None
    if isinstance(node, (exp.DateSub, exp.DateAdd)):
        base = eval_date(node.this, today)
        n = _eval_int(node.expression)
        unit_node = node.args.get("unit")
        unit = (unit_node.name if unit_node is not None else "day").lower()
        if base is None or n is None:
            return None
        if unit.startswith("year"):
            kind, n = "months", n * 12
        elif unit.startswith("month"):
            kind = "months"
        else:
            kind = "days"
        return _shift(base, kind, n if isinstance(node, exp.DateAdd) else -n)
    return None


def seq_first(node: exp.Anonymous) -> exp.Expression | None:
    return node.expressions[0] if node.expressions else None


def _eval_int(node: exp.Expression | None) -> int | None:
    if isinstance(node, exp.Neg):
        v = _eval_int(node.this)
        return -v if v is not None else None
    if isinstance(node, exp.Paren):
        return _eval_int(node.this)
    if isinstance(node, exp.Literal) and not node.is_string:
        try:
            return int(float(node.name))
        except ValueError:
            return None
    return None


# ── WHERE 분석 ───────────────────────────────────────────────────────────────


@dataclass
class _Bounds:
    lower: list[date] = field(default_factory=list)
    upper: list[date] = field(default_factory=list)
    lower_unknown: bool = False
    upper_unknown: bool = False

    def add(self, side: str, value: date | None) -> None:
        if side in ("lower", "both"):
            if value is None:
                self.lower_unknown = True
            else:
                self.lower.append(value)
        if side in ("upper", "both"):
            if value is None:
                self.upper_unknown = True
            else:
                self.upper.append(value)


_LOWER_OPS = {exp.GTE: "lower", exp.GT: "lower", exp.LTE: "upper", exp.LT: "upper", exp.EQ: "both"}
_FLIP = {"lower": "upper", "upper": "lower", "both": "both"}


def _own_nodes(where: exp.Where, scope: exp.Select):
    """WHERE 안에서 같은 SELECT 에 속한 비교식만 (서브쿼리 안쪽 제외)."""
    for node in where.find_all(exp.Predicate):
        if node.find_ancestor(exp.Select) is scope:
            yield node


def _comparisons(scope: exp.Select, is_date_col, today: date) -> dict[tuple[str, str], _Bounds]:
    """(한정자, 컬럼) → 경계. 한정자가 없으면 빈 문자열."""
    where = scope.args.get("where")
    found: dict[tuple[str, str], _Bounds] = {}
    if where is None:
        return found
    for node in _own_nodes(where, scope):
        if isinstance(node, exp.Between):
            col = node.this
            if isinstance(col, exp.Column) and is_date_col(col.name):
                b = found.setdefault((col.table.lower(), col.name.lower()), _Bounds())
                b.add("lower", eval_date(node.args.get("low"), today))
                b.add("upper", eval_date(node.args.get("high"), today))
            continue
        side = _LOWER_OPS.get(type(node))
        if side is None:
            continue
        left, right = node.this, node.expression
        if isinstance(left, exp.Column) and is_date_col(left.name):
            col, value = left, right
        elif isinstance(right, exp.Column) and is_date_col(right.name):
            col, value, side = right, left, _FLIP[side]
        else:
            continue
        if isinstance(value, exp.Column) and not value.table and value.name.upper() not in _NOW_FUNCS:
            continue  # 컬럼끼리 비교(조인 조건 등)는 기간 조건이 아닙니다
        b = found.setdefault((col.table.lower(), col.name.lower()), _Bounds())
        b.add(side, eval_date(value, today))
    return found


def _check_span(column: str, bounds: _Bounds, today: date, max_months: int) -> None:
    has_lower = bool(bounds.lower) or bounds.lower_unknown
    has_upper = bool(bounds.upper) or bounds.upper_unknown
    if has_upper and not has_lower:
        raise InvalidInputError(
            f"The condition on '{column}' has no lower bound, so the query period is open-ended. "
            f"Specify a start date within the last {max_months} months. [DATE_RANGE_EXCEEDED]"
        )
    if not bounds.lower:
        return
    lower = min(bounds.lower)
    if bounds.upper:
        upper = max(bounds.upper)
    elif bounds.upper_unknown:
        return  # 상한을 계산할 수 없으면 판정하지 않습니다
    else:
        upper = today  # 하한만 있으면 오늘까지
    if lower < add_months(upper, -max_months):
        raise InvalidInputError(
            f"The query period on '{column}' is about {_months_between(lower, upper)} months "
            f"({lower} to {upper}), "
            f"which exceeds the maximum allowed ({max_months} months). Narrow the period and retry. "
            "[DATE_RANGE_EXCEEDED]"
        )


async def enforce_date_range(
    sql: str,
    date_columns: dict[str, str] | list[str] | None = None,
    default_months: int = 3,
    max_months: int = 12,
    dialect: SQLDialect | None = None,
    today: date | None = None,
) -> str:
    """날짜 범위 조건을 검증하고 미지정 시 자동 주입한다. 보정된 SQL 반환."""
    dialect = dialect or get_dialect()
    today = today or date.today()
    root = parse_query(sql, dialect)
    if root is None:
        return sql

    if isinstance(date_columns, list):
        legacy = [c.lower() for c in date_columns]
        catalog: dict[str, str] = {}
    else:
        legacy = []
        catalog = {k.lower(): v.lower() for k, v in (date_columns or DEFAULT_DATE_COLUMNS).items()}
    known = set(legacy) | set(catalog.values())

    def is_date_col(name: str) -> bool:
        return name.lower() in known or bool(_DATE_NAME_RE.search(name))

    since = sqlglot.parse_one(dialect.months_ago_expr(default_months), dialect=dialect.sqlglot_name)
    changed = False
    legacy_done = False

    for scope in select_scopes(root):
        comparisons = _comparisons(scope, is_date_col, today)
        for (_, column), bounds in comparisons.items():
            _check_span(column, bounds, today, max_months)
        if comparisons:
            continue  # 기간 조건이 이미 있습니다

        tables = scope_tables(scope)
        target: exp.Column | None = None
        if legacy:
            if tables and not legacy_done:
                target = exp.column(date_columns[0])  # type: ignore[index]
                legacy_done = True
        else:
            for ref in tables:
                if ref.name in catalog:
                    target = exp.column(catalog[ref.name], table=ref.alias)
                    break
        if target is None:
            continue
        scope.where(exp.GTE(this=target, expression=since.copy()), append=True, copy=False)
        changed = True

    return root.sql(dialect=dialect.sqlglot_name) if changed else sql
