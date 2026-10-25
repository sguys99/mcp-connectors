"""scripts/run_mcp_tests.py (YAML 시나리오 러너) 판정 로직 검증."""

from __future__ import annotations

import pytest

from scripts import run_mcp_tests as r

CLI_ERROR = {"error": {"code": "WRITE_BLOCKED", "message": "'Delete' 구문은 ... [WRITE_BLOCKED]"}}
SCHEMA = {
    "table_name": "rental",
    "columns": [
        {"name": "rental_id", "nullable": False},
        {"name": "return_date", "nullable": True},
    ],
    "foreign_keys": [{"ref_table": "inventory"}, {"ref_table": "customer"}],
    "tables": [
        {"table_name": "payment", "foreign_keys": [{"ref_table": "rental"}, {"ref_table": "staff"}]},
        {"table_name": "staff", "foreign_keys": [{"ref_table": "store"}]},
    ],
    "explain": {"estimated_cost": 0, "full_scan_tables": []},
}


# ── 에러 응답 인식 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (CLI_ERROR, True),
        ({"error": {"message": "boom"}}, True),
        ({"isError": True}, True),
        ({"content": [{"type": "text", "isError": True}]}, True),
        ([{"isError": True}], True),
        ({"error": "not a dict"}, False),
        ({"rows": [], "row_count": 0}, False),
        ([], False),
    ],
)
def test_is_error(data, expected):
    assert r._is_error(data) is expected


def test_error_code_prefers_structured_code():
    assert r._extract_error_code(CLI_ERROR) == "WRITE_BLOCKED"


def test_error_code_falls_back_to_last_known_tag():
    data = {"isError": True, "content": [{"text": "x [NOT_A_CODE] then [INVALID_SQL]"}]}
    assert r._extract_error_code(data) == "INVALID_SQL"
    assert r._extract_error_code({"isError": True, "content": [{"text": "[NOPE_CODE]"}]}) is None


def test_error_codes_come_from_server_definitions():
    from nl2sql_mcp.error_codes import ERROR_CODES

    assert r.ERROR_CODES == ERROR_CODES
    assert {"INVALID_SQL", "INVALID_INPUT", "TOO_MANY_TABLES", "QUERY_TIMEOUT"} <= r.ERROR_CODES


# ── 경로 ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("table_name", "rental"),
        ("columns | length", 2),
        ("columns[0].name", "rental_id"),
        ("columns[-1].name", "return_date"),
        ("columns[*].name", ["rental_id", "return_date"]),
        ("columns[?name=='return_date'].nullable", True),
        ("tables[?table_name=='payment'].foreign_keys[*].ref_table", ["rental", "staff"]),
        ("explain.estimated_cost", 0),
        ("tables[0].foreign_keys | length", 2),
    ],
)
def test_get_field(path, expected):
    assert r._get_field(SCHEMA, path) == expected


@pytest.mark.parametrize(
    "path", ["missing", "columns[5].name", "columns[?name=='nope'].nullable", "table_name.x"]
)
def test_get_field_missing(path):
    assert r._get_field(SCHEMA, path) is r.MISSING


@pytest.mark.parametrize("path", ["columns[a]", "tables | sum", "a..b"])
def test_get_field_rejects_unknown_syntax(path):
    with pytest.raises(r.ScenarioError):
        r._get_field(SCHEMA, path)


# ── 연산자 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("chk", "ok"),
    [
        ({"field": "columns", "op": "length_eq", "value": 2}, True),
        ({"field": "columns", "op": "length_lte", "value": 1}, False),
        ({"field": "explain.estimated_cost", "op": "exists", "value": True}, True),
        ({"field": "explain.nope", "op": "exists", "value": True}, False),
        ({"field": "explain.nope", "op": "exists", "value": False}, True),
        ({"field": "explain.full_scan_tables", "op": "not_contains", "value": "payment"}, True),
        ({"field": "columns[*].name", "op": "not_contains", "value": "rental_id"}, False),
        ({"field": "missing", "op": "not_contains", "value": "x"}, False),
        ({"field": "table_name", "op": "in", "value": ["rental", "film"]}, True),
        ({"field": "table_name", "op": "in", "value": ["film"]}, False),
        ({"field": "columns[*].name", "op": "contains", "value": "return_date"}, True),
        ({"field": "table_name", "op": "contains", "value": "ent"}, True),
        ({"field": "columns", "op": "contains_field", "value": "return_date"}, True),
        ({"field": "columns", "op": "contains_field", "value": "nope"}, False),
        ({"field": "table_name", "op": "contains_any", "value": ["xx", "ren"]}, True),
        ({"field": "columns[*].name", "op": "contains_all", "value": ["rental_id", "x"]}, False),
        ({"field": "columns | length", "op": "gte", "value": 2}, True),
        ({"field": "missing", "op": "gte", "value": 0}, False),
        ({"field": "missing", "op": "is_null"}, True),
        ({"field": "table_name", "op": "matches_regex", "value": "^ren"}, True),
    ],
)
def test_check_ops(chk, ok):
    assert r._check(SCHEMA, chk) is ok


