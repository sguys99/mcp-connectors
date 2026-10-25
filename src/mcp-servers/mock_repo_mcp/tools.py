"""mock-repo-mcp 도구 3종.

본 파일은 *plain async function* 으로 작성된다. FastMCP 결합은 ``server.py``
에서 ``mcp.add_tool(<func>)`` 호출로 일괄 등록된다.

각 도구는 ``_common/`` 모듈을 최소 1 회씩 호출하며, 백엔드 호출은 모듈
레벨 ``_client`` 싱글톤을 통해 위임된다 (``BackendClient`` Protocol).
테스트는 ``monkeypatch.setattr("mock_repo_mcp.tools._client", ...)`` 또는
별도 ``MockBackendClient`` 인스턴스를 직접 호출해 주입한다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from _common.errors import InvalidInputError
from _common.logging import hash_params, setup_logger
from _common.trust import wrap_untrusted
from mock_repo_mcp.client import BackendClient, HttpBackendClient, MockBackendClient
from mock_repo_mcp.config import settings

logger = setup_logger("mock-repo-mcp")


def _build_client() -> BackendClient:
    """``MOCK_REPO_BACKEND_URL`` 이 있으면 실 HTTP 백엔드, 없으면 fixtures Mock 을 씁니다."""
    if settings.mock_repo_backend_url:
        return HttpBackendClient(settings.mock_repo_backend_url)
    return MockBackendClient(fixtures_dir=Path(__file__).parent / "fixtures")


_client: BackendClient = _build_client()


async def list_repositories(
    name_pattern: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Return the list of repositories (filter + pagination).

    Args:
        name_pattern: Partial-match filter on repository name (case-insensitive). None returns all.
        limit: Page size. Must not be negative.
        offset: Start offset. Must not be negative.

    Returns:
        ``{"repositories": [...], "total_count": <int>}``. Empty array if nothing matches.

    Raises:
        InvalidInputError: If ``limit`` or ``offset`` is negative.
    """
    if limit < 0:
        raise InvalidInputError(f"limit must be >= 0, got {limit}")
    if offset < 0:
        raise InvalidInputError(f"offset must be >= 0, got {offset}")
    logger.info(
        "list_repositories called",
        extra={
            "params_hash": hash_params({"name_pattern": name_pattern, "limit": limit, "offset": offset})
        },
    )
    items, total_count = await _client.list_repositories(name_pattern, limit, offset)
    return {"repositories": items, "total_count": total_count}


async def get_file_content(
    repository_id: str,
    path: str,
    revision: str | None = None,
) -> dict[str, Any]:
    """Return the file content wrapped in a trust-boundary response.

    Args:
        repository_id: Repository identifier.
        path: Path relative to the repository root.
        revision: Revision (ignored by the mock implementation). None means the default branch.

    Returns:
        ``wrap_untrusted({"path","revision","size"}, {"content"})`` dict.

    Raises:
        NotFoundError: ``FILE_NOT_FOUND``, if the file does not exist.
    """
    logger.info(
        "get_file_content called",
        extra={
            "params_hash": hash_params(
                {"repository_id": repository_id, "path": path, "revision": revision}
            )
        },
    )
    content, size = await _client.get_file_content(repository_id, path, revision)
    return wrap_untrusted(
        metadata={"path": path, "revision": revision, "size": size},
        untrusted_content={"content": content},
    )


async def search_code(
    query: str,
    repository_id: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Return simple substring search results.

    Args:
        query: Substring to search for. Must not be empty.
        repository_id: Restrict the search to one repository. None searches all.
        limit: Maximum number of matches. Must not be negative.

    Returns:
        ``{"matches": [{"repository_id","path","line_number","preview"}, ...]}``.
        Empty array if nothing matches.

    Raises:
        InvalidInputError: If ``query`` is an empty string or ``limit`` is negative.
    """
    if query == "":
        raise InvalidInputError("query must not be empty")
    if limit < 0:
        raise InvalidInputError(f"limit must be >= 0, got {limit}")
    logger.info(
        "search_code called",
        extra={
            "params_hash": hash_params({"query": query, "repository_id": repository_id, "limit": limit})
        },
    )
    matches = await _client.search_code(query, repository_id, limit)
    return {"matches": matches}
