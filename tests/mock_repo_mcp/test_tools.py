"""mock-repo-mcp 도구별 동작 + 에러 케이스 검증.

성공 경로 + ``FILE_NOT_FOUND`` + 빈결과 + 페이지네이션 + 입력 검증을 커버.
"""

from __future__ import annotations

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

# ---------- list_repositories ----------


@pytest.mark.asyncio
async def test_list_repositories_returns_all(mcp_client: Client) -> None:
    """필터 없이 호출하면 전체 저장소(3 종) 와 total_count=3 반환."""
    result = await mcp_client.call_tool("list_repositories", {})
    assert result.is_error is False
    data = result.data
    assert data["total_count"] == 3
    assert len(data["repositories"]) == 3
    assert {r["id"] for r in data["repositories"]} == {"repo-alpha", "repo-beta", "repo-gamma"}


@pytest.mark.asyncio
async def test_list_repositories_filters_by_name_pattern(mcp_client: Client) -> None:
    """name_pattern 부분 일치 (대소문자 무시) 필터링."""
    result = await mcp_client.call_tool("list_repositories", {"name_pattern": "ALPHA"})
    assert result.is_error is False
    data = result.data
    assert data["total_count"] == 1
    assert data["repositories"][0]["id"] == "repo-alpha"


@pytest.mark.asyncio
async def test_list_repositories_paginates(mcp_client: Client) -> None:
    """limit=1, offset=1 → 두 번째 저장소 1 개만, total_count 는 유지."""
    result = await mcp_client.call_tool("list_repositories", {"limit": 1, "offset": 1})
    assert result.is_error is False
    data = result.data
    assert data["total_count"] == 3
    assert len(data["repositories"]) == 1
    assert data["repositories"][0]["id"] == "repo-beta"


@pytest.mark.asyncio
async def test_list_repositories_empty_filter(mcp_client: Client) -> None:
    """매칭 없는 패턴 → 빈 배열 + total_count=0."""
    result = await mcp_client.call_tool("list_repositories", {"name_pattern": "no-such-repo-xyz"})
    assert result.is_error is False
    assert result.data == {"repositories": [], "total_count": 0}


@pytest.mark.asyncio
async def test_list_repositories_negative_limit_raises(mcp_client: Client) -> None:
    """limit 음수 입력 시 InvalidInputError → ToolError 직렬화."""
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool("list_repositories", {"limit": -1})
    assert "limit must be >= 0" in str(exc_info.value)
    assert "[INVALID_INPUT]" in str(exc_info.value)


# ---------- get_file_content ----------


@pytest.mark.asyncio
async def test_get_file_content_returns_wrap_untrusted(mcp_client: Client) -> None:
    """유효한 (repo, path) → metadata + untrusted_content 형태, size 일치."""
    result = await mcp_client.call_tool(
        "get_file_content", {"repository_id": "repo-alpha", "path": "README.md"}
    )
    assert result.is_error is False
    data = result.data
    assert set(data.keys()) == {"metadata", "untrusted_content"}
    assert data["metadata"]["path"] == "README.md"
    assert data["metadata"]["revision"] is None
    content = data["untrusted_content"]["content"]
    assert isinstance(content, str)
    assert data["metadata"]["size"] == len(content.encode("utf-8"))
    assert "alpha-service" in content


@pytest.mark.asyncio
async def test_get_file_content_not_found_raises(mcp_client: Client) -> None:
    """존재하지 않는 path → NotFoundError, 메시지에 FILE_NOT_FOUND 포함."""
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool(
            "get_file_content", {"repository_id": "repo-alpha", "path": "no-such-file.txt"}
        )
    assert str(exc_info.value).endswith("[FILE_NOT_FOUND]")


# ---------- search_code ----------


@pytest.mark.asyncio
async def test_search_code_finds_matches(mcp_client: Client) -> None:
    """fixture 에 심은 'TODO' 키워드 검색 → 다수 매치, 각 매치에 필수 키."""
    result = await mcp_client.call_tool("search_code", {"query": "TODO"})
    assert result.is_error is False
    matches = result.data["matches"]
    assert len(matches) >= 2
    for match in matches:
        assert set(match.keys()) == {"repository_id", "path", "line_number", "preview"}
        assert isinstance(match["line_number"], int)
        assert "TODO" in match["preview"]


@pytest.mark.asyncio
async def test_search_code_scoped_to_repository(mcp_client: Client) -> None:
    """repository_id 지정 시 해당 저장소 매치만 반환."""
    result = await mcp_client.call_tool("search_code", {"query": "TODO", "repository_id": "repo-alpha"})
    assert result.is_error is False
    matches = result.data["matches"]
    assert len(matches) >= 1
    assert all(m["repository_id"] == "repo-alpha" for m in matches)


@pytest.mark.asyncio
async def test_search_code_no_results(mcp_client: Client) -> None:
    """fixture 에 없는 문자열 → 빈 matches 배열."""
    result = await mcp_client.call_tool("search_code", {"query": "ZZZ_NOT_PRESENT_XYZ"})
    assert result.is_error is False
    assert result.data == {"matches": []}


@pytest.mark.asyncio
async def test_search_code_empty_query_raises(mcp_client: Client) -> None:
    """빈 query → InvalidInputError."""
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool("search_code", {"query": ""})
    assert "query must not be empty" in str(exc_info.value)
    assert "[INVALID_INPUT]" in str(exc_info.value)
