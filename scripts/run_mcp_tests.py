"""NL2SQL MCP YAML 시나리오 러너.

각 YAML 파일의 direct 케이스를 ``scripts/mcp_cli.py call`` (stdio) 로 실행하고 ``expected`` 와 비교해
PASS/FAIL/ERROR/SKIP 을 집계합니다. 결과는 ``docs/nl2sql-mcp-test-data/results/`` 에 저장돼요.

사용법::

  python scripts/run_mcp_tests.py                          # 전체 280케이스 (Mock)
  python scripts/run_mcp_tests.py --dir tools              # tools/ 만
  python scripts/run_mcp_tests.py --file 'docs/nl2sql-mcp-test-data/guardrails/G78_*.yaml'
  python scripts/run_mcp_tests.py --id G78-017 --id 'G74-01*'
  python scripts/run_mcp_tests.py --backend real           # 실 DB (make sample-db-up 선행)

케이스 형식 (기존 키 외에 러너가 읽는 키):

``env``
    서버 프로세스에 줄 환경 변수 (예: ``{GUARDRAIL_TIMEOUT_SEC: "1"}``). CLI 가 OS 환경을 stdio 서버에
    그대로 넘기므로 케이스마다 설정을 바꿔 띄울 수 있습니다.
``input.repeat``
    같은 호출을 N 번 합니다. 판정은 마지막 응답으로 해요.
``input.setup_calls``
    본 호출 전에 차례로 부르는 ``{tool, params}`` 목록 (응답은 판정하지 않음).
``requires: {backend, reason}``
    이 백엔드에서만 의미가 있는 케이스. 다른 백엔드로 돌리면 ``reason`` 과 함께 SKIP 합니다
    (예: Mock 지연으로만 재현하는 타임아웃).
``expected_by_backend: {real: {...}}``
    그 백엔드에서 ``expected`` 대신 쓸 기대값
    (예: 가드레일을 꺼도 실 DB 권한이 ``ACCESS_DENIED`` 로 막음).
``audit_verification``
    ``command`` 를 셸로 실행해 표준 출력에 ``expected`` 문자열이 있는지 봅니다. 감사 DB 는 케이스마다
    새 임시 파일(``AUDIT_LOG_PATH``)이라 다른 케이스의 기록이 섞이지 않아요.

판정 규칙:

* 에러 응답은 CLI 형식 ``{"error": {"code", "message"}}`` (와 예전 ``isError`` 형식) 으로 인식합니다.
* ``error_code`` 는 :mod:`nl2sql_mcp.error_codes` 의 코드여야 합니다. 모르는 코드는 ERROR 로 알려요.
* 에러 케이스도 ``checks`` 를 평가합니다 (``error.code``, ``error.message`` 등).
* ``op: note`` 는 사람이 확인할 항목이라 판정에서 빼고 결과에 ``manual`` 로 남깁니다.
* 통과율이 95% 이상이고 필수 PASS 케이스(:data:`MANDATORY_IDS`)가 모두 PASS 면 exit 0 입니다.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TEST_DATA_DIR = REPO_ROOT / "docs" / "nl2sql-mcp-test-data"
RESULTS_DIR = TEST_DATA_DIR / "results"
CLI_PATH = REPO_ROOT / "scripts" / "mcp_cli.py"


def _load_error_codes() -> frozenset[str]:
    """서버의 에러 코드 정본(nl2sql_mcp/error_codes.py)을 읽습니다. 설정 파일은 읽지 않아요."""
    servers_dir = str(REPO_ROOT / "src" / "mcp-servers")
    if servers_dir not in sys.path:
        sys.path.insert(0, servers_dir)
    from nl2sql_mcp.error_codes import ERROR_CODES

    return ERROR_CODES


ERROR_CODES = _load_error_codes()

PASS_THRESHOLD = 95.0

# 테스트 계획서(docs/nl2sql-mcp-test-plan.md §6.3)의 "반드시 PASS" 케이스
MANDATORY_IDS: tuple[str, ...] = (
    *(f"G71-{i:03d}" for i in range(1, 9)),
    *(f"G76-{i:03d}" for i in range(1, 6)),
    *(f"G77-{i:03d}" for i in range(1, 9)),
    *(f"T14-{i:03d}" for i in range(7, 13)),
)

# 판정 엔진(연산자, 경로, 에러 인식)은 scenario_core 가 공용으로 가집니다.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scenario_core import (  # noqa: E402, F401  (테스트와 기존 호출자를 위해 다시 노출)
    MANUAL_OPS,
    MISSING,
    OPS,
    ScenarioError,
    _check,
    _get_field,
    _is_error,
    _short,
    evaluate_expect,
)
from scenario_core import _extract_error_code as _extract_code  # noqa: E402


def _extract_error_code(data: Any) -> str | None:
    """알려진 에러 코드(:data:`ERROR_CODES`)만 인정하는 NL2SQL 프로파일 판정."""
    return _extract_code(data, ERROR_CODES)


# ── 실행 ───────────────────────────────────────────────────────────────────


@dataclass
class RunConfig:
    backend: str = "mock"
    call_timeout: float = 60.0
    base_env: dict[str, str] = field(default_factory=lambda: dict(os.environ))


@dataclass
class CallOutcome:
    data: Any = None
    problem: str | None = None  # 출력이 없거나 JSON 이 아님 (ERROR)


def _case_env(case: dict, cfg: RunConfig, audit_path: Path) -> dict[str, str]:
    env = dict(cfg.base_env)
    env["NL2SQL_DB_BACKEND"] = cfg.backend
    env["AUDIT_LOG_PATH"] = str(audit_path)
    env["PYTHONIOENCODING"] = "utf-8"
    # audit_verification 의 `python -c` 가 이 러너와 같은 인터프리터(venv)를 쓰도록
    env["PATH"] = os.pathsep.join([str(Path(sys.executable).parent), env.get("PATH", "")])
    for key, value in (case.get("env") or {}).items():
        if isinstance(value, bool):
            value = str(value).lower()
        env[str(key)] = "" if value is None else str(value)
    return env


def _call_cli(server: str, tool: str, params: dict, env: dict[str, str], timeout: float) -> CallOutcome:
    cmd = [
        sys.executable,
        str(CLI_PATH),
        "call",
        "--server",
        server,
        "--tool",
        tool,
        "--params",
        json.dumps(params, ensure_ascii=False),
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, cwd=str(REPO_ROOT), env=env
        )
    except subprocess.TimeoutExpired:
        return CallOutcome(problem=f"실행 타임아웃 ({timeout:.0f}s)")
    raw = proc.stdout.strip()
    if not raw:
        hint = proc.stderr.strip().splitlines()[-1][:200] if proc.stderr.strip() else ""
        return CallOutcome(problem=f"빈 출력 (exit={proc.returncode}, stderr: {hint})")
    try:
        return CallOutcome(data=json.loads(raw))
    except json.JSONDecodeError:
        return CallOutcome(problem=f"JSON 파싱 실패: {raw[:200]}")


def _run_audit_verification(spec: dict, env: dict[str, str]) -> tuple[bool, str]:
    command = spec.get("command")
    expected = spec.get("expected")
    if not command or not expected:
        return False, "audit_verification 에 command 와 expected 가 필요합니다"
    try:
        proc = subprocess.run(
            ["bash", "-c", command],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(REPO_ROOT),
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False, "audit_verification 타임아웃 (60s)"
    if expected in proc.stdout:
        return True, ""
    tail = (proc.stderr.strip().splitlines() or proc.stdout.strip().splitlines() or [""])[-1]
    return False, f"audit_verification 실패 (exit={proc.returncode}): {tail[:200]}"


def _evaluate(case: dict, data: Any) -> tuple[str, str]:
    return evaluate_expect(data, case.get("expected"), ERROR_CODES)


def run_case(case: dict, server: str, cfg: RunConfig) -> dict[str, Any]:
    """케이스 하나를 실행해 결과 dict (id, status, detail, manual) 를 돌려줍니다."""
    result: dict[str, Any] = {
        "id": case.get("id"),
        "title": case.get("title"),
        "category": case.get("category"),
        "call_type": case.get("call_type"),
        "status": "ERROR",
        "detail": "",
        "manual": [
            c.get("value")
            for c in (case.get("expected") or {}).get("checks") or []
            if c.get("op") in MANUAL_OPS
        ],
    }
    if case.get("call_type") == "chat":
        result.update(status="SKIP", detail="chat 케이스는 LLM 이 필요해 수동 실행")
        return result

    requires = case.get("requires") or {}
    if requires.get("backend") and requires["backend"] != cfg.backend:
        reason = requires.get("reason", "")
        result.update(status="SKIP", detail=f"backend={requires['backend']} 전용: {reason}".strip())
        return result
    override = (case.get("expected_by_backend") or {}).get(cfg.backend)
    if override is not None:
        case = {**case, "expected": override}

    inp = case.get("input") or {}
    tool = inp.get("tool")
    if not tool:
        result["detail"] = "input.tool 없음"
        return result

    with tempfile.TemporaryDirectory(prefix="nl2sql-scenario-") as tmp:
        env = _case_env(case, cfg, Path(tmp) / "audit.db")
        try:
            for setup in inp.get("setup_calls") or []:
                outcome = _call_cli(
                    server, setup["tool"], setup.get("params") or {}, env, cfg.call_timeout
                )
                if outcome.problem:
                    result["detail"] = f"setup_calls({setup['tool']}): {outcome.problem}"
                    return result
            outcome = CallOutcome(problem="호출 안 함")
            for _ in range(max(1, int(inp.get("repeat", 1)))):
                outcome = _call_cli(server, tool, inp.get("params") or {}, env, cfg.call_timeout)
                if outcome.problem:
                    break
            if outcome.problem:
                result["detail"] = outcome.problem
                return result

            status, detail = _evaluate(case, outcome.data)
            if status == "PASS" and case.get("audit_verification"):
                ok, why = _run_audit_verification(case["audit_verification"], env)
                if not ok:
                    status, detail = "FAIL", why
        except ScenarioError as e:
            status, detail = "ERROR", str(e)
    result.update(status=status, detail=detail)
    return result


def _select(cases: list[dict], patterns: list[str] | None) -> list[dict]:
    if not patterns:
        return cases
    return [c for c in cases if any(fnmatch.fnmatch(str(c.get("id")), p) for p in patterns)]


def run_file(
    yaml_path: Path, cfg: RunConfig, pool: ThreadPoolExecutor, ids: list[str] | None = None
) -> tuple[dict, list[dict]]:
    with open(yaml_path, encoding="utf-8") as f:
        doc = yaml.safe_load(f)
    meta = doc.get("meta", {})
    server = meta.get("cli_server", "nl2sql-mcp")
    cases = _select(doc.get("tests", []), ids)
    return meta, list(pool.map(lambda c: run_case(c, server, cfg), cases))


# ── 출력 ───────────────────────────────────────────────────────────────────

_ICON = {"PASS": "✅", "FAIL": "❌", "ERROR": "⚠️ ", "SKIP": "⏭️ "}


def _print_file_results(rel_path: str, results: list[dict]) -> None:
    print(f"\n{'=' * 62}")
    print(f"▶ {rel_path}")
    print(f"{'=' * 62}")
    for r in results:
        print(f"  {_ICON.get(r['status'], '? ')} {r['id']:<12} {r['title']}")
        if r["detail"]:
            print(f"             └─ {r['detail']}")
        for note in r.get("manual") or []:
            print(f"             └─ 수동 확인: {note}")
    counts = {k: sum(1 for r in results if r["status"] == k) for k in _ICON}
    print(
        f"\n  소계: PASS={counts['PASS']} FAIL={counts['FAIL']} "
        f"ERROR={counts['ERROR']} SKIP={counts['SKIP']}"
    )


def _summarize(all_results: dict[str, dict], backend: str) -> dict[str, Any]:
    flat = [r for v in all_results.values() for r in v["results"]]
    totals = {k: sum(1 for r in flat if r["status"] == k) for k in _ICON}
    total = len(flat)
    runnable = total - totals["SKIP"]
    pass_rate = totals["PASS"] / runnable * 100 if runnable else 0.0
    by_id = {r["id"]: r["status"] for r in flat}
    mandatory = [i for i in MANDATORY_IDS if i in by_id]
    mandatory_failed = [i for i in mandatory if by_id[i] != "PASS"]
    ok = pass_rate >= PASS_THRESHOLD and not mandatory_failed
    return {
        "backend": backend,
        "total": total,
        "runnable": runnable,
        **totals,
        "pass_rate": round(pass_rate, 1),
        "mandatory_total": len(mandatory),
        "mandatory_pass": len(mandatory) - len(mandatory_failed),
        "mandatory_failed": mandatory_failed,
        "manual_checks": sum(len(r.get("manual") or []) for r in flat),
        "verdict": "PASS" if ok else "FAIL",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NL2SQL MCP YAML 시나리오 러너")
    parser.add_argument("--file", "-f", help="단일 YAML 파일 경로 (glob 가능)")
    parser.add_argument("--dir", "-d", help="서브디렉토리 이름 (tools | guardrails)")
    parser.add_argument("--id", action="append", help="케이스 ID (glob 가능, 여러 번 지정)")
    parser.add_argument("--backend", choices=["mock", "real"], default="mock", help="NL2SQL_DB_BACKEND")
    parser.add_argument("--jobs", "-j", type=int, default=4, help="동시에 실행할 케이스 수 (기본 4)")
    parser.add_argument("--no-save", action="store_true", help="결과 JSON 을 저장하지 않음")
    args = parser.parse_args(argv)

    if args.file:
        p = Path(args.file)
        p = p if p.is_absolute() else Path.cwd() / p
        yaml_files = sorted(p.parent.glob(p.name)) if any(ch in p.name for ch in "*?[") else [p]
    elif args.dir:
        yaml_files = sorted((TEST_DATA_DIR / args.dir).glob("*.yaml"))
    else:
        yaml_files = sorted(TEST_DATA_DIR.rglob("*.yaml"))
    yaml_files = [f for f in yaml_files if f.is_file()]
    if not yaml_files:
        print("테스트 파일을 찾을 수 없습니다.")
        return 1

    cfg = RunConfig(backend=args.backend)
    all_results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for yaml_path in yaml_files:
            rel = str(yaml_path.resolve().relative_to(REPO_ROOT))
            meta, results = run_file(yaml_path, cfg, pool, args.id)
            if not results:
                continue
            all_results[rel] = {"meta": meta, "results": results}
            _print_file_results(rel, results)

    summary = _summarize(all_results, args.backend)
    print(f"\n{'=' * 62}")
    print(
        f"최종 결과 (backend={args.backend})  "
        f"총 {summary['total']}케이스 (SKIP 제외: {summary['runnable']})"
    )
    print(
        f"  PASS={summary['PASS']}  FAIL={summary['FAIL']}  "
        f"ERROR={summary['ERROR']}  SKIP={summary['SKIP']}  수동 확인 항목={summary['manual_checks']}"
    )
    print(f"  PASS율: {summary['pass_rate']:.1f}% (기준 ≥{PASS_THRESHOLD:.0f}%)")
    print(f"  필수 PASS: {summary['mandatory_pass']}/{summary['mandatory_total']}")
    print(f"  판정: {'✅ 합격' if summary['verdict'] == 'PASS' else '❌ 불합격'}")

    failed = [r for v in all_results.values() for r in v["results"] if r["status"] in ("FAIL", "ERROR")]
    if failed:
        print("\n--- FAIL / ERROR 상세 ---")
        for r in failed:
            print(f"  {_ICON[r['status']]} {r['id']:<12} {r['title']}")
            print(f"             └─ {r['detail']}")

    if not args.no_save:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        payload = {"timestamp": ts, "summary": summary, "files": all_results}
        out_path = RESULTS_DIR / f"result_{ts}.json"
        for path in (out_path, RESULTS_DIR / "latest.json"):
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"\n결과 저장: {out_path.relative_to(REPO_ROOT)}")
        print("최신본:    docs/nl2sql-mcp-test-data/results/latest.json")
    print(f"{'=' * 62}")
    return 0 if summary["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
