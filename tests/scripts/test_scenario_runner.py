"""범용 시나리오 러너(scripts/scenario_runner.py)와 ``mcp_cli.py test`` 검증.

러너는 클라이언트 팩토리를 받으므로 tool, resource, prompt 는 임시 FastMCP 서버(fixture_server)에
인메모리로 붙여 확인합니다. starter 서버 프리미티브와 무관해요. stdio 로 실제 서버를 띄우는 확인은
마지막의 starter 시나리오 한 건뿐입니다.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import jsonschema
import pytest
import yaml
from fastmcp import Client
from typer.testing import CliRunner

from scripts import mcp_cli, scenario_runner
from scripts.scenario_core import OPS

sys.path.insert(0, str(Path(__file__).parent))
import fixture_server  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "configs" / "schemas" / "scenario.schema.json"
STARTER_SCENARIO = REPO_ROOT / "tests" / "scenarios" / "starter.yaml"
REGISTRY = {"fixture": {"name": "fixture", "transport": "stdio", "command": ["x"]}}
runner = CliRunner()


def _factory(entry, env):
    return Client(fixture_server.mcp)


def _write(tmp_path: Path, text: str, name: str = "s.yaml") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def _run_cli(path: Path, **kw):
    out: list[str] = []
    code = scenario_runner.run_cli(
        path, registry=REGISTRY, client_factory=_factory, echo=out.append, **kw
    )
    return code, "\n".join(out)


PASSING = """
server: fixture
cases:
  - id: add
    tool: add
    params: {a: 2, b: 3}
    expect:
      checks: [{field: result, op: eq, value: 5}]
  - id: about
    resource: fixture://about
    expect:
      checks:
        - {field: "contents[0].mimeType", op: eq, value: text/markdown}
        - {field: "contents[0].text", op: contains, value: fixture}
  - id: template
    resource: fixture://items/7
    expect:
      checks: [{field: "contents[0].text", op: contains, value: '"7"'}]
  - id: greet
    prompt: greet
    arguments: {name: Ann}
    expect:
      checks:
        - {field: messages | length, op: eq, value: 1}
        - {field: "messages[0].content.text", op: contains, value: Ann}
  - id: tool-error
    tool: fail
    params: {code: NOPE}
    expect: {status: error, error_code: NOPE}
  - id: unknown-resource
    resource: fixture://missing
    expect: {status: error, error_code: RESOURCE_ERROR}
  - id: missing-prompt-arg
    prompt: greet
    expect: {status: error, error_code: PROMPT_ERROR}
  - id: multi
    steps:
      - tool: fail
        expect: {status: any}
      - tool: add
        params: {a: 1, b: 1}
        repeat: 2
        expect:
          checks: [{field: result, op: eq, value: 2}]
