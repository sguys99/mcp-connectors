"""starter-mcp 의 Resources, Prompts, sample_content 도구 검증."""

from __future__ import annotations

import base64
import json

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from mcp import McpError

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


# ── capabilities ─────────────────────────────────────────────────────────────


async def test_capabilities_include_resources_and_prompts(mcp_client: Client) -> None:
    """initialize 응답에 tools, resources, prompts capability 가 모두 실린다."""
    caps = mcp_client.initialize_result.capabilities
    assert caps.tools is not None
    assert caps.resources is not None
    assert caps.prompts is not None


# ── Resources ────────────────────────────────────────────────────────────────


async def test_list_resources(mcp_client: Client) -> None:
    """고정 리소스 3 개가 mime type 과 함께 노출된다 (template 은 별도 목록)."""
    resources = {str(r.uri): r for r in await mcp_client.list_resources()}
    assert set(resources) == {"starter://about", "starter://config", "starter://logo.png"}
    assert resources["starter://about"].mimeType == "text/markdown"
    assert resources["starter://config"].mimeType == "application/json"
    assert resources["starter://logo.png"].mimeType == "image/png"


async def test_list_resource_templates(mcp_client: Client) -> None:
    templates = await mcp_client.list_resource_templates()
    assert [t.uriTemplate for t in templates] == ["starter://greeting/{name}"]


async def test_read_static_markdown(mcp_client: Client) -> None:
    contents = await mcp_client.read_resource("starter://about")
    assert contents[0].mimeType == "text/markdown"
    assert contents[0].text.startswith("# starter-mcp")


async def test_read_config_json_has_no_secret(mcp_client: Client, monkeypatch) -> None:
    """config 는 유효한 JSON 이고, API Key 값은 설정돼 있어도 노출되지 않는다."""
    from starter_mcp.config import settings

    monkeypatch.setattr(settings, "mcp_api_key", "super-secret-key")
    contents = await mcp_client.read_resource("starter://config")
    info = json.loads(contents[0].text)
    assert info["server"] == "starter-mcp"
    assert info["auth_enabled"] is True
    assert "super-secret-key" not in contents[0].text
    assert "sample_content" in info["primitives"]["tools"]


async def test_read_greeting_template(mcp_client: Client) -> None:
    """template 파라미터가 함수 인자로 전달되고, 외부 입력은 untrusted_content 로 격리된다."""
    contents = await mcp_client.read_resource("starter://greeting/Kim")
    assert contents[0].mimeType == "application/json"
    assert json.loads(contents[0].text) == {
        "metadata": {"greeting": "Hello", "name_length": 3},
        "untrusted_content": {"name": "Kim"},
    }


async def test_read_greeting_too_long_name_errors(mcp_client: Client) -> None:
    with pytest.raises(McpError) as exc_info:
        await mcp_client.read_resource(f"starter://greeting/{'a' * 51}")
    assert "at most 50" in str(exc_info.value)


async def test_read_logo_blob(mcp_client: Client) -> None:
    """바이너리 리소스는 base64 blob + image/png 로 내려오고 PNG 로 디코딩된다."""
    contents = await mcp_client.read_resource("starter://logo.png")
    assert contents[0].mimeType == "image/png"
    assert base64.b64decode(contents[0].blob).startswith(PNG_SIGNATURE)


async def test_read_unknown_resource_errors(mcp_client: Client) -> None:
    with pytest.raises(McpError):
        await mcp_client.read_resource("starter://nope")


# ── Prompts ──────────────────────────────────────────────────────────────────


async def test_list_prompts_with_argument_metadata(mcp_client: Client) -> None:
    prompts = {p.name: p for p in await mcp_client.list_prompts()}
    assert set(prompts) == {"explain_tool", "code_review_session"}
    args = {a.name: a for a in prompts["explain_tool"].arguments}
    assert args["tool_name"].required is True
    assert args["audience"].required is False
    assert args["tool_name"].description  # 인자 설명이 비어 있지 않다
    assert prompts["code_review_session"].description


async def test_get_prompt_required_only_uses_default(mcp_client: Client) -> None:
    result = await mcp_client.get_prompt("explain_tool", {"tool_name": "echo"})
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    text = result.messages[0].content.text
    assert "`echo`" in text and "beginner" in text


async def test_get_prompt_with_optional_argument(mcp_client: Client) -> None:
    result = await mcp_client.get_prompt("explain_tool", {"tool_name": "add", "audience": "expert"})
    assert "expert" in result.messages[0].content.text


async def test_get_prompt_missing_required_argument_errors(mcp_client: Client) -> None:
    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt("explain_tool", {})
    assert "tool_name" in str(exc_info.value)


async def test_get_prompt_invalid_optional_value_errors(mcp_client: Client) -> None:
    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt("explain_tool", {"tool_name": "echo", "audience": "kid"})
    assert "audience" in str(exc_info.value)


async def test_multi_message_prompt(mcp_client: Client) -> None:
    result = await mcp_client.get_prompt("code_review_session", {"language": "Go", "focus": "security"})
    assert [m.role for m in result.messages] == ["user", "assistant", "user"]
    assert "Go" in result.messages[0].content.text
    assert "security" in result.messages[0].content.text


# ── sample_content 도구 ──────────────────────────────────────────────────────


async def test_sample_content_returns_mixed_blocks(mcp_client: Client) -> None:
    result = await mcp_client.call_tool("sample_content", {"message": "hi"})
    assert [b.type for b in result.content] == ["text", "image", "resource"]

    text, image, embedded = result.content
    assert json.loads(text.text) == {
        "metadata": {"length": 2},
        "untrusted_content": {"content": "hi"},
    }
    assert image.mimeType == "image/png"
    assert base64.b64decode(image.data).startswith(PNG_SIGNATURE)
    assert str(embedded.resource.uri) == "starter://about"
    assert embedded.resource.mimeType == "text/markdown"


async def test_sample_content_default_message(mcp_client: Client) -> None:
    result = await mcp_client.call_tool("sample_content", {})
    assert "Hello from starter-mcp" in result.content[0].text


async def test_sample_content_empty_message_raises(mcp_client: Client) -> None:
    with pytest.raises(ToolError) as exc_info:
        await mcp_client.call_tool("sample_content", {"message": ""})
    assert "message must not be empty" in str(exc_info.value)
