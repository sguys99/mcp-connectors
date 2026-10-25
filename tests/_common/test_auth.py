"""_common.auth API Key 미들웨어 검증 (미들웨어 단위 + 실제 서버 앱 HTTP 수준)."""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from _common.auth import API_KEY_HEADER, JSONRPC_UNAUTHORIZED_CODE, build_http_middleware

ORIGIN = "http://localhost:3000"
KEY = "secret-key-1"


async def _ok(request):
    return PlainTextResponse("ok")


def _client(api_key: str | None, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("MCP_CORS_ORIGINS", ORIGIN)
    app = Starlette(
        routes=[Route("/mcp", _ok, methods=["GET", "POST"])],
        middleware=build_http_middleware(api_key),
    )
    return TestClient(app)


@pytest.mark.parametrize("api_key", [None, ""])
def test_disabled_when_key_unset(api_key, monkeypatch):
    """키가 None 이나 빈 문자열이면 헤더 없이도 통과 (MVP 기본값)."""
    client = _client(api_key, monkeypatch)
    assert client.post("/mcp").status_code == 200


def test_missing_key_returns_401_jsonrpc_body(monkeypatch):
    client = _client(KEY, monkeypatch)
    res = client.post("/mcp")
    assert res.status_code == 401
    body = res.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] is None
    assert body["error"]["code"] == JSONRPC_UNAUTHORIZED_CODE
    assert API_KEY_HEADER in body["error"]["message"]
    assert res.headers["www-authenticate"] == API_KEY_HEADER


def test_wrong_key_returns_401(monkeypatch):
    client = _client(KEY, monkeypatch)
    res = client.post("/mcp", headers={API_KEY_HEADER: "wrong-key"})
    assert res.status_code == 401
    assert "value is invalid" in res.json()["error"]["message"]


def test_correct_key_returns_200(monkeypatch):
    client = _client(KEY, monkeypatch)
    assert client.post("/mcp", headers={API_KEY_HEADER: KEY}).status_code == 200


def test_header_name_is_case_insensitive(monkeypatch):
    client = _client(KEY, monkeypatch)
    assert client.get("/mcp", headers={"x-mcp-api-key": KEY}).status_code == 200


def test_cors_preflight_passes_without_key(monkeypatch):
    """브라우저 preflight 는 사용자 헤더를 싣지 않으므로 키 없이 통과해야 한다."""
    client = _client(KEY, monkeypatch)
    res = client.options(
        "/mcp",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-mcp-api-key",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN
    assert "x-mcp-api-key" in res.headers["access-control-allow-headers"].lower()


def test_401_carries_cors_headers(monkeypatch):
    """CORS 가 바깥 미들웨어라 401 에도 Allow-Origin 이 붙어 브라우저가 본문을 읽을 수 있다."""
    client = _client(KEY, monkeypatch)
    res = client.post("/mcp", headers={"Origin": ORIGIN})
    assert res.status_code == 401
    assert res.headers["access-control-allow-origin"] == ORIGIN


# ── 실제 서버 앱 (starter-mcp Streamable HTTP) ────────────────────────────────

_INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0"},
    },
}
_MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def _starter_http_client(api_key: str | None) -> TestClient:
    from starter_mcp.server import mcp

    return TestClient(mcp.http_app(middleware=build_http_middleware(api_key)))


def test_starter_http_rejects_without_key():
    with _starter_http_client(KEY) as client:
        res = client.post("/mcp", json=_INIT, headers=_MCP_HEADERS)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == JSONRPC_UNAUTHORIZED_CODE


def test_starter_http_initializes_with_key():
    with _starter_http_client(KEY) as client:
        res = client.post("/mcp", json=_INIT, headers={**_MCP_HEADERS, API_KEY_HEADER: KEY})
    assert res.status_code == 200
    assert "mcp-session-id" in res.headers


def test_starter_http_open_when_disabled():
    with _starter_http_client(None) as client:
        res = client.post("/mcp", json=_INIT, headers=_MCP_HEADERS)
    assert res.status_code == 200
