"""scripts/mcp_cli.py 의 Streamable HTTP 헤더 해석 검증."""

from __future__ import annotations

from scripts.mcp_cli import API_KEY_HEADER, _resolve_headers


def test_no_key_no_headers():
    assert _resolve_headers({"name": "s"}, api_key="") == {}


def test_api_key_added_automatically():
    assert _resolve_headers({"name": "s"}, api_key="k1") == {API_KEY_HEADER: "k1"}


def test_registry_headers_expand_env(monkeypatch):
    monkeypatch.setenv("MY_TOKEN", "abc")
    entry = {"name": "s", "headers": {"X-Trace": "t-${MY_TOKEN}", "X-Empty": "${UNSET_VAR_XYZ}"}}
    monkeypatch.delenv("UNSET_VAR_XYZ", raising=False)
    assert _resolve_headers(entry, api_key="k1") == {"X-Trace": "t-abc", API_KEY_HEADER: "k1"}


def test_registry_api_key_header_wins(monkeypatch):
    """레지스트리에 키 헤더가 있으면 MCP_API_KEY 로 덮어쓰지 않는다 (치환 결과가 비면 생략)."""
    monkeypatch.setenv("OTHER_KEY", "from-registry")
    entry = {"name": "s", "headers": {"x-mcp-api-key": "${OTHER_KEY}"}}
    assert _resolve_headers(entry, api_key="k1") == {"x-mcp-api-key": "from-registry"}
