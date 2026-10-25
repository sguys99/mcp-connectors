"""scripts/mcp_cli.py 스모크 테스트 (2-C).

입력, 레지스트리 오류는 typer ``CliRunner`` 로 프로세스 안에서 실행합니다. stdio 케이스는 CLI 를
하위 프로세스로 실행해 레지스트리의 starter-mcp, nl2sql-mcp 를 실제로 띄워요(Mock 백엔드, 케이스당
1초 안팎). ``CliRunner`` 의 stderr 는 파일 디스크립터가 없어 stdio transport 를 띄울 수 없습니다.

종료 코드 약속: 정상과 도구 에러(``{"error": {...}}`` 출력)는 0, 연결 실패 같은 실행 오류는 1,
입력과 레지스트리 오류는 2.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from scripts import mcp_cli

runner = CliRunner()
REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _isolated_server_env(monkeypatch, tmp_path):
    """stdio 서버가 OS 환경을 물려받으므로 Mock 백엔드와 임시 감사 DB 를 고정합니다."""
    monkeypatch.setenv("NL2SQL_DB_BACKEND", "mock")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.db"))


def _invoke(*args: str):
    return runner.invoke(mcp_cli.app, list(args))


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    """CLI 를 하위 프로세스로 실행합니다 (``python scripts/mcp_cli.py ...`` 와 같음)."""
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "mcp_cli.py"), *args],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=REPO_ROOT,
        env=dict(os.environ),
    )


def test_list_servers_prints_registry_table():
    res = _invoke("list-servers")
    assert res.exit_code == 0, res.output
    lines = res.stdout.splitlines()
    assert lines[0].split() == ["NAME", "TRANSPORT", "ENDPOINT"]
    names = {line.split()[0] for line in lines[1:]}
    assert {"starter-mcp", "mock-repo-mcp", "nl2sql-mcp", "nl2sql-mcp-http"} <= names
    assert any("streamable_http" in line and "http://localhost:8002/mcp" in line for line in lines)


def test_no_args_shows_help():
    res = _invoke()
    assert "list-servers" in res.output and "call" in res.output


def test_list_tools_stdio():
    res = _run("list-tools", "--server", "starter-mcp")
    assert res.returncode == 0, res.stderr
    assert "- echo:" in res.stdout
    assert "required: text" in res.stdout
    assert "- add:" in res.stdout


def test_call_stdio_echo():
    res = _run("call", "--server", "starter-mcp", "--tool", "echo", "--params", '{"text": "hi"}')
    assert res.returncode == 0, res.stderr
    assert "hi" in res.stdout
    json.loads(res.stdout)  # 출력은 JSON 입니다


def test_call_tool_error_prints_code_and_message():
    params = json.dumps({"sql": "DELETE FROM film WHERE film_id = 1"})
    res = _run("call", "--server", "nl2sql-mcp", "--tool", "run_sql_query", "--params", params)
    assert res.returncode == 0, res.stderr
    body = json.loads(res.stdout)
    assert set(body) == {"error"}
    assert body["error"]["code"] == "WRITE_BLOCKED"
    assert body["error"]["message"].endswith("[WRITE_BLOCKED]")


def test_call_unknown_tool_is_tool_error():
    res = _run("call", "--server", "starter-mcp", "--tool", "no_such_tool", "--params", "{}")
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout)["error"]["code"] == "TOOL_ERROR"


@pytest.mark.parametrize(
    ("params", "hint"), [("{not json", "Invalid JSON"), ("[1, 2]", "must be a JSON object")]
)
def test_call_bad_params_exit_2(params, hint):
    res = _invoke("call", "--server", "starter-mcp", "--tool", "echo", "--params", params)
    assert res.exit_code == 2
    assert hint in res.stderr


def test_unknown_server_exit_2():
    res = _invoke("list-tools", "--server", "no-such-server")
    assert res.exit_code == 2
    assert "Unknown server 'no-such-server'" in res.stderr
    assert "starter-mcp" in res.stderr  # 사용 가능한 이름을 알려 줍니다


def test_missing_required_option_exit_2():
    res = _invoke("call", "--server", "starter-mcp")
    assert res.exit_code == 2


def _closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_unreachable_http_server_exit_1(monkeypatch):
    entry = {
        "name": "dead",
        "transport": "streamable_http",
        "url": f"http://127.0.0.1:{_closed_port()}/mcp",
    }
    monkeypatch.setattr(mcp_cli, "_load_registry", lambda: {"dead": entry})
    res = _invoke("call", "--server", "dead", "--tool", "echo", "--params", "{}")
    assert res.exit_code == 1
    assert res.stdout == ""
    assert res.stderr.strip()  # 예외 이름과 메시지를 stderr 에 한 줄로


@pytest.mark.parametrize(
    ("entry", "hint"),
    [
        ({"name": "x", "transport": "stdio"}, "missing 'command'"),
        ({"name": "x", "transport": "streamable_http"}, "missing 'url'"),
        ({"name": "x", "transport": "carrier-pigeon"}, "Unsupported transport"),
    ],
)
def test_malformed_registry_entry_exit_2(monkeypatch, entry, hint):
    monkeypatch.setattr(mcp_cli, "_load_registry", lambda: {"x": entry})
    res = _invoke("list-tools", "--server", "x")
    assert res.exit_code == 2
    assert hint in res.stderr


def test_missing_registry_file_exit_2(monkeypatch, tmp_path):
    monkeypatch.setattr(mcp_cli, "REGISTRY_PATH", tmp_path / "nope.yaml")
    res = _invoke("list-servers")
    assert res.exit_code == 2
    assert "Registry not found" in res.stderr


@pytest.mark.parametrize("content", ["servers: []", "just a string", "servers: [\n  - a\n  b"])
def test_invalid_registry_exit_2(monkeypatch, tmp_path, content):
    path = tmp_path / "reg.yaml"
    path.write_text(content, encoding="utf-8")
    monkeypatch.setattr(mcp_cli, "REGISTRY_PATH", path)
    res = _invoke("list-servers")
    assert res.exit_code == 2
