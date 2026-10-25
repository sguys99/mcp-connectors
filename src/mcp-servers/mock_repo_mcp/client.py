"""mock-repo-mcp 백엔드 클라이언트.

본 모듈은 ``BackendClient`` Protocol 과 두 구현체를 제공한다:

* :class:`MockBackendClient` — ``fixtures/`` 디렉토리를 메모리에 로드해 응답.
  외부 I/O 없이 결정론적으로 동작하며 MVP 의 실제 사용 구현체.
* :class:`HttpBackendClient`: 실제 내부 저장소 REST API 클라이언트. httpx 로 호출하고
  :func:`_common.retry.with_backoff` 로 일시 장애(네트워크, 5xx, 429)를 재시도합니다.
  ``MOCK_REPO_BACKEND_URL`` 을 설정했을 때만 쓰입니다.

``tools.py`` 는 모듈 로드 시점에 ``MOCK_REPO_BACKEND_URL`` 유무로 두 구현 중 하나를
싱글톤으로 보관하며 (기본은 ``MockBackendClient``), ``HttpBackendClient`` 의 httpx 클라이언트는
첫 호출에서 만들어 재사용하고 서버 lifespan 종료 시 ``close()`` 로 닫습니다.
테스트는 ``monkeypatch`` 또는 새 ``MockBackendClient`` 직접 호출로 주입한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

import httpx

from _common.errors import BackendUnavailableError, NotFoundError
from _common.retry import with_backoff


class BackendClient(Protocol):
    """저장소 백엔드 추상화. tools.py 는 본 Protocol 만 의존한다."""

    async def list_repositories(
        self,
        name_pattern: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        """필터/페이지 적용된 저장소 목록과 필터 적용 후 전체 매칭 수 반환."""
        ...

    async def get_file_content(
        self,
        repository_id: str,
        path: str,
        revision: str | None,
    ) -> tuple[str, int]:
        """파일 내용과 바이트 크기 반환. 파일이 없으면 NotFoundError."""
        ...

    async def search_code(
        self,
        query: str,
        repository_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """라인 단위 substring 매치 결과 반환 (최대 limit 개)."""
        ...


class MockBackendClient:
    """fixtures/ 기반 결정론적 백엔드.

    초기화 시 ``fixtures/repos.json`` 과 ``fixtures/files/`` 트리를 메모리로
    로드한다. ``__init__`` 외에는 디스크 I/O 가 없다.

    Args:
        fixtures_dir: ``repos.json`` 및 ``files/`` 디렉토리를 포함하는 경로.
    """

    def __init__(self, fixtures_dir: Path) -> None:
        self._fixtures_dir = fixtures_dir
        repos_path = fixtures_dir / "repos.json"
        self._repos: list[dict[str, Any]] = json.loads(repos_path.read_text(encoding="utf-8"))

        files_root = fixtures_dir / "files"
        self._files: dict[tuple[str, str], str] = {}
        if files_root.exists():
            for repo_dir in files_root.iterdir():
                if not repo_dir.is_dir():
                    continue
                repo_id = repo_dir.name
                for file_path in repo_dir.rglob("*"):
                    if not file_path.is_file():
                        continue
                    rel = file_path.relative_to(repo_dir).as_posix()
                    self._files[(repo_id, rel)] = file_path.read_text(encoding="utf-8")

    async def list_repositories(
        self,
        name_pattern: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        if name_pattern:
            needle = name_pattern.lower()
            filtered = [r for r in self._repos if needle in r["name"].lower()]
        else:
            filtered = list(self._repos)
        total_count = len(filtered)
        page = filtered[offset : offset + limit]
        return page, total_count

    async def get_file_content(
        self,
        repository_id: str,
        path: str,
        revision: str | None,
    ) -> tuple[str, int]:
        key = (repository_id, path)
        if key not in self._files:
            raise NotFoundError(f"File not found: {repository_id}:{path} [FILE_NOT_FOUND]")
        content = self._files[key]
        return content, len(content.encode("utf-8"))

    async def search_code(
        self,
        query: str,
        repository_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        for (repo_id, path), content in self._files.items():
            if repository_id is not None and repo_id != repository_id:
                continue
            for line_no, line in enumerate(content.splitlines(), start=1):
                if query in line:
                    matches.append(
                        {
                            "repository_id": repo_id,
                            "path": path,
                            "line_number": line_no,
                            "preview": line,
                        },
                    )
                    if len(matches) >= limit:
                        return matches
        return matches


class _RetryableStatusError(Exception):
    """재시도 대상 HTTP 상태(5xx, 429). :func:`with_backoff` 가 이 예외만 다시 시도합니다."""

    def __init__(self, response: httpx.Response) -> None:
        super().__init__(f"HTTP {response.status_code}")
        self.response = response


class HttpBackendClient:
    """실제 내부 저장소 REST API 클라이언트 (httpx + :func:`_common.retry.with_backoff`).

    기대하는 REST 계약 (실 백엔드에 맞춰 경로만 바꾸면 됩니다)::

        GET {base_url}/repositories?name_pattern=&limit=&offset=
            -> {"repositories": [...], "total_count": <int>}
        GET {base_url}/repositories/{repository_id}/files?path=&revision=
            -> {"content": "<str>"}
        GET {base_url}/search?query=&repository_id=&limit=
            -> {"matches": [...]}

    에러 변환:

    * 네트워크 오류, 타임아웃, 5xx, 429 는 ``max_attempts`` 회까지 지수 백오프로 재시도하고,
      그래도 실패하면 ``BackendUnavailableError`` (``[BACKEND_UNAVAILABLE]``).
    * 404 는 재시도 없이 ``NotFoundError``, 그 밖의 4xx 는 ``BackendUnavailableError``.

    Args:
        base_url: 백엔드 API 루트 (예: ``https://repo.internal/api/v1``).
        timeout: 요청 1건 타임아웃(초).
        max_attempts: 최초 시도를 포함한 최대 시도 횟수.
        initial_wait: 첫 재시도 대기(초). 테스트에서는 0 으로 줄입니다.
        transport: 테스트용 httpx transport 주입 (예: ``httpx.MockTransport``).
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 10.0,
        max_attempts: int = 2,
        initial_wait: float = 1.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_attempts = max_attempts
        self._initial_wait = initial_wait
        self._transport = transport
        # 호출마다 만들지 않고 첫 호출에서 한 번 만들어 재사용합니다(연결 풀 공유).
        self._http: httpx.AsyncClient | None = None

    def _get_http(self) -> httpx.AsyncClient:
        """공유 AsyncClient 를 돌려줍니다. 없거나 닫혔으면 새로 만듭니다."""
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=self._base_url, timeout=self._timeout, transport=self._transport
            )
        return self._http

    async def close(self) -> None:
        """공유 AsyncClient 를 닫습니다. 서버 lifespan 종료 시 호출하며 여러 번 불러도 안전합니다."""
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _get_json(self, path: str, params: dict[str, Any]) -> Any:
        query = {k: v for k, v in params.items() if v is not None}
        http = self._get_http()
        try:
            async for attempt in with_backoff(
                max_attempts=self._max_attempts,
                initial_wait=self._initial_wait,
                retry_on=(httpx.TransportError, _RetryableStatusError),
            ):
                with attempt:
                    response = await http.get(path, params=query)
                    if response.status_code >= 500 or response.status_code == 429:
                        raise _RetryableStatusError(response)
        except (httpx.TransportError, _RetryableStatusError) as e:
            raise BackendUnavailableError(
                f"Repository backend call failed: {e} [BACKEND_UNAVAILABLE]"
            ) from e

        if response.status_code == 404:
            raise NotFoundError(f"Resource not found: {path} [NOT_FOUND]")
        if response.is_error:
            raise BackendUnavailableError(
                f"Repository backend returned an error: HTTP {response.status_code} "
                "[BACKEND_UNAVAILABLE]",
            )
        return response.json()

    async def list_repositories(
        self,
        name_pattern: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        data = await self._get_json(
            "/repositories",
            {"name_pattern": name_pattern, "limit": limit, "offset": offset},
        )
        return data["repositories"], int(data["total_count"])

    async def get_file_content(
        self,
        repository_id: str,
        path: str,
        revision: str | None,
    ) -> tuple[str, int]:
        try:
            data = await self._get_json(
                f"/repositories/{quote(repository_id, safe='')}/files",
                {"path": path, "revision": revision},
            )
        except NotFoundError as e:
            raise NotFoundError(f"File not found: {repository_id}:{path} [FILE_NOT_FOUND]") from e
        content = data["content"]
        return content, len(content.encode("utf-8"))

    async def search_code(
        self,
        query: str,
        repository_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        data = await self._get_json(
            "/search",
            {"query": query, "repository_id": repository_id, "limit": limit},
        )
        return data["matches"][:limit]
