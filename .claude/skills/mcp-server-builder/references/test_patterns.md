# Test Patterns

`tests/<snake_name>/` 아래에 만드는 테스트 템플릿입니다. 실 백엔드 없이 Mock만으로 끝까지 검증하는 것이 원칙입니다. 정본 예시는 `tests/mock_repo_mcp/`, `tests/nl2sql_mcp/conftest.py`, `tests/_common/test_auth.py`입니다.

---

## 0. 저장소 설정 (이미 되어 있음, 편집 불필요)

`pyproject.toml`에 다음이 이미 있습니다. 의존성(pytest, pytest-asyncio, fastmcp, httpx, starlette)도 이미 dev 그룹과 본 의존성에 들어 있어 `uv add`가 필요 없습니다.

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = [".", "src/mcp-servers"]
addopts = "--import-mode=importlib -m 'not integration'"
asyncio_mode = "auto"
```

- **`tests/<snake_name>/__init__.py`는 만들지 않습니다.** importlib 모드에서 `src/mcp-servers/<snake_name>` 패키지와 이름이 겹쳐 import가 꼬입니다.
- `asyncio_mode = "auto"`라서 `async def test_*`에 `@pytest.mark.asyncio`를 붙이지 않아도 됩니다. async fixture는 `pytest_asyncio.fixture`로 선언합니다.

---

## 1. `conftest.py`

```python
"""<kebab-name> 테스트 fixture. 이 디렉터리에는 __init__.py 를 두지 않는다 (importlib 모드)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastmcp import Client

from <snake_name>.client import MockBackendClient
from <snake_name>.server import mcp
from <snake_name>.state import state


@pytest.fixture
def mock_backend() -> Iterator[MockBackendClient]:
    """도구 함수를 직접 부르는 단위 테스트용. state.backend 를 Mock 으로 바꿔 끼운다."""
    backend = MockBackendClient()
    state.backend = backend
    yield backend
    state.backend = None


@pytest_asyncio.fixture
async def mcp_client() -> AsyncIterator[Client]:
    """FastMCP in-memory client. lifespan 이 돌면서 Mock 백엔드를 넣는다."""
    async with Client(mcp) as client:
        yield client
```

`Client(mcp)`는 같은 프로세스 안에서 MCP 프로토콜을 그대로 거치는 in-memory 클라이언트입니다 (FastMCP 3.x, `from fastmcp import Client`). 서버의 lifespan이 실행되므로 `<UPPER_NAME>_BACKEND_URL`이 비어 있는 한 Mock 백엔드가 들어갑니다.

---

## 2. `test_tools.py`: 도구 단위 테스트

```python
"""<kebab-name> 도구 단위 테스트 (MockBackendClient)."""

from __future__ import annotations

import pytest

from _common.errors import InvalidInputError, NotFoundError
from <snake_name> import tools


async def test_list_items_returns_items_and_total(mock_backend) -> None:
    result = await tools.list_items(limit=20)
    assert {"items", "total_count"} <= result.keys()


@pytest.mark.parametrize("limit", [0, 101])
async def test_list_items_rejects_out_of_range_limit(mock_backend, limit: int) -> None:
    with pytest.raises(InvalidInputError, match=r"\[INVALID_INPUT\]"):
        await tools.list_items(limit=limit)


async def test_get_item_wraps_untrusted_description(mock_backend) -> None:
    result = await tools.get_item(item_id="item_001")
    assert set(result) == {"metadata", "untrusted_content"}
    assert "description" in result["untrusted_content"]


async def test_get_item_not_found(mock_backend) -> None:
    with pytest.raises(NotFoundError, match=r"\[ITEM_NOT_FOUND\]"):
        await tools.get_item(item_id="missing")
```

**원칙**:
- 도구마다 성공 1건 + 스펙 §5.2 에러 표의 코드마다 1건. 에러는 메시지 끝의 `[CODE]` 태그로 검증합니다 (`match=r"\[CODE\]"`). 문장은 바뀌어도 코드는 그대로이기 때문입니다.
- 값 일치보다 **구조**(키 존재, `metadata`/`untrusted_content` 분리)를 봅니다. Mock 데이터가 바뀌어도 깨지지 않습니다.
- Mock이 자연스럽게 낼 수 없는 에러(`ACCESS_DENIED`, `BACKEND_UNAVAILABLE`)는 `monkeypatch.setattr(mock_backend, "get_item", _raise)`처럼 메서드를 바꿔 트리거합니다.
- 테스트 이름과 assert는 영어로, docstring과 주석은 한국어로 써도 됩니다 (저장소 관례).

---

## 3. `test_mcp_contract.py`: 프로토콜 종단간

```python
"""<kebab-name> MCP 프로토콜 contract 테스트 (in-memory client)."""

from __future__ import annotations

import pytest
from fastmcp import Client

EXPECTED_TOOLS = {"list_items", "get_item"}


async def test_list_tools_matches_spec(mcp_client: Client) -> None:
    tools = await mcp_client.list_tools()
    assert {t.name for t in tools} == EXPECTED_TOOLS


async def test_tools_have_description_schema_and_hints(mcp_client: Client) -> None:
    for tool in await mcp_client.list_tools():
        assert tool.description, tool.name
        assert tool.inputSchema.get("type") == "object", tool.name
        assert tool.annotations is not None and tool.annotations.readOnlyHint is True, tool.name


@pytest.mark.parametrize(
    ("name", "args"),
    [("list_items", {}), ("get_item", {"item_id": "item_001"})],
)
async def test_each_tool_callable(mcp_client: Client, name: str, args: dict) -> None:
    result = await mcp_client.call_tool(name, args)
    assert result.is_error is False
    assert isinstance(result.structured_content, dict)


async def test_error_is_returned_as_tool_error(mcp_client: Client) -> None:
    result = await mcp_client.call_tool("get_item", {"item_id": "missing"}, raise_on_error=False)
    assert result.is_error is True
    assert "[ITEM_NOT_FOUND]" in result.content[0].text
```

- 쓰기 도구가 섞여 있으면 annotations 검증을 도구별 기대값 dict로 바꿉니다.
- FastMCP 3.x의 `call_tool`은 `CallToolResult`를 돌려줍니다. dict를 반환하는 도구는 `structured_content`에 그 dict가 들어 있습니다. 에러는 기본으로 예외(`ToolError`)를 던지므로 에러 응답 자체를 보려면 `raise_on_error=False`를 줍니다.

**왜 필요한가**: 단위 테스트는 함수만 부르므로 등록, 인자 검증, 직렬화, annotations를 보지 못합니다. contract 테스트가 Tool 누락이나 스키마 변경을 바로 잡습니다. HTTP 미들웨어(인증, CORS)는 다음 절에서 봅니다.

---

## 4. `test_auth_middleware.py`: 인증 smoke (HTTP + 인증 활성 시)

```python
"""<kebab-name> X-MCP-API-Key 인증 smoke (Streamable HTTP 앱 수준, Starlette TestClient)."""

from __future__ import annotations

from starlette.testclient import TestClient

from _common.auth import API_KEY_HEADER, build_http_middleware
from <snake_name>.server import mcp

KEY = "secret-key-1"
INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "0"},
    },
}
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def _client(api_key: str | None) -> TestClient:
    return TestClient(mcp.http_app(middleware=build_http_middleware(api_key)))


def test_open_when_key_unset() -> None:
    with _client(None) as c:
        assert c.post("/mcp", json=INIT, headers=HEADERS).status_code == 200


def test_401_without_key() -> None:
    with _client(KEY) as c:
        res = c.post("/mcp", json=INIT, headers=HEADERS)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == -32001


def test_200_with_key() -> None:
    with _client(KEY) as c:
        res = c.post("/mcp", json=INIT, headers={**HEADERS, API_KEY_HEADER: KEY})
    assert res.status_code == 200
```

스펙 §4.1이 stdio 전용이고 §6.2에 MCP 인증이 없으면 이 파일은 만들지 않습니다. 반대로 Streamable HTTP를 쓰거나 §6.2에 `X-MCP-API-Key`가 있으면 만듭니다.

---

## 5. (선택) `test_http_client.py`: `httpx.MockTransport`

`HttpBackendClient`가 `transport` 인자를 받으므로 추가 패키지 없이 엔드포인트 경로, 헤더, 재시도를 검증할 수 있습니다 (정본: `tests/mock_repo_mcp/test_http_client.py`). 실 엔드포인트가 정해지지 않아 `NotImplementedError` stub인 단계에서는 만들지 않습니다.

```python
"""HttpBackendClient HTTP 호출 검증 (httpx.MockTransport)."""

from __future__ import annotations

import httpx

from <snake_name>.client import HttpBackendClient


async def test_list_items_calls_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/items"
        assert request.headers["Authorization"] == "Bearer t"
        return httpx.Response(200, json={"items": [], "total_count": 0})

    client = HttpBackendClient(
        "https://backend.example.internal/api/v1", token="t", transport=httpx.MockTransport(handler)
    )
    assert await client.list_items(20) == {"items": [], "total_count": 0}
    await client.aclose()
```

---

## 6. 시나리오 YAML (pytest 밖의 회귀)

`tests/scenarios/<kebab-name>.yaml`은 pytest가 아니라 `scripts/mcp_cli.py test`가 실행합니다. 템플릿은 [server_skeleton.md 파일 9](server_skeleton.md)에 있습니다. 실제 stdio 서버 프로세스를 띄워 레지스트리 항목, 실행 명령, `[CODE]` 태그까지 한 번에 확인하므로 pytest와 겹치지 않습니다.

---

## 7. 자주 빠지는 함정

- **`tests/<snake_name>/__init__.py` 생성**: 패키지 이름 충돌. 만들지 않습니다
- **`mock_backend` fixture가 `state.backend`를 바꾸지 않음**: 도구가 `BACKEND_UNAVAILABLE`을 던집니다
- **fixture 정리 누락**: yield 뒤 `state.backend = None`을 빠뜨리면 다음 테스트가 영향을 받습니다
- **async fixture를 `@pytest.fixture`로 선언**: `pytest_asyncio.fixture`를 씁니다
- **ruff F402/E501**: 루프 변수 이름을 `annotations`로 쓰면 `from __future__ import annotations`를 가립니다 (`hints` 사용). 긴 `Annotated[...]`는 여러 줄로 나누고 `ruff format`을 돌립니다

---

## 8. 작성 우선순위

1. `conftest.py`
2. `test_mcp_contract.py` (Tool 누락과 명세 변경을 가장 먼저 잡음)
3. `test_tools.py` (도구별 성공 1건 + 에러 코드별 1건)
4. `test_auth_middleware.py` (HTTP 또는 인증이 있을 때)
5. `tests/scenarios/<kebab-name>.yaml`
6. (선택) `test_http_client.py`
