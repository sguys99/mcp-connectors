"""범용 MCP 시나리오 러너 (``mcp_cli.py test``).

시나리오 YAML (형식은 ``docs/scenario-format.md``, JSON Schema 는
``configs/schemas/scenario.schema.json``) 을 읽어 레지스트리의 서버(stdio, Streamable HTTP)에
tool, resource, prompt 호출을 보내고 ``expect`` 와 비교합니다. 판정은 :mod:`scenario_core` 가 하고,
여기서는 파일 검증, 실행, 집계, JUnit XML 출력을 맡아요.

종료 코드: 0 합격, 1 실패(케이스 FAIL, ERROR, 필수 케이스 미통과, 통과율 미달), 2 입력 오류.
필수(``required: true``) 케이스는 PASS 만 통과로 칩니다. 그래서 ``skip`` 으로 SKIP 된 필수 케이스도
``required_failed`` 에 들어가 종료 코드 1 이 됩니다 (통과율 계산에서는 SKIP 을 빼지만, 필수 판정은 별개).
"""

from __future__ import annotations

import asyncio
import fnmatch
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcp_ops  # noqa: E402
from scenario_core import MANUAL_OPS, OPS, ScenarioError, evaluate_expect  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TIMEOUT = 60.0
SCENARIO_VERSION = 1
STEP_KINDS = ("tool", "resource", "prompt")

TOP_KEYS = {"version", "name", "description", "server", "defaults", "cases"}
DEFAULTS_KEYS = {"timeout", "env"}
CASE_KEYS = {"id", "name", "tags", "required", "skip", "env", "steps", "expect", "repeat"} | {
    "tool",
    "params",
    "resource",
    "prompt",
    "arguments",
}
STEP_KEYS = {"tool", "params", "resource", "prompt", "arguments", "expect", "repeat"}
EXPECT_KEYS = {"status", "error_code", "checks"}
EXPECT_STATUSES = ("success", "error", "any")
CHECK_KEYS = {"field", "op", "value"}

ClientFactory = Callable[[dict[str, Any], dict[str, str] | None], Any]


class ScenarioFormatError(Exception):
    """시나리오 YAML 이 형식을 어길 때. 메시지에 파일과 위치를 담습니다."""


# ── 모델 ───────────────────────────────────────────────────────────────────


@dataclass
class Step:
    kind: str  # tool | resource | prompt
    target: str  # 도구 이름, 리소스 URI, 프롬프트 이름
    args: dict[str, Any] = field(default_factory=dict)
    expect: dict[str, Any] = field(default_factory=dict)
    repeat: int = 1


@dataclass
class Case:
    id: str
    name: str
    steps: list[Step]
    tags: list[str] = field(default_factory=list)
    required: bool = False
    skip: str | None = None
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class Scenario:
    path: Path
    name: str
    server: str | None
    cases: list[Case]
    timeout: float = DEFAULT_TIMEOUT


@dataclass
class CaseResult:
    id: str
    name: str
    status: str  # PASS | FAIL | ERROR | SKIP
    detail: str = ""
    duration: float = 0.0
    tags: list[str] = field(default_factory=list)
    required: bool = False


@dataclass
class FileResult:
    path: Path
    server: str
    results: list[CaseResult]
    # 파일 실행의 벽시계 시간(초). --jobs > 1 이면 케이스 시간의 합보다 짧습니다. None 이면 합을 씁니다
    elapsed: float | None = None


# ── 로딩과 검증 ────────────────────────────────────────────────────────────


def _fail(where: str, message: str) -> ScenarioFormatError:
    return ScenarioFormatError(f"{where}: {message}")


def _check_keys(obj: dict[str, Any], allowed: set[str], where: str) -> None:
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise _fail(where, f"unknown key(s) {unknown}; allowed: {sorted(allowed)}")


def _as_str_env(raw: Any, where: str) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _fail(where, "'env' must be a mapping")
    env: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(value, bool):
            value = str(value).lower()
        env[str(key)] = "" if value is None else str(value)
    return env


