"""_common.masking PII 정규식 정본 검증."""

from __future__ import annotations

import pytest

from _common.masking import PII_RULES, mask_pii


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("card 1234-5678-9012-3456 end", "card **** **** **** **** end"),
        ("card 1234 5678 9012 3456", "card **** **** **** ****"),
        ("card 1234567890123456", "card **** **** **** ****"),
        ("rrn 900101-1234567", "rrn ******-*******"),
        ("rrn 9001011234567", "rrn ******-*******"),
        ("tel 28303384290", "tel ***********"),
        ("mail user.name+x@example.co.kr", "mail ***@***.***"),
        ("tel 010-1234-5678", "tel 010-****-****"),
        ("tel 02-123-4567", "tel 02-****-****"),
        ("acct 110-123-456789", "acct ***-***-***"),
    ],
)
def test_mask_pii_patterns(raw, expected):
    assert mask_pii(raw) == expected


@pytest.mark.parametrize(
    "text",
    ["", "no pii here", "customer_id = 42", "2026-10-22", "amount 123456789"],
)
def test_mask_pii_leaves_non_pii(text):
    assert mask_pii(text) == text


def test_rule_names_unique_and_ordered():
    names = [r.name for r in PII_RULES]
    assert len(names) == len(set(names))
    # 구체적인 패턴이 긴 숫자열 규칙보다 먼저 적용돼야 함
    assert names.index("card_number") < names.index("long_digits")
    assert names.index("resident_id") < names.index("long_digits")


def test_nl2sql_output_masking_uses_common_rules():
    """NL2SQL 결과 마스킹이 정본 mask_pii 와 같은 결과를 낸다."""
    from nl2sql_mcp.guardrails.enforce_pii_control import mask_pii_output

    values = ["1234-5678-9012-3456", "a@b.com", "plain", 7]
    rows, masked_columns = mask_pii_output([values], ["card", "mail", "memo", "n"])
    assert rows[0] == [mask_pii(v) if isinstance(v, str) else v for v in values]
    assert masked_columns == ["card", "mail"]
