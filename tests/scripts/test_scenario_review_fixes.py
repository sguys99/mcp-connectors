"""코드 리뷰 반영 확인: JUnit 벽시계 시간과 제어 문자, SKIP 된 필수 케이스, 필터 값 안의 파이프."""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from fastmcp import Client

from scripts import scenario_runner
from scripts.scenario_core import MISSING, _get_field, _split_pipes
from scripts.scenario_runner import CaseResult, FileResult

sys.path.insert(0, str(Path(__file__).parent))
import fixture_server  # noqa: E402

REGISTRY = {"fixture": {"name": "fixture", "transport": "stdio", "command": ["x"]}}


def _factory(entry, env):
    return Client(fixture_server.mcp)


def _run_cli(path: Path, **kw):
    out: list[str] = []
    code = scenario_runner.run_cli(
        path, registry=REGISTRY, client_factory=_factory, echo=out.append, **kw
    )
    return code, "\n".join(out)


# ── JUnit time ─────────────────────────────────────────────────────────────


def test_junit_suite_time_is_wall_clock_with_jobs(tmp_path):
    cases = "".join(f"  - {{id: s{i}, tool: slow, params: {{seconds: 0.3}}}}\n" for i in range(4))
    path = tmp_path / "s.yaml"
    path.write_text(f"server: fixture\ncases:\n{cases}", encoding="utf-8")
    junit = tmp_path / "r.xml"
    code, out = _run_cli(path, junit_path=junit, jobs=4)
    assert code == 0, out
    root = ET.parse(junit).getroot()
    suite = root.find("testsuite")
    case_sum = sum(float(tc.get("time")) for tc in suite.iter("testcase"))
    suite_time = float(suite.get("time"))
    assert case_sum >= 1.2
    assert suite_time < case_sum * 0.75  # 동시 실행이라 합보다 확실히 짧아야 합니다
    assert float(root.get("time")) == suite_time


def test_junit_suite_time_falls_back_to_case_sum():
    results = [CaseResult("a", "a", "PASS", duration=0.5), CaseResult("b", "b", "PASS", duration=0.25)]
    root = scenario_runner.build_junit([FileResult(Path("x.yaml"), "srv", results)]).getroot()
    assert root.find("testsuite").get("time") == "0.750"


def test_junit_strips_xml_illegal_control_chars(tmp_path):
    bad = "boom\x00\x01\x08\x0b\x0c\x0e\x1f end\ttab\nline"
    results = [
        CaseResult("f\x07", "name\x02", "FAIL", detail=bad, tags=["t\x03"]),
        CaseResult("e", "e", "ERROR", detail=bad),
        CaseResult("s", "s", "SKIP", detail="why\x1b"),
    ]
    junit = tmp_path / "r.xml"
    scenario_runner.write_junit(junit, [FileResult(Path("x.yaml"), "srv", results, 0.1)])
    root = ET.parse(junit).getroot()  # 제어 문자가 남아 있으면 여기서 ParseError
    failure = root.find(".//failure")
    assert failure.text == "boom������� end\ttab\nline"
    assert "�" in root.find(".//testcase").get("name")
    assert root.find(".//property").get("value") == "t�"
    assert root.find(".//skipped").get("message") == "why�"


def test_junit_load_error_with_control_chars_parses(tmp_path):
    junit = tmp_path / "r.xml"
    scenario_runner.write_junit(junit, [], {"bad.yaml": "line\x00one\nmore"})
    error = ET.parse(junit).getroot().find(".//error")
    assert error.get("message") == "line�one"


# ── SKIP 된 필수 케이스 ────────────────────────────────────────────────────


def test_skipped_required_case_counts_as_required_failed(tmp_path):
    path = tmp_path / "s.yaml"
    path.write_text(
        """
server: fixture
cases:
  - {id: ok, tool: add, params: {a: 1, b: 1}}
  - {id: later, tool: add, params: {a: 1, b: 1}, required: true, skip: not yet}
""",
        encoding="utf-8",
    )
    code, out = _run_cli(path)
    assert code == 1
    assert "Pass rate: 100.0%" in out  # 통과율은 SKIP 을 빼고 계산
    assert "Required cases not passing: later" in out

    summary = scenario_runner.summarize(
        [FileResult(Path("x"), "s", [CaseResult("r", "r", "SKIP", required=True)])], 100.0
    )
    assert summary["required_failed"] == ["r"] and summary["ok"] is False


# ── 필터 값 안의 파이프 ────────────────────────────────────────────────────

DATA = {"items": [{"k": "x|y", "b": 1}, {"k": "x", "b": 2}, {"k": "z", "b": 3}]}


def test_split_pipes_ignores_pipes_in_brackets_and_quotes():
    assert _split_pipes("a[?k=='x|y'].b") == ["a[?k=='x|y'].b"]
    assert _split_pipes('a[?k=="x|y"] | length') == ['a[?k=="x|y"]', "length"]
    assert _split_pipes("items | length") == ["items", "length"]


def test_get_field_filter_value_with_pipe():
    assert _get_field(DATA, "items[?k=='x|y'].b") == 1
    assert _get_field(DATA, "items[?k=='x|y'] | length") == 2  # dict 키 수
    assert _get_field(DATA, "items | length") == 3
    assert _get_field(DATA, "items[?k=='nope|x'].b") is MISSING