def _parse_expect(raw: Any, where: str) -> dict[str, Any]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _fail(where, "'expect' must be a mapping")
    _check_keys(raw, EXPECT_KEYS, f"{where}.expect")
    status = raw.get("status", "success")
    if status not in EXPECT_STATUSES:
        raise _fail(
            f"{where}.expect", f"'status' must be one of {list(EXPECT_STATUSES)}, got {status!r}"
        )
    if "error_code" in raw and not isinstance(raw["error_code"], str):
        raise _fail(f"{where}.expect", "'error_code' must be a string")
    checks = raw.get("checks", [])
    if not isinstance(checks, list):
        raise _fail(f"{where}.expect", "'checks' must be a list")
    for i, chk in enumerate(checks):
        cw = f"{where}.expect.checks[{i}]"
        if not isinstance(chk, dict):
            raise _fail(cw, "each check must be a mapping with field, op, value")
        _check_keys(chk, CHECK_KEYS, cw)
        if "op" not in chk:
            raise _fail(cw, "missing 'op'")
        if chk["op"] not in OPS and chk["op"] not in MANUAL_OPS:
            raise _fail(cw, f"unknown op {chk['op']!r}; allowed: {sorted(OPS) + sorted(MANUAL_OPS)}")
        if chk["op"] not in MANUAL_OPS and not isinstance(chk.get("field"), str):
            raise _fail(cw, "'field' is required and must be a string")
    return raw


def _parse_step(raw: dict[str, Any], where: str) -> Step:
    kinds = [k for k in STEP_KINDS if k in raw]
    if len(kinds) != 1:
        raise _fail(where, f"exactly one of {list(STEP_KINDS)} is required, got {kinds or 'none'}")
    kind = kinds[0]
    target = raw[kind]
    if not isinstance(target, str) or not target:
        raise _fail(where, f"'{kind}' must be a non-empty string")
    arg_key = {"tool": "params", "resource": None, "prompt": "arguments"}[kind]
    for other in ("params", "arguments"):
        if other in raw and other != arg_key:
            raise _fail(where, f"'{other}' is not allowed on a {kind} step")
    args = raw.get(arg_key) if arg_key else None
    if args is not None and not isinstance(args, dict):
        raise _fail(where, f"'{arg_key}' must be a mapping")
    repeat = raw.get("repeat", 1)
    if isinstance(repeat, bool) or not isinstance(repeat, int) or repeat < 1:
        raise _fail(where, "'repeat' must be an integer >= 1")
    return Step(kind, target, dict(args or {}), _parse_expect(raw.get("expect"), where), repeat)


def _parse_case(raw: Any, index: int, default_env: dict[str, str]) -> Case:
    where = f"cases[{index}]"
    if not isinstance(raw, dict):
        raise _fail(where, "each case must be a mapping")
    case_id = raw.get("id", f"case-{index + 1}")
    if not isinstance(case_id, str) or not case_id:
        raise _fail(where, "'id' must be a non-empty string")
    where = f"cases[{index}] (id={case_id})"
    _check_keys(raw, CASE_KEYS, where)

    inline = {k: raw[k] for k in STEP_KEYS if k in raw}
    if "steps" in raw and inline:
        raise _fail(where, f"use either 'steps' or inline step keys, not both: {sorted(inline)}")
    if "steps" in raw:
        steps_raw = raw["steps"]
        if not isinstance(steps_raw, list) or not steps_raw:
            raise _fail(where, "'steps' must be a non-empty list")
        steps = []
        for j, step_raw in enumerate(steps_raw):
            if not isinstance(step_raw, dict):
                raise _fail(f"{where}.steps[{j}]", "each step must be a mapping")
            _check_keys(step_raw, STEP_KEYS, f"{where}.steps[{j}]")
            steps.append(_parse_step(step_raw, f"{where}.steps[{j}]"))
    else:
        steps = [_parse_step(inline, where)]

    tags = raw.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise _fail(where, "'tags' must be a list of strings")
    required = raw.get("required", False)
    if not isinstance(required, bool):
        raise _fail(where, "'required' must be true or false")
    skip = raw.get("skip")
    if skip is True:
        skip = "skipped"
    elif skip is False or skip is None:
        skip = None
    elif not isinstance(skip, str):
        raise _fail(where, "'skip' must be a reason string or true")
    name = raw.get("name", case_id)
    if not isinstance(name, str):
        raise _fail(where, "'name' must be a string")
    env = {**default_env, **_as_str_env(raw.get("env"), where)}
    return Case(case_id, name, steps, list(tags), required, skip, env)


