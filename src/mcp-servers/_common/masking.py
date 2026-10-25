"""민감정보(PII) 마스킹 정규식의 정본.

모든 서버는 이 모듈의 :data:`PII_RULES` 와 :func:`mask_pii` 만 씁니다. 서버 안에서 PII 정규식을
따로 정의하지 않아요 (NL2SQL 결과 마스킹도 여기서 가져갑니다).

규칙은 위에서부터 순서대로 적용합니다. 앞 규칙이 바꾼 문자열은 뒤 규칙이 다시 보지 않으므로
더 구체적인 패턴(카드, 주민번호)을 일반적인 패턴(긴 숫자열)보다 앞에 둡니다.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import NamedTuple


class PiiRule(NamedTuple):
    """마스킹 규칙 한 건. ``replacement`` 는 :meth:`re.Pattern.sub` 에 그대로 넘깁니다."""

    name: str
    pattern: re.Pattern[str]
    replacement: str | Callable[[re.Match[str]], str]


# 카드번호: 4-4-4-4 (하이픈, 공백, 붙여 쓰기 모두)
CARD_NUMBER = re.compile(r"\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})\b")
# 주민등록번호: 6-7 (하이픈 생략 허용)
RESIDENT_ID = re.compile(r"\b(\d{6})-?(\d{7})\b")
# 하이픈 없는 10~14자리 숫자열 (Pagila 처럼 붙여 쓴 전화번호 등)
LONG_DIGITS = re.compile(r"(?<!\d)(\d{10,14})(?!\d)")
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# 국내 전화번호: 0으로 시작하는 지역/이동통신 번호, 국번 이후만 가림
PHONE = re.compile(r"\b(0\d{1,2})-?(\d{3,4})-?(\d{4})\b")
# 계좌번호: 3~4 / 3~6 / 5~8 자리 하이픈 구분 (예: 110-123-456789)
ACCOUNT_NUMBER = re.compile(r"\b\d{3,4}-\d{3,6}-\d{5,8}\b")

PII_RULES: tuple[PiiRule, ...] = (
    PiiRule("card_number", CARD_NUMBER, "**** **** **** ****"),
    PiiRule("resident_id", RESIDENT_ID, "******-*******"),
    PiiRule("long_digits", LONG_DIGITS, lambda m: "*" * len(m.group())),
    PiiRule("email", EMAIL, "***@***.***"),
    PiiRule("phone", PHONE, r"\1-****-****"),
    PiiRule("account_number", ACCOUNT_NUMBER, "***-***-***"),
)


def mask_pii(text: str) -> str:
    """텍스트에서 :data:`PII_RULES` 의 패턴을 순서대로 마스킹합니다."""
    for rule in PII_RULES:
        text = rule.pattern.sub(rule.replacement, text)
    return text
