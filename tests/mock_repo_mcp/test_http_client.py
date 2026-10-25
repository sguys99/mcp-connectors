"""HttpBackendClient 검증 (httpx.MockTransport, 실 네트워크 없음). _common.retry 적용 확인 포함."""

from __future__ import annotations

import httpx
import pytest

from _common.errors import BackendUnavailableError, NotFoundError
from mock_repo_mcp.client import HttpBackendClient

BASE = "https://repo.example.com/api/v1"


def _client(handler, max_attempts: int = 2) -> HttpBackendClient:
    return HttpBackendClient(
        BASE,
        max_attempts=max_attempts,
        initial_wait=0,
        transport=httpx.MockTransport(handler),
    )


async def test_list_repositories_calls_endpoint_and_drops_none_params():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"repositories": [{"id": "r1"}], "total_count": 1})

    items, total = await _client(handler).list_repositories(None, 20, 0)
    assert items == [{"id": "r1"}]
    assert total == 1
    assert seen[0].url.path == "/api/v1/repositories"
    assert dict(seen[0].url.params) == {"limit": "20", "offset": "0"}


async def test_get_file_content_returns_size_and_quotes_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.raw_path.startswith(b"/api/v1/repositories/team%2Frepo/files")
        assert request.url.params["path"] == "src/main.py"
        return httpx.Response(200, json={"content": "한글"})

    content, size = await _client(handler).get_file_content("team/repo", "src/main.py", None)
    assert content == "한글"
    assert size == len("한글".encode())


async def test_search_code_respects_limit():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"matches": [{"n": i} for i in range(5)]})

    assert len(await _client(handler).search_code("q", None, 3)) == 3


async def test_retries_5xx_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"matches": []})

    assert await _client(handler).search_code("q", None, 10) == []
    assert calls["n"] == 2


async def test_retries_network_error_then_raises_backend_unavailable():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(BackendUnavailableError, match="BACKEND_UNAVAILABLE"):
        await _client(handler, max_attempts=3).list_repositories(None, 1, 0)
    assert calls["n"] == 3


async def test_404_is_not_found_without_retry():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(404)

    with pytest.raises(NotFoundError, match=r"File not found: repo-alpha:missing.py \[FILE_NOT_FOUND\]"):
        await _client(handler).get_file_content("repo-alpha", "missing.py", None)
    assert calls["n"] == 1


async def test_other_4xx_is_backend_unavailable_without_retry():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(403)

    with pytest.raises(BackendUnavailableError, match="HTTP 403"):
        await _client(handler).search_code("q", None, 1)
    assert calls["n"] == 1


async def test_http_client_is_created_once_and_reused():
    """여러 호출이 같은 httpx.AsyncClient 를 공유한다 (호출마다 만들지 않음)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"matches": []})

    client = _client(handler)
    assert client._http is None  # 첫 호출 전에는 만들지 않는다
    await client.search_code("q", None, 1)
    first = client._http
    await client.search_code("q", None, 1)
    assert first is not None
    assert client._http is first


async def test_close_closes_shared_client_and_is_idempotent():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"matches": []})

    client = _client(handler)
    await client.search_code("q", None, 1)
    shared = client._http
    assert shared is not None
    await client.close()
    assert shared.is_closed
    assert client._http is None
    await client.close()  # 두 번 불러도 안전


async def test_call_after_close_recreates_client():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"matches": []})

    client = _client(handler)
    await client.search_code("q", None, 1)
    await client.close()
    assert await client.search_code("q", None, 1) == []
    assert client._http is not None
    assert not client._http.is_closed


async def test_retry_reuses_same_client_across_attempts():
    """재시도는 같은 클라이언트로 이어지고 시도 횟수는 그대로다."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json={"matches": []})

    client = _client(handler, max_attempts=3)
    assert await client.search_code("q", None, 1) == []
    assert calls["n"] == 3


async def test_server_lifespan_closes_tools_client(monkeypatch):
    """서버 lifespan 종료 시 tools 의 백엔드 close() 가 호출된다."""
    from fastmcp import Client

    from mock_repo_mcp import tools
    from mock_repo_mcp.server import mcp

    closed = {"n": 0}

    class _Fake:
        async def close(self) -> None:
            closed["n"] += 1

    monkeypatch.setattr(tools, "_client", _Fake())
    async with Client(mcp):
        assert closed["n"] == 0
    assert closed["n"] == 1
