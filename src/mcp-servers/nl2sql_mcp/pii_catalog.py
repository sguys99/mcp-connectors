"""테이블 인지형 PII 카탈로그 (가드레일 7.6 의 정본).

PII 여부는 컬럼 이름이 아니라 ``(테이블, 컬럼)`` 쌍으로 판정합니다. 같은 ``first_name`` 이라도
``customer`` 는 고객 개인정보라 막고, ``actor`` 는 영화 출연진이라 그대로 보여 줘요.

조치는 두 가지입니다.

- ``block``: SELECT 목록(집계 함수 안, 서브쿼리, CTE, ``SELECT *`` 포함)에 나오면 실행 전에
  ``PII_COLUMN_BLOCKED`` 로 거부합니다. WHERE, JOIN, ORDER BY 같은 조건절에서 쓰는 것은 허용해요.
- ``mask``: 조회는 허용하고, 결과 값을 앞 1글자만 남기고 가립니다 (예: ``Mike`` → ``M***``).

값 수준 안전망은 따로 있습니다. 카탈로그에 없는 컬럼도 결과 문자열은 ``_common/masking.py`` 의
정규식(이메일, 전화번호, 카드번호 등)으로 한 번 더 가려요.

``PII_CATALOG_RAW`` 환경 변수를 주면 아래 Pagila 기본값을 통째로 바꿉니다. 형식은
``테이블.컬럼:조치`` 를 콤마로 이은 문자열이고 조치를 생략하면 ``block`` 입니다.
예: ``PII_CATALOG_RAW=member.email:block,member.nickname:mask``
"""

from __future__ import annotations

from enum import StrEnum


class PiiAction(StrEnum):
    BLOCK = "block"
    MASK = "mask"


PiiCatalog = dict[tuple[str, str], PiiAction]

_B = PiiAction.BLOCK
_M = PiiAction.MASK

# Pagila 기본 카탈로그. 키는 소문자 (테이블, 컬럼)이며 스키마 이름은 보지 않습니다.
# 판단 기준: 고객 식별/연락 정보와 인증 정보는 block, 업무상 필요할 수 있는 직원 식별 정보와
# 준식별자(우편번호)는 mask. actor 이름(공개 출연진), city/country(지역명)는 PII 가 아닙니다.
PAGILA_PII_CATALOG: PiiCatalog = {
    # 고객: 이름과 이메일로 개인을 바로 식별할 수 있음
    ("customer", "first_name"): _B,
    ("customer", "last_name"): _B,
    ("customer", "email"): _B,
    # 직원: 인증 정보와 사진은 차단, 이름과 로그인 ID 는 업무 조회용으로 마스킹
    ("staff", "email"): _B,
    ("staff", "password"): _B,
    ("staff", "picture"): _B,
    ("staff", "first_name"): _M,
    ("staff", "last_name"): _M,
    ("staff", "username"): _M,
    # 주소: 상세 주소와 전화번호는 차단, 우편번호는 준식별자라 마스킹
    ("address", "address"): _B,
    ("address", "address2"): _B,
    ("address", "phone"): _B,
    ("address", "postal_code"): _M,
    # 뷰: 원본 컬럼을 결합해 노출하므로 원본과 같은 조치
    ("customer_list", "name"): _B,
    ("customer_list", "address"): _B,
    ("customer_list", "phone"): _B,
    ("customer_list", "zip code"): _M,
    ("staff_list", "name"): _M,
    ("staff_list", "address"): _B,
    ("staff_list", "phone"): _B,
    ("staff_list", "zip code"): _M,
    ("sales_by_store", "manager"): _M,
}


def parse_pii_catalog(raw: str) -> PiiCatalog:
    """``테이블.컬럼[:block|mask]`` 콤마 목록을 카탈로그로 바꿉니다. 형식이 틀리면 ValueError."""
    catalog: PiiCatalog = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        target, _, action = item.partition(":")
        table, dot, column = target.strip().rpartition(".")
        if not dot or not table or not column:
            raise ValueError(
                f"PII_CATALOG_RAW entries must use the 'table.column[:block|mask]' format: {item!r}"
            )
        try:
            act = PiiAction((action.strip() or "block").lower())
        except ValueError as e:
            raise ValueError(f"PII action must be either block or mask: {item!r}") from e
        # 스키마 접두사(public.customer.email)는 떼고 테이블 이름만 씁니다
        catalog[(table.rsplit(".", 1)[-1].strip().lower(), column.strip().lower())] = act
    return catalog


def resolve_pii_catalog(raw: str | None) -> PiiCatalog:
    """설정 문자열이 비어 있으면 Pagila 기본 카탈로그를, 아니면 파싱한 카탈로그를 돌려줍니다."""
    if raw and raw.strip():
        return parse_pii_catalog(raw)
    return dict(PAGILA_PII_CATALOG)