def load_scenario(path: Path) -> Scenario:
    """YAML 한 개를 읽어 검증한 :class:`Scenario` 로 만듭니다. 틀리면 :class:`ScenarioFormatError`."""
    label = str(path)
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ScenarioFormatError(f"{label}: file not found") from None
    except yaml.YAMLError as e:
        raise ScenarioFormatError(f"{label}: invalid YAML: {e}") from None
    if not isinstance(doc, dict):
        raise ScenarioFormatError(f"{label}: top level must be a mapping with a 'cases' list")
    try:
        if "tests" in doc and "cases" not in doc:
            raise _fail(
                "top level", "legacy NL2SQL format ('tests'); run it with scripts/run_mcp_tests.py"
            )
        _check_keys(doc, TOP_KEYS, "top level")
        version = doc.get("version", SCENARIO_VERSION)
        if version != SCENARIO_VERSION:
            raise _fail("version", f"unsupported version {version!r} (supported: {SCENARIO_VERSION})")
        server = doc.get("server")
        if server is not None and not isinstance(server, str):
            raise _fail("server", "must be a string")
        defaults = doc.get("defaults") or {}
        if not isinstance(defaults, dict):
            raise _fail("defaults", "must be a mapping")
        _check_keys(defaults, DEFAULTS_KEYS, "defaults")
        timeout = defaults.get("timeout", DEFAULT_TIMEOUT)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise _fail("defaults", "'timeout' must be a positive number of seconds")
        default_env = _as_str_env(defaults.get("env"), "defaults")
        cases_raw = doc.get("cases")
        if not isinstance(cases_raw, list) or not cases_raw:
            raise _fail("cases", "must be a non-empty list")
        cases = [_parse_case(raw, i, default_env) for i, raw in enumerate(cases_raw)]
        seen: set[str] = set()
        for c in cases:
            if c.id in seen:
                raise _fail("cases", f"duplicate id {c.id!r}")
            seen.add(c.id)
        name = doc.get("name", path.stem)
        if not isinstance(name, str):
            raise _fail("name", "must be a string")
    except ScenarioFormatError as e:
        raise ScenarioFormatError(f"{label}: {e}") from None
    return Scenario(path, name, server, cases, float(timeout))


def collect_files(path: Path) -> list[Path]:
    """파일이면 그대로, 디렉터리면 아래의 ``*.yaml`` / ``*.yml`` 을 이름순으로 모읍니다."""
    if path.is_dir():
        files = sorted([*path.rglob("*.yaml"), *path.rglob("*.yml")])
        # 예전 NL2SQL 형식(tests:)은 이 러너 대상이 아니라 디렉터리 실행에서는 조용히 건너뜁니다
        return [f for f in files if _is_generic(f)]
    return [path]


def _is_generic(path: Path) -> bool:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return True  # 깨진 파일은 숨기지 않고 로딩 단계에서 오류로 알립니다
    return not (isinstance(doc, dict) and "tests" in doc and "cases" not in doc)


# ── 실행 ───────────────────────────────────────────────────────────────────


def _select(cases: list[Case], ids: list[str], tags: list[str]) -> list[Case]:
    selected = cases
    if ids:
        selected = [c for c in selected if any(fnmatch.fnmatch(c.id, p) for p in ids)]
    if tags:
        selected = [c for c in selected if set(tags) & set(c.tags)]
    return selected


async def _run_step(client: Any, step: Step) -> Any:
    data: Any = None
    for _ in range(step.repeat):  # 판정은 마지막 응답으로 합니다
        if step.kind == "tool":
            data = await mcp_ops.call_tool(client, step.target, step.args)
        elif step.kind == "resource":
            data = await mcp_ops.read_resource(client, step.target)
        else:
            data = await mcp_ops.get_prompt(client, step.target, step.args)
    return data


async def _run_steps(case: Case, entry: dict[str, Any], factory: ClientFactory) -> tuple[str, str]:
    client = factory(entry, case.env or None)
    async with client:
        for i, step in enumerate(case.steps):
            data = await _run_step(client, step)
            status, detail = evaluate_expect(data, step.expect)
            if status != "PASS":
                label = (
                    f"step {i + 1} ({step.kind} {step.target})" if len(case.steps) > 1 else step.target
                )
                return status, f"{label}: {detail}"
    return "PASS", ""


async def run_case(
    case: Case, entry: dict[str, Any], factory: ClientFactory, timeout: float
) -> CaseResult:
    result = CaseResult(case.id, case.name, "ERROR", tags=case.tags, required=case.required)
    if case.skip:
        result.status, result.detail = "SKIP", case.skip
        return result
    started = time.perf_counter()
    try:
        result.status, result.detail = await asyncio.wait_for(_run_steps(case, entry, factory), timeout)
    except TimeoutError:
        result.detail = f"timeout after {timeout:g}s"
    except ScenarioError as e:
        result.detail = str(e)
    except Exception as e:  # noqa: BLE001  (연결 실패 등은 케이스 ERROR 로 남기고 다음으로 갑니다)
        result.detail = f"{type(e).__name__}: {e}"
    result.duration = time.perf_counter() - started
    return result