"""


# ── 로딩과 검증 오류 ───────────────────────────────────────────────────────


def test_starter_scenario_file_loads():
    scn = scenario_runner.load_scenario(STARTER_SCENARIO)
    assert scn.server == "starter-mcp"
    assert any(c.required for c in scn.cases)
    assert {s.kind for c in scn.cases for s in c.steps} == {"tool", "resource", "prompt"}


def test_defaults_and_ids_are_filled(tmp_path):
    path = _write(
        tmp_path,
        "defaults: {timeout: 5, env: {A: 1, B: true}}\n"
        "cases:\n  - tool: add\n  - {id: x, tool: add, env: {A: 2}}\n",
    )
    scn = scenario_runner.load_scenario(path)
    assert scn.timeout == 5.0
    assert [c.id for c in scn.cases] == ["case-1", "x"]
    assert scn.cases[0].env == {"A": "1", "B": "true"}
    assert scn.cases[1].env == {"A": "2", "B": "true"}


@pytest.mark.parametrize(
    ("text", "hint"),
    [
        ("cases: [", "invalid YAML"),
        ("- 1\n- 2\n", "top level must be a mapping"),
        ("name: x\n", "cases: must be a non-empty list"),
        ("cases: []\n", "non-empty list"),
        ("version: 2\ncases: [{tool: a}]\n", "unsupported version 2"),
        ("tests: []\n", "legacy NL2SQL format"),
        ("cases: [{tool: a}]\nbogus: 1\n", "unknown key(s) ['bogus']"),
        ("cases: [{id: a, tool: a, expected: {}}]\n", "cases[0] (id=a): unknown key(s) ['expected']"),
        ("cases: [{id: a}]\n", "exactly one of ['tool', 'resource', 'prompt']"),
        ("cases: [{id: a, tool: t, resource: r://x}]\n", "exactly one of"),
        (
            "cases: [{id: a, resource: r://x, params: {}}]\n",
            "'params' is not allowed on a resource step",
        ),
        ("cases: [{id: a, tool: t, arguments: {}}]\n", "'arguments' is not allowed on a tool step"),
        ("cases: [{id: a, tool: t, steps: [{tool: t}]}]\n", "either 'steps' or inline"),
        ("cases: [{id: a, steps: []}]\n", "'steps' must be a non-empty list"),
        ("cases: [{id: a, steps: [{tool: t, bogus: 1}]}]\n", "cases[0] (id=a).steps[0]"),
        ("cases: [{id: a, tool: t, params: [1]}]\n", "'params' must be a mapping"),
        ("cases: [{id: a, tool: t, repeat: 0}]\n", "'repeat' must be an integer >= 1"),
        ("cases: [{id: a, tool: t, tags: x}]\n", "'tags' must be a list of strings"),
        ("cases: [{id: a, tool: t, required: yes_}]\n", "'required' must be true or false"),
        ("cases: [{id: a, tool: t}, {id: a, tool: t}]\n", "duplicate id 'a'"),
        ("cases: [{id: a, tool: t, expect: {status: maybe}}]\n", "'status' must be one of"),
        ("cases: [{id: a, tool: t, expect: {checks: [{field: x, op: nope}]}}]\n", "unknown op 'nope'"),
        ("cases: [{id: a, tool: t, expect: {checks: [{op: eq}]}}]\n", "'field' is required"),
        ("cases: [{id: a, tool: t, expect: {checks: [{field: x, op: eq, val: 1}]}}]\n", "unknown key"),
        ("defaults: {timeout: 0}\ncases: [{tool: t}]\n", "positive number"),
    ],
)
def test_bad_scenarios_report_clear_errors(tmp_path, text, hint):
    path = _write(tmp_path, text)
    with pytest.raises(scenario_runner.ScenarioFormatError) as exc:
        scenario_runner.load_scenario(path)
    assert hint in str(exc.value)
    assert str(path) in str(exc.value)  # 어느 파일인지 알려 줍니다


def test_missing_file_is_a_format_error(tmp_path):
    with pytest.raises(scenario_runner.ScenarioFormatError, match="file not found"):
        scenario_runner.load_scenario(tmp_path / "nope.yaml")


# ── JSON Schema ───────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def schema():
    data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(data)
    return data


def test_schema_accepts_sample_files(schema):
    for doc in (yaml.safe_load(STARTER_SCENARIO.read_text(encoding="utf-8")), yaml.safe_load(PASSING)):
        jsonschema.validate(doc, schema)


def test_schema_ops_match_engine(schema):
    ops = schema["$defs"]["check"]["properties"]["op"]["enum"]
    assert set(ops) == set(OPS) | {"note"}


@pytest.mark.parametrize(
    "doc",
    [
        {},
        {"cases": []},
        {"cases": [{"id": "a"}]},
        {"cases": [{"tool": "a", "resource": "r://x"}]},
        {"cases": [{"tool": "a", "steps": [{"tool": "a"}]}]},
        {"cases": [{"tool": "a", "expected": {}}]},
        {"cases": [{"tool": "a", "expect": {"checks": [{"field": "x", "op": "nope"}]}}]},
        {"version": 2, "cases": [{"tool": "a"}]},
    ],
)
def test_schema_rejects_bad_documents(schema, doc):
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, schema)


# ── 실행 ───────────────────────────────────────────────────────────────────


def test_passing_scenario_covers_tool_resource_prompt(tmp_path):
    code, out = _run_cli(_write(tmp_path, PASSING))
    assert code == 0, out
    assert "PASS=8 FAIL=0 ERROR=0 SKIP=0" in out


def test_failure_reports_expected_vs_actual_and_exit_1(tmp_path):
    text = (
        "server: fixture\ncases:\n  - id: bad\n    tool: add\n    params: {a: 1, b: 1}\n"
        "    expect: {checks: [{field: result, op: eq, value: 3}]}\n"
    )
    code, out = _run_cli(_write(tmp_path, text))
    assert code == 1
    assert "FAIL" in out and "expected=3 actual=2" in out


def test_error_when_success_expected_and_vice_versa(tmp_path):
    text = (
        "server: fixture\ncases:\n"
        "  - {id: a, tool: fail}\n"
        "  - {id: b, tool: add, params: {a: 1, b: 1}, expect: {status: error}}\n"
    )
    code, out = _run_cli(_write(tmp_path, text))
    assert code == 1
    assert "성공 기대했으나 에러 응답" in out
    assert "에러 기대했으나 성공 응답" in out


def test_timeout_is_a_case_error(tmp_path):
    text = "server: fixture\ncases:\n  - {id: slow, tool: slow, params: {seconds: 5}}\n"
    code, out = _run_cli(_write(tmp_path, text), timeout=0.2)
    assert code == 1
    assert "ERROR" in out and "timeout after 0.2s" in out


def test_connection_failure_is_a_case_error(tmp_path):
    def broken(entry, env):
        raise ConnectionError("refused")

    out: list[str] = []
    path = _write(tmp_path, "server: fixture\ncases:\n  - {id: a, tool: add}\n")
    code = scenario_runner.run_cli(path, registry=REGISTRY, client_factory=broken, echo=out.append)
    assert code == 1
    assert "ConnectionError: refused" in "\n".join(out)


def test_skip_required_and_pass_rate_gate(tmp_path):
    text = """