def test_unknown_op_is_scenario_error():
    with pytest.raises(r.ScenarioError):
        r._check(SCHEMA, {"field": "table_name", "op": "approximately", "value": 1})


# ── 판정 ───────────────────────────────────────────────────────────────────


def _case(**expected):
    return {"id": "X-001", "expected": expected}


def test_error_case_passes_with_matching_code_and_checks():
    case = _case(
        status="error",
        error_code="WRITE_BLOCKED",
        checks=[{"field": "error.message", "op": "contains", "value": "Delete"}],
    )
    assert r._evaluate(case, CLI_ERROR) == ("PASS", "")


def test_error_case_checks_are_evaluated():
    case = _case(
        status="error",
        error_code="WRITE_BLOCKED",
        checks=[{"field": "error.message", "op": "contains", "value": "Insert"}],
    )
    assert r._evaluate(case, CLI_ERROR)[0] == "FAIL"


def test_error_code_mismatch_fails():
    status, detail = r._evaluate(_case(status="error", error_code="PII_COLUMN_BLOCKED"), CLI_ERROR)
    assert status == "FAIL" and "WRITE_BLOCKED" in detail


def test_unknown_expected_code_is_scenario_error():
    with pytest.raises(r.ScenarioError):
        r._evaluate(_case(status="error", error_code="MADE_UP_CODE"), CLI_ERROR)


def test_success_expected_but_error_fails():
    status, detail = r._evaluate(_case(status="success"), CLI_ERROR)
    assert status == "FAIL" and "WRITE_BLOCKED" in detail


def test_note_checks_are_manual_not_failures():
    case = _case(status="success", checks=[{"field": "human_verify", "op": "note", "value": "보기"}])
    assert r._evaluate(case, {"row_count": 1}) == ("PASS", "")


def test_chat_and_backend_specific_cases_skip():
    cfg = r.RunConfig(backend="real")
    assert r.run_case({"id": "C", "call_type": "chat"}, "nl2sql-mcp", cfg)["status"] == "SKIP"
    case = {"id": "M", "call_type": "direct", "requires": {"backend": "mock", "reason": "지연"}}
    result = r.run_case(case, "nl2sql-mcp", cfg)
    assert result["status"] == "SKIP" and "지연" in result["detail"]


def test_case_env_overrides_and_isolates_audit(tmp_path):
    cfg = r.RunConfig(backend="mock", base_env={"PATH": "/usr/bin", "NL2SQL_DB_BACKEND": "real"})
    case = {"env": {"GUARDRAIL_TIMEOUT_SEC": 1, "GUARDRAIL_RISKY_SQL_ENABLED": False}}
    env = r._case_env(case, cfg, tmp_path / "audit.db")
    assert env["NL2SQL_DB_BACKEND"] == "mock"  # --backend 가 OS 환경보다 우선
    assert env["AUDIT_LOG_PATH"] == str(tmp_path / "audit.db")
    assert env["GUARDRAIL_TIMEOUT_SEC"] == "1"
    assert env["GUARDRAIL_RISKY_SQL_ENABLED"] == "false"


def test_summary_counts_mandatory_cases():
    results = {
        "f.yaml": {
            "results": [
                {"id": "G71-001", "status": "PASS"},
                {"id": "G71-002", "status": "FAIL"},
                {"id": "T01-018", "status": "SKIP"},
            ]
        }
    }
    s = r._summarize(results, "mock")
    assert (s["runnable"], s["PASS"], s["pass_rate"]) == (2, 1, 50.0)
    assert s["mandatory_total"] == 2 and s["mandatory_failed"] == ["G71-002"]
    assert s["verdict"] == "FAIL"
    assert len(r.MANDATORY_IDS) == 27


# ── CLI 를 실제로 띄우는 케이스 (Mock, stdio) ─────────────────────────────


def test_run_case_end_to_end_with_env_and_audit():
    """env 로 7.9 를 끄고, 케이스 전용 감사 DB 를 audit_verification 이 읽습니다."""
    case = {
        "id": "E2E-001",
        "call_type": "direct",
        "env": {"GUARDRAIL_RISKY_SQL_ENABLED": "false"},
        "input": {
            "tool": "run_sql_query",
            "params": {"sql": "SELECT customer_id FROM customer WHERE active = 1 UNION SELECT 1"},
            "setup_calls": [{"tool": "search_tables_schema", "params": {"pattern": "FILM%"}}],
        },
        "expected": {"status": "success", "checks": [{"field": "row_count", "op": "gte", "value": 0}]},
        "audit_verification": {
            "command": (
                "python -c \"import os, sqlite3; c = sqlite3.connect(os.environ['AUDIT_LOG_PATH']); "
                "print(sorted(r[0] for r in c.execute('SELECT tool_name FROM audit_log')))\""
            ),
            "expected": "['run_sql_query', 'search_tables_schema']",
        },
    }
    result = r.run_case(case, "nl2sql-mcp", r.RunConfig(backend="mock"))
    assert result["status"] == "PASS", result["detail"]
