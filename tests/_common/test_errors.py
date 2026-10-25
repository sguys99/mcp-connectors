"""_common.errors 검증: 모든 에러가 ToolError 라 FastMCP 가 isError 응답으로 바꿉니다."""

from __future__ import annotations

import pytest
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError

from _common.errors import (
    AccessDeniedError,
    BackendUnavailableError,
    InvalidInputError,
    NotFoundError,
    ResponseTooLargeError,
)

ALL = [
    InvalidInputError,
    NotFoundError,
    AccessDeniedError,
    BackendUnavailableError,
    ResponseTooLargeError,
]


@pytest.mark.parametrize("cls", ALL)
def test_is_tool_error_and_keeps_message(cls):
    err = cls("메시지 [INVALID_INPUT]")
    assert isinstance(err, ToolError)
    assert str(err) == "메시지 [INVALID_INPUT]"


def test_classes_are_distinct():
    assert len(set(ALL)) == len(ALL)
    assert not issubclass(NotFoundError, InvalidInputError)


@pytest.mark.parametrize("cls", ALL)
async def test_tool_error_becomes_is_error_result(cls):
    mcp = FastMCP("errors-test")

    @mcp.tool
    def fail() -> str:
        raise cls(f"{cls.__name__} 발생 [CODE_X]")

    async with Client(mcp) as client:
        result = await client.call_tool("fail", {}, raise_on_error=False)
    assert result.is_error
    assert result.content[0].text.endswith(f"{cls.__name__} 발생 [CODE_X]")
