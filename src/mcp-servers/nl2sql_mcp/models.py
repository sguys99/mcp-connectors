"""nl2sql-mcp 도구 응답 모델. 스펙 §5.2 출력 예시 기반.

각 도구의 반환 타입으로 쓰여 FastMCP 가 ``outputSchema`` 와 structured content 를 만듭니다.
Agent 는 도구 목록만 보고도 응답 필드를 알 수 있어요. 백엔드(Mock, 실 DB)는 dict 를 돌려주고
도구가 ``model_validate`` 로 이 모델에 맞춥니다.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# 7.6 PII 표시: block 은 SELECT 목록에 넣으면 거부, mask 는 결과 값이 가려짐, None 은 일반 컬럼
PiiMark = Literal["block", "mask"] | None

# ── T-01 search_tables_schema ──────────────────────────────────────────────


class TableSummary(BaseModel):
    owner: str
    table_name: str
    comment: str | None = None
    column_count: int = 0
    # 카탈로그 통계 기준 행 수 추정치. 통계가 없는 뷰나 ANALYZE 전 테이블은 None(모름)
    estimated_rows: int | None = None


class SearchTablesResult(BaseModel):
    tables: list[TableSummary]
    match_count: int
    truncated: bool = False


# ── T-02 search_columns ────────────────────────────────────────────────────


class ColumnMatch(BaseModel):
    owner: str
    table_name: str
    column_name: str
    data_type: str
    comment: str | None = None
    pii: PiiMark = None


class SearchColumnsResult(BaseModel):
    columns: list[ColumnMatch]
    match_count: int
    truncated: bool = False


# ── T-03 get_table_schema ──────────────────────────────────────────────────


class ColumnDetail(BaseModel):
    name: str
    data_type: str
    nullable: bool = True
    comment: str | None = None
    pii: PiiMark = None


class ForeignKey(BaseModel):
    columns: list[str]
    ref_table: str
    ref_columns: list[str]


class TableSchema(BaseModel):
    owner: str
    table_name: str
    comment: str | None = None
    columns: list[ColumnDetail]
    primary_key: list[str] = Field(default_factory=list)
    foreign_keys: list[ForeignKey] = Field(default_factory=list)


# ── T-04 get_tables_schema ─────────────────────────────────────────────────


class TablesSchemaResult(BaseModel):
    tables: list[TableSchema]
    not_found: list[str] = Field(default_factory=list)


# ── T-14 run_sql_query ─────────────────────────────────────────────────────


class QueryExplain(BaseModel):
    estimated_cost: float | None = None
    estimated_rows: int | None = None
    full_scan_tables: list[str] = Field(default_factory=list)


class SqlQueryResult(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    truncated: bool = False
    masked_columns: list[str] = Field(
        default_factory=list,
        description="Result columns whose values were masked (7.6 catalog mask or PII regex)",
    )
    explain: QueryExplain = Field(default_factory=QueryExplain)
    data_source: Literal["database", "mock_sample"] = Field(
        default="database",
        description=(
            "Where the rows came from. mock_sample means the Mock backend answered from a small fixed "
            "sample of rows, so counts and totals describe the sample, not a real database"
        ),
    )
    notice: str | None = Field(
        default=None,
        description=(
            "Short note for the reader about the result, for example that it is mock sample data"
        ),
    )
