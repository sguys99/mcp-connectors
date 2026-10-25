"""nl2sql-mcp 설정. pydantic-settings 기반."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from _common.env import REPO_ROOT, env_files
from nl2sql_mcp.date_catalog import resolve_date_columns
from nl2sql_mcp.pii_catalog import PiiCatalog, resolve_pii_catalog

# 감사 로그 기본 위치. 저장소 루트 기준 절대 경로라 실행 위치(CWD)와 무관하고,
# var/ 는 gitignore 대상입니다.
# Docker 에서는 REPO_ROOT 가 /app 이므로 /app/var/nl2sql_mcp/audit.db 이고, 볼륨을 붙여 보존합니다.
DEFAULT_AUDIT_LOG_PATH = REPO_ROOT / "var" / "nl2sql_mcp" / "audit.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # 저장소 루트 .env 와 이 패키지의 .env(선택 override)를 CWD 와 무관하게 읽음
        env_file=env_files(__file__),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 서버
    nl2sql_mcp_port: int = 8004
    mcp_api_key: str | None = None

    # DB 종류와 백엔드
    # dialect: SQL 문법, 카탈로그 조회, 차단 목록을 고릅니다 (postgres 기본, oracle)
    nl2sql_db_dialect: Literal["postgres", "oracle"] = "postgres"
    # backend: mock(기본, 실 DB 없이 Pagila 픽스처) 또는 real(실 DB 접속)
    nl2sql_db_backend: Literal["mock", "real"] = "mock"

    # PostgreSQL 접속 (backend=real, dialect=postgres). DSN 을 주면 개별 항목보다 우선합니다
    nl2sql_pg_dsn: str | None = None
    nl2sql_pg_host: str = "localhost"
    nl2sql_pg_port: int = 5432
    nl2sql_pg_database: str = "pagila"
    nl2sql_pg_user: str = "nl2sql_ro"
    nl2sql_pg_password: str = ""

    # Oracle 접속 (backend=real, dialect=oracle). `uv sync --extra oracle` 필요
    nl2sql_oracle_dsn: str | None = None
    nl2sql_oracle_host: str = "localhost"
    nl2sql_oracle_port: int = 1521
    nl2sql_oracle_service: str = "ORCL"
    nl2sql_oracle_user: str = "nl2sql_ro"
    nl2sql_oracle_password: str = ""
    nl2sql_oracle_thick_mode: bool = False
    nl2sql_oracle_client_lib_dir: str | None = None

    # 가드레일 임계치
    guardrail_max_limit: int = 10000
    guardrail_default_months: int = 3
    guardrail_max_months: int = 12
    # 쿼리 타임아웃(초). asyncio 래퍼(7.4)와 Postgres statement_timeout 에 함께 씁니다
    guardrail_timeout_sec: int = 30

    # optional 가드레일 활성화 여부 (False = 비활성)
    guardrail_forbidden_enabled: bool = True  # 7.5
    guardrail_risky_sql_enabled: bool = True  # 7.9
    guardrail_require_where: bool = True  # 7.7: WHERE 없는 단일 테이블 조회 차단
    guardrail_block_tautology: bool = True  # 7.7: WHERE 1=1 / TRUE 같은 무력화 조건 차단
    # 7.7: WHERE 없는 조회를 허용할 작은 테이블의 기준(카탈로그 행 수 추정치). 모르는 테이블은 큰 테이블
    guardrail_mass_scan_row_threshold: int = 10000
    # 7.2: 기간 조건을 주입할 테이블별 기간 컬럼. 형식: 테이블.컬럼 콤마 목록.
    # 비우면 Pagila 기본값(payment.payment_date, rental.rental_date)을 씁니다
    guardrail_date_columns: str = ""

    # Mock 백엔드가 execute_query 마다 기다리는 시간(초). 0 이면 지연 없음.
    # Mock 으로 타임아웃 가드레일(7.4)을 재현할 때 GUARDRAIL_TIMEOUT_SEC 보다 크게 줍니다
    nl2sql_mock_delay_sec: float = 0.0

    # PII 통제 (7.6). 비우면 Pagila 기본 카탈로그(nl2sql_mcp/pii_catalog.py)를 씁니다.
    # 형식: 테이블.컬럼[:block|mask] 콤마 목록. 값을 주면 기본 카탈로그를 통째로 대체합니다
    pii_catalog_raw: str = ""

    # 감사 로그 (7.8). 상대 경로는 저장소 루트 기준으로 풉니다
    audit_log_path: Path = DEFAULT_AUDIT_LOG_PATH
    audit_retention_days: int = 30

    @field_validator("audit_log_path", mode="before")
    @classmethod
    def _empty_audit_path_is_default(cls, v: object) -> object:
        # .env 의 `AUDIT_LOG_PATH=` 처럼 빈 값이면 기본 경로를 씁니다
        return DEFAULT_AUDIT_LOG_PATH if v is None or (isinstance(v, str) and not v.strip()) else v

    @field_validator("audit_log_path", mode="after")
    @classmethod
    def _absolute_audit_path(cls, v: Path) -> Path:
        v = v.expanduser()
        return v if v.is_absolute() else (REPO_ROOT / v).resolve()

    @field_validator("pii_catalog_raw", mode="after")
    @classmethod
    def _valid_pii_catalog(cls, v: str) -> str:
        resolve_pii_catalog(v)  # 형식 오류를 기동 시점에 알립니다
        return v

    @field_validator("guardrail_date_columns", mode="after")
    @classmethod
    def _valid_date_columns(cls, v: str) -> str:
        resolve_date_columns(v)  # 형식 오류를 기동 시점에 알립니다
        return v

    @property
    def date_column_catalog(self) -> dict[str, str]:
        return resolve_date_columns(self.guardrail_date_columns)

    @property
    def pii_catalog(self) -> PiiCatalog:
        return resolve_pii_catalog(self.pii_catalog_raw)


settings = Settings()