server: fixture
cases:
  - {id: ok, tool: add, params: {a: 1, b: 1}}
  - {id: skipped, tool: fail, skip: not now}
  - {id: bad, tool: fail}
"""
    path = _write(tmp_path, text)
    code, out = _run_cli(path)
    assert code == 1 and "SKIP=1" in out
    code, out = _run_cli(path, min_pass_rate=50)  # 1/2 = 50%
    assert code == 0, out
    required = text.replace("{id: bad, tool: fail}", "{id: bad, tool: fail, required: true}")
    code, out = _run_cli(_write(tmp_path, required, "r.yaml"), min_pass_rate=50)
    assert code == 1
    assert "Required cases not passing: bad" in out


def test_id_and_tag_filters(tmp_path):
    text = """
server: fixture
cases:
  - {id: a-1, tool: add, params: {a: 1, b: 1}, tags: [smoke]}
  - {id: a-2, tool: fail, tags: [slow]}
  - {id: b-1, tool: fail}
"""
    path = _write(tmp_path, text)
    code, out = _run_cli(path, ids=["a-*"], tags=["smoke"])
    assert code == 0 and "Total 1 cases" in out
    code, out = _run_cli(path, ids=["zzz"])
    assert code == 2 and "No cases matched" in out


def test_jobs_run_cases_concurrently_and_keep_order(tmp_path):
    cases = "".join(f"  - {{id: c{i}, tool: add, params: {{a: {i}, b: 1}}}}\n" for i in range(6))
    code, out = _run_cli(_write(tmp_path, f"server: fixture\ncases:\n{cases}"), jobs=3)
    assert code == 0
    ids = [line.split()[1] for line in out.splitlines() if line.startswith("  PASS")]
    assert ids == [f"c{i}" for i in range(6)]


# ── 입력 오류 (종료 코드 2) ────────────────────────────────────────────────


def test_no_server_and_unknown_server_exit_2(tmp_path):
    path = _write(tmp_path, "cases:\n  - {id: a, tool: add}\n")
    code, out = _run_cli(path)
    assert code == 2 and "pass --server NAME" in out
    code, out = _run_cli(path, server_override="nope")
    assert code == 2 and "unknown server 'nope'" in out and "fixture" in out


def test_server_override_beats_file(tmp_path):
    path = _write(tmp_path, "server: other\ncases:\n  - {id: a, tool: add, params: {a: 1, b: 2}}\n")
    code, out = _run_cli(path, server_override="fixture")
    assert code == 0, out


def test_bad_yaml_runs_nothing_and_exit_2(tmp_path):
    _write(tmp_path, PASSING, "good.yaml")
    _write(tmp_path, "cases: [{id: a, tool: t, expected: 1}]\n", "bad.yaml")
    code, out = _run_cli(tmp_path)
    assert code == 2
    assert "bad.yaml" in out and "unknown key" in out
    assert "PASS" not in out  # 하나라도 틀리면 어떤 케이스도 실행하지 않습니다


def test_empty_directory_exit_2(tmp_path):
    code, out = _run_cli(tmp_path)
    assert code == 2 and "No scenario YAML files" in out


def test_directory_skips_legacy_nl2sql_files(tmp_path):
    _write(tmp_path, PASSING, "good.yaml")
    _write(tmp_path, "meta: {}\ntests: []\n", "legacy.yaml")
    sub = tmp_path / "sub"
    sub.mkdir()
    _write(sub, "server: fixture\ncases:\n  - {id: n, tool: add, params: {a: 1, b: 1}}\n", "nested.yml")
    code, out = _run_cli(tmp_path)
    assert code == 0, out
    assert "legacy.yaml" not in out and "nested.yml" in out


# ── JUnit XML ─────────────────────────────────────────────────────────────


def test_junit_structure_and_messages(tmp_path):
    text = """
