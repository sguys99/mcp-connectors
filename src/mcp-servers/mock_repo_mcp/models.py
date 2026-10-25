"""mock-repo-mcp 입출력 모델.

도구 본문은 plain function (tools.py) 으로 두고, 본 모듈의 모델은
응답 형상 documentation 용도. FastMCP 가 함수 시그니처로부터
inputSchema 를 자동 생성하므로 입력 검증은 도구 함수 파라미터 타입에
의존하고, 본 모듈은 *형상을 코드로 보여주기 위한* documentation 모델.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Repository(BaseModel):
    """저장소 메타데이터 (fixtures/repos.json 항목)."""

    id: str = Field(description="Repository identifier")
    name: str = Field(description="Repository name")
    description: str = Field(description="Repository description")
    default_branch: str = Field(description="Default branch")


class ListRepositoriesResponse(BaseModel):
    """list_repositories 응답 형태."""

    repositories: list[Repository] = Field(description="Repositories after filter and pagination")
    total_count: int = Field(description="Total matches after filtering (before pagination)")


class FileContentResponse(BaseModel):
    """get_file_content 응답 형태 — wrap_untrusted 결과.

    실제 반환은 `wrap_untrusted({"path","revision","size"}, {"content"})` dict.
    """

    metadata: dict[str, Any] = Field(description="Server-generated trusted data (path/revision/size)")
    untrusted_content: dict[str, Any] = Field(description="Original external file content (content)")


class SearchMatch(BaseModel):
    """search_code 단일 매치 항목."""

    repository_id: str = Field(description="Matched repository id")
    path: str = Field(description="File path within the repository")
    line_number: int = Field(description="1-based line number")
    preview: str = Field(description="Original text of the matched line (untrusted)")


class SearchCodeResponse(BaseModel):
    """search_code 응답 형태."""

    matches: list[SearchMatch] = Field(description="List of matches. Empty array if there are none")