async def run_scenario(
    scenario: Scenario,
    entry: dict[str, Any],
    factory: ClientFactory,
    *,
    ids: list[str] | None = None,
    tags: list[str] | None = None,
    timeout: float | None = None,
    jobs: int = 1,
) -> list[CaseResult]:
    cases = _select(scenario.cases, ids or [], tags or [])
    limit = timeout if timeout is not None else scenario.timeout
    gate = asyncio.Semaphore(max(1, jobs))

    async def guarded(case: Case) -> CaseResult:
        async with gate:
            return await run_case(case, entry, factory, limit)

    return list(await asyncio.gather(*(guarded(c) for c in cases)))


# ── 집계와 출력 ────────────────────────────────────────────────────────────


def summarize(files: list[FileResult], min_pass_rate: float) -> dict[str, Any]:
    """집계. ``ok`` 가 거짓이면 종료 코드 1 입니다.

    통과율은 SKIP 을 뺀 케이스 기준이지만, ``required_failed`` 는 PASS 가 아닌 모든 필수 케이스라
    SKIP 된 필수 케이스도 실패로 셉니다.
    """
    flat = [r for f in files for r in f.results]
    counts = {k: sum(1 for r in flat if r.status == k) for k in ("PASS", "FAIL", "ERROR", "SKIP")}
    runnable = len(flat) - counts["SKIP"]
    rate = counts["PASS"] / runnable * 100 if runnable else 100.0
    required_failed = [r.id for r in flat if r.required and r.status != "PASS"]
    # 통과율 기준이 100 미만이어도 필수 케이스는 반드시 통과해야 합니다
    ok = rate >= min_pass_rate and not required_failed
    return {
        "total": len(flat),
        "runnable": runnable,
        **counts,
        "pass_rate": round(rate, 1),
        "required_failed": required_failed,
        "ok": ok,
    }


def render_report(files: list[FileResult], summary: dict[str, Any], min_pass_rate: float) -> list[str]:
    lines: list[str] = []
    for f in files:
        lines.append(f"\n{f.path}  (server: {f.server})")
        for r in f.results:
            mark = "[req] " if r.required else ""
            lines.append(f"  {r.status:<5} {mark}{r.id:<20} {r.name}")
            if r.detail:
                lines.append(f"        {r.detail}")
    lines.append("")
    lines.append(
        f"Total {summary['total']} cases: PASS={summary['PASS']} FAIL={summary['FAIL']} "
        f"ERROR={summary['ERROR']} SKIP={summary['SKIP']}"
    )
    lines.append(f"Pass rate: {summary['pass_rate']:.1f}% (required >= {min_pass_rate:g}%)")
    if summary["required_failed"]:
        lines.append(f"Required cases not passing: {', '.join(summary['required_failed'])}")
    lines.append(f"Result: {'OK' if summary['ok'] else 'FAILED'}")
    return lines


def build_junit(files: list[FileResult], load_errors: dict[str, str] | None = None) -> ET.ElementTree:
    """JUnit XML. 파일마다 testsuite, 케이스마다 testcase 이고 FAIL 은 failure, ERROR 는 error 입니다."""
    root = ET.Element("testsuites", name="mcp-scenarios")
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    total_time = 0.0

    def add_suite(
        name: str, cases: list[tuple[str, str, CaseResult | None, str]], wall: float | None = None
    ) -> None:
        nonlocal total_time
        suite = ET.SubElement(root, "testsuite", name=name)
        counts = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
        elapsed = 0.0
        for classname, case_name, r, load_error in cases:
            tc = ET.SubElement(suite, "testcase", classname=classname, name=case_name)
            counts["tests"] += 1
            if r is None:
                ET.SubElement(
                    tc, "error", message=load_error.splitlines()[0], type="ScenarioFormatError"
                ).text = load_error
                counts["errors"] += 1
                continue
            tc.set("time", f"{r.duration:.3f}")
            elapsed += r.duration
            if r.tags or r.required:
                props = ET.SubElement(tc, "properties")
                if r.tags:
                    ET.SubElement(props, "property", name="tags", value=",".join(r.tags))
                if r.required:
                    ET.SubElement(props, "property", name="required", value="true")
            if r.status == "FAIL":
                counts["failures"] += 1
                ET.SubElement(
                    tc,
                    "failure",
                    message=r.detail.splitlines()[0] if r.detail else "failed",
                    type="AssertionError",
                ).text = r.detail
            elif r.status == "ERROR":
                counts["errors"] += 1
                ET.SubElement(
                    tc,
                    "error",
                    message=r.detail.splitlines()[0] if r.detail else "error",
                    type="ScenarioError",
                ).text = r.detail
            elif r.status == "SKIP":
                counts["skipped"] += 1
                ET.SubElement(tc, "skipped", message=r.detail)
        suite.set("tests", str(counts["tests"]))
        suite.set("failures", str(counts["failures"]))
        suite.set("errors", str(counts["errors"]))
        suite.set("skipped", str(counts["skipped"]))
        if wall is not None:
            elapsed = wall
        suite.set("time", f"{elapsed:.3f}")
        for key, value in counts.items():
            totals[key] += value
        total_time += elapsed

    for f in files:
        rel = _display_path(f.path)
        classname = f"{f.server}.{f.path.stem}"
        add_suite(rel, [(classname, _case_label(r), r, "") for r in f.results], f.elapsed)
    for file_name, message in (load_errors or {}).items():
        add_suite(file_name, [("scenario", "load", None, message)])

    for key, value in totals.items():
        root.set(key, str(value))
    root.set("time", f"{total_time:.3f}")
    _sanitize_tree(root)
    tree = ET.ElementTree(root)
    ET.indent(tree)
    return tree


