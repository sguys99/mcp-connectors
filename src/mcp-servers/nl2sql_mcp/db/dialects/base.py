"""SQL dialect 어댑터 공통 인터페이스.

가드레일, 커넥터, Mock 백엔드가 DB 종류별 문법을 직접 하드코딩하지 않도록
아래 다섯 가지를 dialect 객체 하나로 모읍니다.

1. 파싱: sqlglot dialect 이름 (``sqlglot_name``)
2. 행 수 제한: 기존 제한 감지, 값 추출, 주입, 끝부분 분리 (7.3)
3. 날짜: 리터럴 렌더링, 현재 날짜, N개월 전 식, 리터럴 추출 (7.2)
4. 차단 목록: 시스템 스키마/객체 (7.5), 위험 함수 (7.9)
5. 카탈로그 SQL: 테이블/컬럼/코멘트/PK/FK 조회문 (실 DB 커넥터용)

``split_trailing_row_limit`` 은 날짜 조건 주입처럼 SQL 끝에 절을 덧붙이는 변환이
``LIMIT``/``FETCH FIRST`` 앞에 끼워 넣을 때 쓸 수 있습니다. 가드레일은 P2-6부터 AST 로 처리해요.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime

# 다중 문장 차단은 모든 dialect 공통
MULTI_STATEMENT_RULE: tuple[re.Pattern[str], str] = (
    re.compile(r";\s*\S", re.IGNORECASE),
    "multiple SQL statements (separated by semicolons)",
)

# 모든 dialect 가 인식하는 ANSI 날짜 리터럴: DATE 'YYYY-MM-DD'
ANSI_DATE_LITERAL_RE = re.compile(r"\bDATE\s+'(\d{4}-\d{2}-\d{2})'", re.IGNORECASE)


@dataclass(frozen=True)
class CatalogQueries:
    """실 DB 카탈로그 조회 SQL 묶음. 바인드 변수 표기는 드라이버 규칙을 따릅니다.

    공통 바인드 이름: ``pattern``, ``lim`` (검색), ``owner``, ``tname`` (단건 조회).
    결과 컬럼 순서는 ``db/catalog_backend.py`` 가 기대하는 순서와 같아야 합니다.
    """

    # (owner, table_name, comment, estimated_rows, match_count, column_count)
    search_tables: str
    # (owner, table_name, column_name, data_type, comment, match_count)
    search_columns: str
    # (owner, table_name, comment). owner 조건이 있는 버전과 없는 버전
    table_meta: str
    table_meta_with_owner: str
    # (owner, table_name, kind, estimated_rows). kind 는 Postgres relkind('r','v','m','p','f'),
    # Oracle 은 테이블만 찾으므로 'r'. 7.7 이 WHERE 없는 조회의 대상 크기를 볼 때 씁니다
    table_rows: str
    # (column_name, data_type, nullable 'Y'/'N', comment)
    columns: str
    # (column_name,)
    primary_key: str
    # (column_name, ref_table, ref_column, constraint_name)
    foreign_keys: str


class SQLDialect(ABC):
    """DB 종류별 SQL 문법 차이를 감싸는 어댑터."""

    #: 설정값(``NL2SQL_DB_DIALECT``)과 같은 이름
    name: str
    #: sqlglot.parse 에 넘길 dialect 이름
    sqlglot_name: str
    #: 카탈로그 식별자 대소문자 규칙 (Oracle 은 대문자, Postgres 는 소문자)
    identifier_case: str = "lower"

    # ── 식별자 ────────────────────────────────────────────────────────────
    def fold_identifier(self, name: str) -> str:
        """따옴표 없는 식별자를 DB 카탈로그 저장 형태로 바꿉니다."""
        return name.upper() if self.identifier_case == "upper" else name.lower()

    # ── 행 수 제한 (7.3) ─────────────────────────────────────────────────
    @property
    @abstractmethod
    def row_limit_patterns(self) -> tuple[re.Pattern[str], ...]:
        """이미 행 수 제한이 있는지 판단할 패턴. 첫 번째 그룹이 행 수면 값 추출에도 씁니다."""

    @property
    @abstractmethod
    def trailing_row_limit_re(self) -> re.Pattern[str]:
        """SQL 맨 끝의 행 수 제한 절 패턴 (분리용)."""

    @abstractmethod
    def render_row_limit(self, n: int) -> str:
        """SQL 끝에 붙일 행 수 제한 절. 예: ``LIMIT 10``."""

    def has_row_limit(self, sql: str) -> bool:
        return any(p.search(sql) for p in self.row_limit_patterns)

    def extract_row_limit(self, sql: str) -> int | None:
        """SQL 에 명시된 행 수 제한 값을 돌려줍니다. 없으면 None."""
        for pattern in self.row_limit_patterns:
            m = pattern.search(sql)
            if m and m.groups() and m.group(1) is not None:
                return int(m.group(1))
        return None

    def apply_row_limit(self, sql: str, n: int) -> str:
        """행 수 제한 절을 SQL 끝에 붙입니다 (끝의 세미콜론 제거)."""
        return f"{sql.rstrip().rstrip(';').rstrip()} {self.render_row_limit(n)}"

    def split_trailing_row_limit(self, sql: str) -> tuple[str, str]:
        """``(본문, 끝의 행 수 제한 절)`` 로 나눕니다. 제한 절이 없으면 두 번째 값은 빈 문자열."""
        stripped = sql.rstrip().rstrip(";").rstrip()
        m = self.trailing_row_limit_re.search(stripped)
        if not m:
            return stripped, ""
        return stripped[: m.start()].rstrip(), m.group(0).strip()

    # ── 날짜 (7.2) ────────────────────────────────────────────────────────
    @property
    @abstractmethod
    def date_literal_patterns(self) -> tuple[re.Pattern[str], ...]:
        """WHERE 절에서 'YYYY-MM-DD' 날짜를 뽑아낼 패턴 (첫 번째 그룹이 날짜 문자열)."""

    @abstractmethod
    def current_date_expr(self) -> str:
        """현재 날짜 식. 예: ``CURRENT_DATE`` / ``SYSDATE``."""

    @abstractmethod
    def months_ago_expr(self, months: int) -> str:
        """현재 시점에서 N개월 전을 나타내는 식."""

    def render_date_literal(self, value: date | datetime) -> str:
        """날짜 리터럴. 두 dialect 모두 ANSI ``DATE 'YYYY-MM-DD'`` 를 지원합니다."""
        return f"DATE '{value.strftime('%Y-%m-%d')}'"

    def extract_dates(self, text: str) -> list[datetime]:
        dates: list[datetime] = []
        for pattern in self.date_literal_patterns:
            for m in pattern.finditer(text):
                try:
                    dates.append(datetime.strptime(m.group(1), "%Y-%m-%d"))
                except ValueError:
                    pass
        return dates

    # ── 차단 목록 (7.5, 7.9) ─────────────────────────────────────────────
    @property
    @abstractmethod
    def forbidden_rules(self) -> tuple[tuple[re.Pattern[str], str], ...]:
        """7.5 금지 구문 (패턴, 라벨). 주석을 지우고 문자열을 비운 코드 텍스트에 적용합니다."""

    @property
    @abstractmethod
    def hint_rules(self) -> tuple[tuple[re.Pattern[str], str], ...]:
        """7.5 위험 힌트 (패턴, 라벨). 힌트는 주석이라 원문 SQL 에 적용합니다."""

    @property
    @abstractmethod
    def system_object_re(self) -> re.Pattern[str]:
        """시스템 카탈로그, 딕셔너리 객체 참조 패턴. 7.9 가 UNION 가지 검사에 다시 씁니다."""

    @property
    @abstractmethod
    def risky_function_re(self) -> re.Pattern[str]:
        """7.9 위험 시스템 함수 패턴 (파일, 네트워크, 세션 조작)."""

    @property
    @abstractmethod
    def risky_function_label(self) -> str:
        """7.9 위험 함수 차단 메시지에 쓸 설명."""

    # ── 카탈로그 (실 DB) ──────────────────────────────────────────────────
    @property
    @abstractmethod
    def catalog(self) -> CatalogQueries: ...

    def explain_rows_sql(self, owner: str, name: str) -> str | None:
        """통계가 없는 뷰의 행 수를 추정할 SQL. 지원하지 않으면 None (그 뷰는 크기를 모름)."""
        return None
