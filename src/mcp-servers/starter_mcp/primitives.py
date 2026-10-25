"""starter-mcp 의 Resources 와 Prompts.

``tools.py`` 와 같은 분리 패턴을 따른다. 여기에는 *plain function* 만 두고, FastMCP 결합
(URI, mime type, 설명)은 ``server.py`` 에서 ``mcp.resource`` / ``mcp.prompt`` 로 일괄 등록한다.
LLM 에 노출되는 설명은 server.py 쪽 영어 문자열이 정본이다.

세 프리미티브의 차이를 코드로 보여주는 것이 목적이다.

* Tool: 모델이 호출하는 동작 (``tools.py``)
* Resource: 애플리케이션이 읽는 데이터. URI 로 식별하며, 파라미터가 있으면 template 이 된다
* Prompt: 사용자가 고르는 메시지 템플릿. 인자를 받아 대화 메시지 목록을 만든다

``_common`` 호출 위치:

* :func:`greeting` — :func:`_common.trust.wrap_untrusted`, :class:`_common.errors.InvalidInputError`

주의: 이 파일은 ``from __future__ import annotations`` 를 쓰지 않는다. FastMCP 가 prompt 인자
타입을 ``str`` 객체와 직접 비교하므로, 문자열 어노테이션이거나 ``Annotated``/``Literal`` 이면
인자 설명에 불필요한 JSON schema 안내문이 붙는다. 그래서 인자는 ``str = Field(...)`` 로 선언한다.
"""

import json
import struct
import zlib
from typing import Any

from fastmcp.prompts import Message
from fastmcp.resources import ResourceContent, ResourceResult
from pydantic import Field

from _common.errors import InvalidInputError
from _common.trust import wrap_untrusted
from starter_mcp.config import settings

# ── 정적 데이터 ──────────────────────────────────────────────────────────────

ABOUT_URI = "starter://about"
CONFIG_URI = "starter://config"
GREETING_URI_TEMPLATE = "starter://greeting/{name}"
LOGO_URI = "starter://logo.png"

ABOUT_TEXT = """\
# starter-mcp

Canonical learning example for this repository's MCP servers.

- Tools: `echo`, `add`, `current_time`, `sample_content`
- Resources: `starter://about`, `starter://config`, `starter://greeting/{name}`, `starter://logo.png`
- Prompts: `explain_tool`, `code_review_session`
"""

GREETING_MAX_NAME_LENGTH = 50


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    """PNG 청크 하나를 만든다 (길이 + 종류 + 데이터 + CRC32)."""
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def build_logo_png(size: int = 16) -> bytes:
    """외부 파일이나 이미지 라이브러리 없이 대각선 그라데이션 PNG 를 만든다.

    Inspector 의 image 블록 렌더링을 확인하기 위한 아주 작은 샘플이다.
    """
    rows = bytearray()
    for y in range(size):
        rows.append(0)  # 각 행 앞에 붙는 필터 타입 (0 = None)
        for x in range(size):
            level = 255 * (x + y) // (2 * (size - 1))
            rows += bytes((level, 90, 255 - level))  # RGB
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8bit, color type 2 (RGB)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(rows)))
        + _png_chunk(b"IEND", b"")
    )


LOGO_PNG = build_logo_png()


# ── Resources ────────────────────────────────────────────────────────────────


def about() -> str:
    """정적 markdown 텍스트 리소스."""
    return ABOUT_TEXT


def config_info() -> str:
    """서버 설정 요약을 JSON 문자열로 반환한다.

    시크릿은 싣지 않는다. ``MCP_API_KEY`` 는 값 대신 설정 여부(bool)만 노출한다.
    """
    info: dict[str, Any] = {
        "server": "starter-mcp",
        "transports": ["stdio", "streamable_http"],
        "http_port": settings.starter_mcp_port,
        "auth_enabled": settings.mcp_api_key is not None,
        "primitives": {
            "tools": ["echo", "add", "current_time", "sample_content"],
            "resources": [ABOUT_URI, CONFIG_URI, GREETING_URI_TEMPLATE, LOGO_URI],
            "prompts": ["explain_tool", "code_review_session"],
        },
    }
    return json.dumps(info, ensure_ascii=False, indent=2)


def greeting(name: str) -> ResourceResult:
    """URI template 파라미터를 받는 리소스. ``starter://greeting/{name}`` 의 ``name`` 이 인자로 온다.

    ``name`` 은 외부 입력이므로 ``wrap_untrusted`` 로 격리해 JSON 으로 돌려준다.
    template 읽기 경로는 ``str`` 반환 시 mime type 을 ``text/plain`` 으로 두므로,
    ``ResourceResult`` 로 mime type 을 명시한다.
    """
    name = name.strip()
    if not name:
        raise InvalidInputError("name is required")
    if len(name) > GREETING_MAX_NAME_LENGTH:
        raise InvalidInputError(f"name must be at most {GREETING_MAX_NAME_LENGTH} characters")
    payload = wrap_untrusted(
        metadata={"greeting": "Hello", "name_length": len(name)},
        untrusted_content={"name": name},
    )
    body = json.dumps(payload, ensure_ascii=False)
    return ResourceResult([ResourceContent(body, mime_type="application/json")])


def logo() -> bytes:
    """바이너리 리소스. ``bytes`` 를 반환하면 FastMCP 가 base64 ``blob`` 으로 직렬화한다."""
    return LOGO_PNG


# ── Prompts ──────────────────────────────────────────────────────────────────


def explain_tool(
    tool_name: str = Field(description="Name of the tool to explain, e.g. echo."),
    audience: str = Field(default="beginner", description="Reader level, beginner or expert."),
) -> str:
    """필수 인자(``tool_name``)와 선택 인자(``audience``)를 함께 받는 프롬프트.

    ``str`` 을 반환하면 FastMCP 가 user 메시지 1 개로 감싼다.
    """
    if audience not in ("beginner", "expert"):
        raise InvalidInputError("audience must be 'beginner' or 'expert'")
    return (
        f"Explain what the `{tool_name}` tool does, when to call it, and what its output looks like. "
        f"Write for a {audience} reader and finish with one concrete example call."
    )


def code_review_session(
    language: str = Field(description="Programming language of the snippet, e.g. Python."),
    focus: str = Field(
        default="correctness", description="Review focus such as correctness, security or readability."
    ),
) -> list[Message]:
    """user / assistant 가 번갈아 나오는 다중 메시지 프롬프트.

    마지막을 assistant 메시지로 두면 모델이 그 응답을 이어 쓰는 prefill 형태가 된다.
    """
    return [
        Message(
            f"I will paste a {language} snippet. Review it with a focus on {focus}.",
            role="user",
        ),
        Message(
            "Understood. Please paste the snippet. I will list findings by severity "
            "and propose a minimal fix for each.",
            role="assistant",
        ),
        Message("Here is the snippet:", role="user"),
    ]