# XML 1.0 이 허용하지 않는 문자 (탭, 줄바꿈, 캐리지 리턴은 허용)
_XML_ILLEGAL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


def _xml_safe(text: str) -> str:
    """XML 에 쓸 수 없는 제어 문자를 U+FFFD 로 바꿉니다 (서버 응답이 섞인 메시지 보호)."""
    return _XML_ILLEGAL_RE.sub("\ufffd", text)


def _sanitize_tree(root: ET.Element) -> None:
    for el in root.iter():
        if el.text:
            el.text = _xml_safe(el.text)
        for key, value in el.attrib.items():
            el.set(key, _xml_safe(value))


def _case_label(r: CaseResult) -> str:
    return r.id if r.name == r.id else f"{r.id}: {r.name}"


def _display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def write_junit(path: Path, files: list[FileResult], load_errors: dict[str, str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    build_junit(files, load_errors).write(path, encoding="utf-8", xml_declaration=True)


# ── 진입점 ─────────────────────────────────────────────────────────────────


def run_cli(
    path: Path,
    *,
    registry: dict[str, dict[str, Any]],
    client_factory: ClientFactory,
    server_override: str | None = None,
    junit_path: Path | None = None,
    ids: list[str] | None = None,
    tags: list[str] | None = None,
    min_pass_rate: float = 100.0,
    timeout: float | None = None,
    jobs: int = 1,
    echo: Callable[[str], Any] = print,
) -> int:
    """``mcp_cli.py test`` 본체. 종료 코드를 돌려줍니다 (0 합격, 1 실패, 2 입력 오류)."""
    files = collect_files(path)
    if not files:
        echo(f"No scenario YAML files found in {path}")
        return 2

    scenarios: list[Scenario] = []
    load_errors: dict[str, str] = {}
    for f in files:
        try:
            scenarios.append(load_scenario(f))
        except ScenarioFormatError as e:
            load_errors[_display_path(f)] = str(e)
    if load_errors:
        for message in load_errors.values():
            echo(message)
        if junit_path:
            write_junit(junit_path, [], load_errors)
        return 2

    # 서버를 모두 확인한 뒤에 실행해서, 오타 하나 때문에 일부만 돌고 끝나는 일을 막습니다
    plan: list[tuple[Scenario, str, dict[str, Any]]] = []
    for scn in scenarios:
        name = server_override or scn.server
        if not name:
            echo(f"{scn.path}: no 'server' in the file; pass --server NAME")
            return 2
        if name not in registry:
            echo(f"{scn.path}: unknown server '{name}'. Available: {', '.join(registry)}")
            return 2
        plan.append((scn, name, registry[name]))

    results: list[FileResult] = []
    for scn, name, entry in plan:
        started = time.perf_counter()
        case_results = asyncio.run(
            run_scenario(scn, entry, client_factory, ids=ids, tags=tags, timeout=timeout, jobs=jobs)
        )
        if case_results:
            results.append(FileResult(scn.path, name, case_results, time.perf_counter() - started))

    if not results:
        echo("No cases matched the --id / --tag filters")
        return 2

    summary = summarize(results, min_pass_rate)
    for line in render_report(results, summary, min_pass_rate):
        echo(line)
    if junit_path:
        write_junit(junit_path, results)
        echo(f"JUnit XML: {junit_path}")
    return 0 if summary["ok"] else 1
