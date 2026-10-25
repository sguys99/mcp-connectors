"""_common.cors 검증: 허용 origin 해석과 preflight, 노출 헤더."""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from _common.cors import build_cors_middleware, get_cors_origins


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_default_origin_when_unset(raw, monkeypatch):
    if raw is None:
        monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("MCP_CORS_ORIGINS", raw)
    # 개발자의 실제 루트 .env 를 읽지 않도록 빈 파일 목록을 준다
    assert get_cors_origins(env_file=()) == ["http://localhost:3000"]


def test_origins_are_split_and_trimmed(monkeypatch):
    monkeypatch.setenv("MCP_CORS_ORIGINS", " http://a.test , ,http://b.test:8080 ")
    assert get_cors_origins(env_file=()) == ["http://a.test", "http://b.test:8080"]


def test_reads_root_env_file_when_process_env_is_unset(tmp_path, monkeypatch):
    """호스트 실행: 루트 .env 의 값이 반영된다 (예전에는 os.environ 만 읽어 무시됐다)."""
    monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    root = tmp_path / ".env"
    root.write_text("MCP_CORS_ORIGINS=http://from-dotenv.test,http://second.test\n", encoding="utf-8")
    assert get_cors_origins(env_file=(root,)) == ["http://from-dotenv.test", "http://second.test"]


def test_package_env_overrides_root_and_process_env_wins(tmp_path, monkeypatch):
    monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    root = tmp_path / "root.env"
    pkg = tmp_path / "pkg.env"
    root.write_text("MCP_CORS_ORIGINS=http://root.test\n", encoding="utf-8")
    pkg.write_text("MCP_CORS_ORIGINS=http://package.test\n", encoding="utf-8")
    assert get_cors_origins(env_file=(root, pkg)) == ["http://package.test"]
    monkeypatch.setenv("MCP_CORS_ORIGINS", "http://process.test")
    assert get_cors_origins(env_file=(root, pkg)) == ["http://process.test"]


def test_missing_env_files_fall_back_to_default(tmp_path, monkeypatch):
    monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    assert get_cors_origins(env_file=(tmp_path / "nope.env",)) == ["http://localhost:3000"]


def test_default_env_file_is_repo_root_dotenv(monkeypatch, tmp_path):
    """env_file 을 생략하면 저장소 루트 .env 를 읽는다 (REPO_ROOT 를 임시 폴더로 바꿔 확인)."""
    import _common.cors as cors

    monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    (tmp_path / ".env").write_text("MCP_CORS_ORIGINS=http://repo-root.test\n", encoding="utf-8")
    monkeypatch.setattr(cors, "REPO_ROOT", tmp_path)
    assert get_cors_origins() == ["http://repo-root.test"]


def test_http_middleware_passes_env_file_to_cors(tmp_path, monkeypatch):
    from _common.auth import build_http_middleware

    monkeypatch.delenv("MCP_CORS_ORIGINS", raising=False)
    env = tmp_path / ".env"
    env.write_text("MCP_CORS_ORIGINS=http://server-settings.test\n", encoding="utf-8")
    cors_mw, _auth = build_http_middleware(None, env_file=(env,))
    assert cors_mw.kwargs["allow_origins"] == ["http://server-settings.test"]


async def _ok(request):
    return PlainTextResponse("ok", headers={"mcp-session-id": "s-1"})


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("MCP_CORS_ORIGINS", "http://allowed.test")
    app = Starlette(
        routes=[Route("/mcp", _ok, methods=["GET", "POST"])], middleware=[build_cors_middleware()]
    )
    return TestClient(app)


def test_preflight_allows_configured_origin(client):
    res = client.options(
        "/mcp",
        headers={
            "Origin": "http://allowed.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-mcp-api-key, mcp-session-id",
        },
    )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://allowed.test"
    assert "access-control-allow-credentials" not in res.headers
    allowed = res.headers["access-control-allow-headers"].lower()
    assert "x-mcp-api-key" in allowed and "mcp-session-id" in allowed


def test_preflight_rejects_other_origin(client):
    res = client.options(
        "/mcp", headers={"Origin": "http://evil.test", "Access-Control-Request-Method": "POST"}
    )
    assert res.status_code == 400
    assert "access-control-allow-origin" not in res.headers


def test_session_headers_are_exposed(client):
    res = client.post("/mcp", headers={"Origin": "http://allowed.test"})
    assert res.headers["access-control-allow-origin"] == "http://allowed.test"
    exposed = {h.strip() for h in res.headers["access-control-expose-headers"].split(",")}
    assert {"mcp-session-id", "mcp-protocol-version"} <= exposed
