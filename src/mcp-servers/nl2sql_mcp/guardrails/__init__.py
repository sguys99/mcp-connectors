"""가드레일 파이프라인 실행기.

파이프라인 정의 (스펙 §7.10):
  PIPELINE_T14:    7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3 (T-14용 SQL 변환 파이프라인)
  PIPELINE_SCHEMA: 7.6→7.8 (T-01~T-04용, 7.6 은 컬럼 PII 표시)

각 가드레일은 guardrails/<name>.py 에 독립 파일로 구현된다.
차단형 가드레일은 ToolError를 raise, 변환형은 보정된 SQL 문자열을 반환한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from nl2sql_mcp.db.dialects import SQLDialect, get_dialect
from nl2sql_mcp.guardrails.audit_log import (
    AUDIT_STATUSES,
    BLOCKED_CODES,
    audit_call,
    purge_old_audit_records,
)
from nl2sql_mcp.guardrails.block_forbidden_constructs import block_forbidden_constructs
from nl2sql_mcp.guardrails.block_mass_scan import (
    DEFAULT_ROW_THRESHOLD,
    RowEstimator,
    block_mass_scan,
)
from nl2sql_mcp.guardrails.detect_risky_sql import detect_risky_sql
from nl2sql_mcp.guardrails.enforce_date_range import (
    DEFAULT_DATE_COLUMNS,
    enforce_date_range,
    resolve_date_columns,
)
from nl2sql_mcp.guardrails.enforce_pii_control import (
    PiiMaskPlan,
    analyze_pii,
    enforce_pii_input,
    mask_pii_output,
)
from nl2sql_mcp.guardrails.enforce_row_limit import enforce_row_limit
from nl2sql_mcp.guardrails.enforce_select_only import enforce_select_only
from nl2sql_mcp.guardrails.enforce_timeout import enforce_timeout
from nl2sql_mcp.pii_catalog import PiiAction, PiiCatalog, resolve_pii_catalog

__all__ = [
    "enforce_select_only",
    "enforce_date_range",
    "resolve_date_columns",
    "DEFAULT_DATE_COLUMNS",
    "enforce_row_limit",
    "enforce_timeout",
    "block_forbidden_constructs",
    "analyze_pii",
    "enforce_pii_input",
    "mask_pii_output",
    "PiiMaskPlan",
    "block_mass_scan",
    "RowEstimator",
    "DEFAULT_ROW_THRESHOLD",
    "audit_call",
    "purge_old_audit_records",
    "AUDIT_STATUSES",
    "BLOCKED_CODES",
    "detect_risky_sql",
    "GuardedSQL",
    "apply_sql_guardrails",
    "annotate_schema_pii",
    "PIPELINE_T14",
    "PIPELINE_SCHEMA",
]


# 파이프라인 순서 정의 (도구 레이어에서 참조용)
PIPELINE_T14 = ("7.1", "7.5", "7.9", "7.6_input", "7.7", "7.2", "7.3", "7.4", "7.6_output", "7.8")
PIPELINE_SCHEMA = ("7.6", "7.8")


@dataclass(frozen=True)
class GuardedSQL:
    """가드레일을 통과해 실행할 SQL 과 결과 마스킹 계획(7.6 출력 단계에서 사용)."""

    sql: str
    pii_plan: PiiMaskPlan


async def apply_sql_guardrails(
    sql: str,
    max_rows: int = 1000,
    forbidden_enabled: bool = True,
    risky_sql_enabled: bool = True,
    pii_catalog: PiiCatalog | None = None,
    default_months: int = 3,
    max_months: int = 12,
    require_where: bool = True,
    block_tautology: bool = True,
    dialect: SQLDialect | None = None,
    row_estimator: RowEstimator | None = None,
    mass_scan_row_threshold: int = DEFAULT_ROW_THRESHOLD,
    date_columns: dict[str, str] | None = None,
) -> GuardedSQL:
    """T-14 SQL 변환 파이프라인: 7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3.

    차단형 가드레일은 통과 불가 시 ToolError 를 raise.
    변환형 가드레일은 보정된 SQL 문자열을 만들고, 7.6 은 결과에서 가릴 열을 계획으로 넘깁니다.
    dialect 를 주지 않으면 설정값(NL2SQL_DB_DIALECT)을 쓴다.
    row_estimator 는 7.7 이 WHERE 없는 조회를 작은 테이블에만 허용할 때 쓰는 행 수 추정 함수입니다
    (보통 백엔드의 ``estimate_rows``). 주지 않으면 모든 테이블을 큰 테이블로 봅니다.
    date_columns 는 7.2 기간 컬럼 카탈로그(테이블 → 컬럼)이고, 주지 않으면 Pagila 기본값입니다.
    """
    d = dialect or get_dialect()
    sql = await enforce_select_only(sql, dialect=d)  # 7.1 차단형
    sql = await block_forbidden_constructs(sql, enabled=forbidden_enabled, dialect=d)  # 7.5 차단형
    sql = await detect_risky_sql(sql, enabled=risky_sql_enabled, dialect=d)  # 7.9 차단형
    pii_plan = analyze_pii(sql, pii_catalog=pii_catalog, dialect=d)  # 7.6 입력 차단 + 마스킹 계획
    sql = await block_mass_scan(  # 7.7 차단형
        sql,
        require_where=require_where,
        block_tautology=block_tautology,
        row_estimator=row_estimator,
        row_threshold=mass_scan_row_threshold,
        dialect=d,
    )
    sql = await enforce_date_range(  # 7.2 변환형
        sql,
        date_columns=date_columns,
        default_months=default_months,
        max_months=max_months,
        dialect=d,
    )
    sql = await enforce_row_limit(sql, max_rows=max_rows, dialect=d)  # 7.3 변환형
    return GuardedSQL(sql=sql, pii_plan=pii_plan)


def annotate_schema_pii(
    columns: list[dict[str, Any]],
    table_name: str,
    pii_catalog: PiiCatalog | None = None,
    column_key: str = "name",
) -> list[dict[str, Any]]:
    """스키마 조회 도구(T-01~T-04)의 7.6: 컬럼마다 PII 조치(block/mask)를 ``pii`` 로 표시합니다.

    컬럼을 숨기지 않고 표시만 하는 이유는, Agent 가 컬럼이 있다는 사실을 알아야 조건절에는 쓰고
    SELECT 목록에서는 빼는 SQL 을 짤 수 있기 때문입니다. 실제 차단은 run_sql_query 의 7.6 이 합니다.
    """
    catalog = pii_catalog if pii_catalog is not None else resolve_pii_catalog(None)
    table = table_name.rsplit(".", 1)[-1].lower()
    for col in columns:
        action: PiiAction | None = catalog.get((table, str(col.get(column_key, "")).lower()))
        col["pii"] = action.value if action else None
    return columns
