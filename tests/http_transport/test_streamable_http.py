"""Streamable HTTP transport 통합 테스트 (2-C).

서버를 실제 진입점(``python -m <서버>.server --transport http``)으로 빈 포트에 띄우고,
MCP 클라이언트로 ``list_tools`` 와 ``call_tool`` 을 부릅니다. API Key 를 켠 서버와 끈 서버를 함께 띄워
``X-MCP-API-Key`` 미들웨어가 HTTP 경로에 실제로 연결됐는지도 확인해요.

서버 프로세스는 모듈 시작 시 한꺼번에 띄워(병렬 기동) 전체가 몇 초 안에 끝납니다. 기본 ``pytest`` 에
포함되며, 이 파일만 돌리려면 ``make test-http`` 를 쓰세요.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVERS_DIR = REPO_ROOT / "src" / "mcp-servers"
API_KEY = "http-test-key"
ORIGIN = "http://localhost:3000"
STARTUP_TIMEOUT_SEC = 20.0


@dataclass
class RunningServer:
    name: str
    url: str
    api_key: str
    proc: subprocess.Popen


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _spawn(name: str, module: str, api_key: str, tmp: Path) -> RunningServer:
    port = _free_port()
    env = {
        **os.environ,
        # OS 환경 변수가 .env 보다 우선하므로 루트 .env 에 키가 있어도 테스트 값이 쓰입니다
        "MCP_API_KEY": api_key,
        "MCP_CORS_ORIGINS": ORIGIN,
        "STARTER_MCP_PORT": str(port),
        "MOCK_REPO_MCP_PORT": str(port),
        "NL2SQL_MCP_PORT": str(port),
        "NL2SQL_DB_BACKEND": "mock",
        "AUDIT_LOG_PATH": str(tmp / f"{name}-audit.db"),
        "MOCK_REPO_BACKEND_URL": "",
        "PYTHONUNBUFFERED": "1",
    }
    log = open(tmp / f"{name}.log", "w")  # 프로세스가 끝날 때까지 열어 둡니다
    proc = subprocess.Popen(
        [sys.executable, "-m", f"{module}.server", "--transport", "http"],
        cwd=SERVERS_DIR,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    return RunningServer(name, f"http://127.0.0.1:{port}/mcp", api_key, proc)


def _wait_ready(server: RunningServer, tmp: Path) -> None:
    host, port = "127.0.0.1", int(server.url.rsplit(":", 1)[1].split("/")[0])
    deadline = time.monotonic() + STARTUP_TIMEOUT_SEC
    while time.monotonic() < deadline:
        if server.proc.poll() is not None:
            break
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    log = (tmp / f"{server.name}.log").read_text(errors="replace")[-2000:]
    pytest.fail(f"{server.name} HTTP 서버가 {STARTUP_TIMEOUT_SEC}초 안에 뜨지 않았습니다.\n{log}")


@pytest.fixture(scope="module")
def servers(tmp_path_factory) -> Iterator[dict[str, RunningServer]]:
    tmp = tmp_path_factory.mktemp("http-servers")
    specs = {
        "starter": ("starter_mcp", ""),
        "starter-auth": ("starter_mcp", API_KEY),
        "mock-repo-auth": ("mock_repo_mcp", API_KEY),
        "nl2sql": ("nl2sql_mcp", ""),
    }
    running = {name: _spawn(name, module, key, tmp) for name, (module, key) in specs.items()}
    try:
        for server in running.values():
            _wait_ready(server, tmp)
        yield running
    finally:
        for server in running.values():
            server.proc.terminate()
        for server in running.values():
            try:
                server.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.proc.kill()
                server.proc.wait()


def _client(server: RunningServer, api_key: str | None = None) -> Client:
    key = server.api_key if api_key is None else api_key
    headers = {"X-MCP-API-Key": key} if key else None
    return Client(StreamableHttpTransport(url=server.url, headers=headers))


# ── API Key 꺼짐 (MVP 기본값) ───────────────────────────────────────────────


async def test_starter_list_and_call_without_key(servers):
    async with _client(servers["starter"]) as client:
        names = {t.name for t in await client.list_tools()}
        result = await client.call_tool("echo", {"text": "hi"})
    assert {"echo", "add", "current_time"} <= names
    assert "hi" in str(result.data if result.data is not None else result.content)


async def test_starter_advertises_resources_and_prompts_over_http(servers):
    """initialize 응답의 capabilities 에 resources, prompts 가 실리고 실제로 읽힙니다."""
    async with _client(servers["starter"]) as client:
        caps = client.initialize_result.capabilities
        resources = {str(r.uri) for r in await client.list_resources()}
        contents = await client.read_resource("starter://about")
        prompts = {p.name for p in await client.list_prompts()}
    assert caps.resources is not None and caps.prompts is not None and caps.tools is not None
    assert {"starter://about", "starter://logo.png"} <= resources
    assert "starter-mcp" in contents[0].text
    assert {"explain_tool", "code_review_session"} <= prompts


async def test_nl2sql_over_http_mock_backend(servers):
    async with _client(servers["nl2sql"]) as client:
        tools = {t.name: t for t in await client.list_tools()}
        ok = await client.call_tool(
            "run_sql_query", {"sql": "SELECT film_id, title FROM film WHERE film_id < 5"}
        )
        blocked = await client.call_tool(
            "run_sql_query", {"sql": "DELETE FROM film WHERE film_id = 1"}, raise_on_error=False
        )
    assert {"search_tables_schema", "get_table_schema", "run_sql_query"} <= tools.keys()
    assert tools["run_sql_query"].outputSchema is not None
    assert ok.structured_content["row_count"] >= 1
    assert blocked.is_error and "[WRITE_BLOCKED]" in blocked.content[0].text


# ── API Key 켜짐 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("name", ["starter-auth", "mock-repo-auth"])
async def test_valid_key_allows_list_and_call(servers, name):
    server = servers[name]
    async with _client(server) as client:
        tools = await client.list_tools()
        if name == "starter-auth":
            result = await client.call_tool("add", {"a": 2, "b": 3})
            assert "5" in str(result.data if result.data is not None else result.content)
        else:
            result = await client.call_tool("list_repositories", {"limit": 2})
            assert not result.is_error
    assert tools


@pytest.mark.parametrize("key", ["", "wrong-key"])
async def test_missing_or_wrong_key_is_rejected(servers, key):
    try:
        async with _client(servers["starter-auth"], api_key=key) as client:
            await client.list_tools()
    except Exception as e:  # SDK 버전에 따라 httpx.HTTPStatusError 또는 McpError 로 감싸 올립니다
        assert "401" in repr(e) or "Unauthorized" in repr(e) or "API" in repr(e), repr(e)
    else:
        pytest.fail("키 없이 list_tools 가 성공했습니다")


def test_401_body_is_jsonrpc_and_has_cors_headers(servers):
    res = httpx.post(
        servers["mock-repo-auth"].url,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Origin": ORIGIN, "Accept": "application/json, text/event-stream"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["jsonrpc"] == "2.0" and body["error"]["code"] == -32001
    assert res.headers.get("access-control-allow-origin") == ORIGIN


def test_preflight_succeeds_without_key(servers):
    """브라우저 preflight 는 키 없이도 CORS 가 먼저 응답합니다 (CORS 가 바깥 미들웨어)."""
    res = httpx.options(
        servers["starter-auth"].url,
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-mcp-api-key",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN
