"""7.2 기간 컬럼 카탈로그: 기간 조건을 주입할 테이블과 그 기간 컬럼.

``GUARDRAIL_DATE_COLUMNS`` (``테이블.컬럼`` 콤마 목록)로 바꿀 수 있고, 비우면 Pagila 기본값을 씁니다.
기본값은 시간에 따라 계속 쌓이는 거래성 테이블만 둡니다. 주입 대상이 테이블마다 하나로 정해져 있어
날짜 컬럼이 여럿인 쿼리에서도 결과가 결정적입니다(P2-6).
"""

from __future__ import annotations

# Pagila 기본 기간 컬럼 카탈로그: 시간에 따라 계속 쌓이는 거래성 테이블만 둡니다
DEFAULT_DATE_COLUMNS: dict[str, str] = {"payment": "payment_date", "rental": "rental_date"}


def resolve_date_columns(raw: str | None) -> dict[str, str]:
    """``테이블.컬럼`` 콤마 목록을 카탈로그로 바꿉니다. 비어 있으면 Pagila 기본값."""
    if raw is None or not raw.strip():
        return dict(DEFAULT_DATE_COLUMNS)
    catalog: dict[str, str] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "." not in item:
            raise ValueError(
                f"GUARDRAIL_DATE_COLUMNS entries must use the 'table.column' format: {item!r}"
            )
        table, column = item.rsplit(".", 1)
        catalog[table.strip().lower().rsplit(".", 1)[-1]] = column.strip().lower()
    return catalog
