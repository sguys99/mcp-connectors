"""starter-mcp 도구별 동작 + _common 호출 흔적 검증."""

from __future__ import annotations

import logging
import re

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError


@pytest.mark.asyncio
async def test_echo_wraps_untrusted(mcp_client: Client) -> None:
    """echo 응답이 wrap_untrusted 형태인지 검증."""
    result = await mcp_client.call_tool("echo", {"text": "hi"})
    assert result.is_error is False
    assert result.data == {
        "metadata": {"length": 2},
        "untrusted_content": {"content": "hi"},
    }


@pytest.mark.asyncio
async def test_echo_empty_raises(mcp_client: Client) -> None:
    """빈 text 입력 시 InvalidInputError (ToolError 로 직렬화)."""
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool("echo", {"text": ""})
    assert "text is required" in str(exc_info.value)
    assert "[INVALID_INPUT]" in str(exc_info.value)


@pytest.mark.asyncio
async def test_add_returns_sum(mcp_client: Client) -> None:
    """add 가 정수 합을 반환."""
    result = await mcp_client.call_tool("add", {"a": 2, "b": 3})
    assert result.is_error is False
    assert result.data == 5


@pytest.mark.asyncio
async def test_add_logs_params_hash(
    mcp_client: Client,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """add 호출 시 hash_params 결과가 params_hash extra 로 로깅되는지 검증."""
    with caplog.at_level(logging.INFO, logger="starter-mcp"):
        await mcp_client.call_tool("add", {"a": 7, "b": 11})

    add_records = [r for r in caplog.records if r.getMessage() == "add called"]
    assert len(add_records) >= 1, "add 호출 로그가 캡처되지 않음"
    record = add_records[-1]
    params_hash = getattr(record, "params_hash", None)
    assert isinstance(params_hash, str)
    # _common.logging.hash_params 는 SHA256 16자 hex
    assert re.fullmatch(r"[0-9a-f]{16}", params_hash), params_hash


@pytest.mark.asyncio
async def test_current_time_returns_isoformat(mcp_client: Client) -> None:
    """current_time 응답이 ISO 8601 형식."""
    result = await mcp_client.call_tool("current_time", {"tz": "UTC"})
    assert result.is_error is False
    assert isinstance(result.data, str)
    # 예: 2026-05-19T12:34:56.789012+00:00
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", result.data)


@pytest.mark.asyncio
async def test_current_time_default_is_utc(mcp_client: Client) -> None:
    """tz 인자 생략 시 기본 UTC."""
    result = await mcp_client.call_tool("current_time", {})
    assert result.is_error is False
    assert result.data.endswith("+00:00")


@pytest.mark.asyncio
async def test_current_time_seoul(mcp_client: Client) -> None:
    """Asia/Seoul 타임존 호출 성공, offset +09:00 포함."""
    result = await mcp_client.call_tool("current_time", {"tz": "Asia/Seoul"})
    assert result.is_error is False
    assert result.data.endswith("+09:00")


@pytest.mark.asyncio
async def test_current_time_invalid_tz_raises(mcp_client: Client) -> None:
    """알 수 없는 tz 입력 시 InvalidInputError (ToolError 로 직렬화)."""
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool("current_time", {"tz": "Mars/Olympus"})
    assert "Unknown timezone" in str(exc_info.value)
    assert "[INVALID_INPUT]" in str(exc_info.value)
