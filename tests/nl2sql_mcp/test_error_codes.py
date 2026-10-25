"""에러 코드 정본(nl2sql_mcp/error_codes.py)과 실제 메시지 태그가 어긋나지 않는지 확인합니다."""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from nl2sql_mcp.error_codes import BLOCKED_CODES, ERROR_CODES, FAILURE_CODES
from nl2sql_mcp.guardrails.audit_log import status_for

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = REPO_ROOT / "src" / "mcp-servers" / "nl2sql_mcp"
SCENARIO_DIR = REPO_ROOT / "docs" / "nl2sql-mcp-test-data"
_TAG = re.compile(r"\[([A-Z][A-Z0-9_]{3,})\]")


def _source_tags() -> set[str]:
    tags: set[str] = set()
    for path in PACKAGE_DIR.rglob("*.py"):
        tags.update(_TAG.findall(path.read_text(encoding="utf-8")))
    tags.discard("CODE")  # 독스트링의 "[CODE]" 자리 표시
    return tags


def test_every_message_tag_is_a_known_code():
    assert _source_tags() <= ERROR_CODES


def test_every_known_code_is_raised_somewhere():
    """쓰지 않는 코드가 목록에 남아 있지 않게 합니다."""
    assert ERROR_CODES <= _source_tags()


def test_blocked_and_failure_codes_are_disjoint():
    assert not BLOCKED_CODES & FAILURE_CODES
    assert all(status_for(c) == "blocked" for c in BLOCKED_CODES)
    assert all(status_for(c) == "error" for c in FAILURE_CODES)


def test_scenario_error_codes_are_known():
    """시나리오 YAML 의 error_code 와 error.code 기대값도 정본에 있어야 합니다."""
    unknown: list[str] = []
    for path in sorted(SCENARIO_DIR.glob("*/*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for case in doc.get("tests", []):
            by_backend = (case.get("expected_by_backend") or {}).values()
            expectations = [case.get("expected") or {}, *by_backend]
            for exp in expectations:
                codes = [exp.get("error_code")]
                for chk in exp.get("checks") or []:
                    if chk.get("field") == "error.code":
                        value = chk.get("value")
                        codes.extend(value if isinstance(value, list) else [value])
                unknown += [f"{case['id']}:{c}" for c in codes if c and c not in ERROR_CODES]
    assert unknown == []