server: fixture
cases:
  - {id: ok, name: adds, tool: add, params: {a: 1, b: 1}, tags: [smoke], required: true}
  - {id: bad, tool: add, params: {a: 1, b: 1}, expect: {checks: [{field: result, op: eq, value: 3}]}}
  - {id: boom, tool: slow, params: {seconds: 5}}
  - {id: skipped, tool: add, skip: later}
"""
    junit = tmp_path / "out" / "r.xml"
    code, out = _run_cli(_write(tmp_path, text), junit_path=junit, timeout=0.2)
    assert code == 1 and f"JUnit XML: {junit}" in out

    root = ET.parse(junit).getroot()
    assert root.tag == "testsuites"
    assert (root.get("tests"), root.get("failures"), root.get("errors"), root.get("skipped")) == (
        "4",
        "1",
        "1",
        "1",
    )
    (suite,) = root.findall("testsuite")
    assert suite.get("name").endswith("s.yaml")
    cases = {tc.get("name"): tc for tc in suite.findall("testcase")}
    assert set(cases) == {"ok: adds", "bad", "boom", "skipped"}
    assert cases["ok: adds"].get("classname") == "fixture.s"
    props = {p.get("name"): p.get("value") for p in cases["ok: adds"].iter("property")}
    assert props == {"tags": "smoke", "required": "true"}
    failure = cases["bad"].find("failure")
    assert "expected=3" in failure.get("message") and "actual=2" in failure.get("message")
    assert "timeout" in cases["boom"].find("error").get("message")
    assert cases["skipped"].find("skipped").get("message") == "later"


def test_junit_passing_run_has_no_failures(tmp_path):
    junit = tmp_path / "r.xml"
    code, _ = _run_cli(_write(tmp_path, PASSING), junit_path=junit)
    assert code == 0
    root = ET.parse(junit).getroot()
    assert (root.get("tests"), root.get("failures"), root.get("errors")) == ("8", "0", "0")
    assert not list(root.iter("failure")) and not list(root.iter("error"))


def test_junit_records_load_errors(tmp_path):
    bad = _write(tmp_path, "cases: [{id: a}]\n", "bad.yaml")
    junit = tmp_path / "r.xml"
    code, _ = _run_cli(bad, junit_path=junit)
    assert code == 2
    root = ET.parse(junit).getroot()
    assert root.get("errors") == "1"
    (err,) = root.iter("error")
    assert "exactly one of" in err.get("message")


# ── mcp_cli 명령 (프리미티브 CLI, test) ────────────────────────────────────


@pytest.fixture
def fake_registry(monkeypatch):
    monkeypatch.setattr(mcp_cli, "_load_registry", lambda: REGISTRY)
    monkeypatch.setattr(
        mcp_cli, "_build_client", lambda entry, extra_env=None: Client(fixture_server.mcp)
    )


def _invoke(*args: str):
    return runner.invoke(mcp_cli.app, list(args))


def test_cli_list_resources(fake_registry):
    res = _invoke("list-resources", "--server", "fixture")
    assert res.exit_code == 0, res.output
    assert "- fixture://about: about [text/markdown]" in res.stdout
    assert "- fixture://items/{item_id}: item (template)" in res.stdout


def test_cli_read_resource(fake_registry):
    res = _invoke("read-resource", "--server", "fixture", "--uri", "fixture://about")
    assert res.exit_code == 0, res.output
    body = json.loads(res.stdout)
    assert body["contents"][0]["text"].startswith("# About")


def test_cli_read_unknown_resource_prints_error_json(fake_registry):
    res = _invoke("read-resource", "--server", "fixture", "--uri", "fixture://missing")
    assert res.exit_code == 0, res.output
    assert json.loads(res.stdout)["error"]["code"] == "RESOURCE_ERROR"


def test_cli_list_prompts(fake_registry):
    res = _invoke("list-prompts", "--server", "fixture")
    assert res.exit_code == 0, res.output
    assert "- greet: Greeting prompt." in res.stdout
    assert "arguments: name (required), tone" in res.stdout


def test_cli_get_prompt(fake_registry):
    res = _invoke("get-prompt", "--server", "fixture", "--name", "greet", "--args", '{"name": "Ann"}')
    assert res.exit_code == 0, res.output
    body = json.loads(res.stdout)
    assert body["messages"][0]["role"] == "user"
    assert "Ann" in body["messages"][0]["content"]["text"]


@pytest.mark.parametrize(
    ("args", "hint"), [("{bad", "Invalid JSON in --args"), ("[1]", "must be a JSON object")]
)
def test_cli_get_prompt_bad_args_exit_2(fake_registry, args, hint):
    res = _invoke("get-prompt", "--server", "fixture", "--name", "greet", "--args", args)
    assert res.exit_code == 2 and hint in res.stderr


def test_cli_primitive_commands_unknown_server_exit_2(fake_registry):
    for cmd in (["list-resources"], ["list-prompts"], ["read-resource", "--uri", "x://y"]):
        res = _invoke(*cmd, "--server", "nope")
        assert res.exit_code == 2, cmd
        assert "Unknown server 'nope'" in res.stderr


def test_cli_test_command_exit_codes_and_junit(fake_registry, tmp_path):
    good = _write(tmp_path, PASSING, "good.yaml")
    junit = tmp_path / "j.xml"
    res = _invoke("test", str(good), "--junit", str(junit), "--jobs", "2")
    assert res.exit_code == 0, res.output
    assert "Result: OK" in res.stdout and junit.is_file()

    bad = _write(tmp_path, "server: fixture\ncases:\n  - {id: x, tool: fail}\n", "fail.yaml")
    assert _invoke("test", str(bad)).exit_code == 1
    assert _invoke("test", str(bad), "--server", "nope").exit_code == 2
    assert _invoke("test", str(tmp_path / "missing.yaml")).exit_code == 2


# ── 실제 stdio 서버 (starter) ──────────────────────────────────────────────


def test_starter_scenarios_over_stdio(tmp_path):
    junit = tmp_path / "starter.xml"
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "mcp_cli.py"), "test", str(STARTER_SCENARIO)]
        + ["--junit", str(junit), "--jobs", "3"],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=REPO_ROOT,
        env=dict(os.environ),
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "FAIL=0 ERROR=0" in proc.stdout
    assert ET.parse(junit).getroot().get("failures") == "0"
