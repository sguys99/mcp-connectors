"""MCP Agent 인증 미들웨어. Streamable HTTP 요청의 ``X-MCP-API-Key`` 헤더를 검증합니다.

FastMCP ``mcp.run(transport="http", middleware=[...])`` 에 넣는 순수 ASGI 미들웨어예요.
stdio transport 는 HTTP 계층이 없으므로 영향을 받지 않습니다.

* 기대 키가 비어 있으면(``MCP_API_KEY`` 미설정 또는 빈 문자열) 검사를 건너뜁니다 (MVP 기본값).
  서버는 ``settings.mcp_api_key`` 를 넘기므로 OS 환경 변수와 ``.env`` 값이 모두 반영돼요.
* 비교는 :func:`hmac.compare_digest` 로 상수 시간에 수행합니다.
* ``OPTIONS`` 요청(CORS preflight)은 키 없이 통과시킵니다. 브라우저는 preflight 에
  사용자 정의 헤더를 싣지 않기 때문입니다.
* 실패 시 401 과 JSON-RPC 형식 에러 본문을 반환합니다.

미들웨어 순서: Starlette 는 목록의 앞쪽을 바깥쪽으로 감쌉니다. 반드시
``[build_cors_middleware(), build_auth_middleware(...)]`` 순서로 넣어야 CORS 가 바깥에서
preflight 를 먼저 처리하고, 401 응답에도 ``Access-Control-Allow-Origin`` 을 붙여 브라우저
프론트엔드가 에러 내용을 읽을 수 있어요. :func:`build_http_middleware` 가 이 순서를 고정합니다.
"""

from __future__ import annotations

import hmac
from collections.abc import Iterable, Sequence
from pathlib import Path

from starlette.datastructures import Headers
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from _common.cors import build_cors_middleware

API_KEY_HEADER = "X-MCP-API-Key"

# JSON-RPC 2.0 의 서버 정의 에러 영역(-32000 ~ -32099) 중 인증 실패용 코드
JSONRPC_UNAUTHORIZED_CODE = -32001


def _unauthorized_body(message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": JSONRPC_UNAUTHORIZED_CODE, "message": message},
    }


class APIKeyMiddleware:
    """``X-MCP-API-Key`` 헤더를 검증하는 ASGI 미들웨어.

    Args:
        app: 감쌀 ASGI 앱.
        api_key: 기대 키. 빈 값이나 None 이면 인증을 끕니다.
        exempt_paths: 키 없이 열어 둘 경로 (예: 헬스 체크). 기본은 없음.
    """

    def __init__(
        self,
        app: ASGIApp,
        api_key: str | None = None,
        exempt_paths: Iterable[str] = (),
    ) -> None:
        self.app = app
        self._expected = api_key.encode("utf-8") if api_key else None
        self._exempt_paths = frozenset(exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            self._expected is None
            or scope["type"] != "http"
            or scope.get("method") == "OPTIONS"
            or scope.get("path") in self._exempt_paths
        ):
            await self.app(scope, receive, send)
            return

        provided = Headers(scope=scope).get(API_KEY_HEADER)
        if provided is not None and hmac.compare_digest(provided.encode("utf-8"), self._expected):
            await self.app(scope, receive, send)
            return

        message = (
            f"Authentication failed: the {API_KEY_HEADER} header is missing."
            if provided is None
            else f"Authentication failed: the {API_KEY_HEADER} value is invalid."
        )
        response = JSONResponse(
            _unauthorized_body(message),
            status_code=401,
            headers={"WWW-Authenticate": API_KEY_HEADER},
        )
        await response(scope, receive, send)


def build_auth_middleware(api_key: str | None, exempt_paths: Iterable[str] = ()) -> Middleware:
    """FastMCP ``middleware=[...]`` 에 넣을 API Key 미들웨어 한 건."""
    return Middleware(APIKeyMiddleware, api_key=api_key, exempt_paths=tuple(exempt_paths))


def build_http_middleware(
    api_key: str | None, env_file: Sequence[str | Path] | None = None
) -> list[Middleware]:
    """Streamable HTTP 서버 공용 미들웨어 목록. CORS 가 바깥, 인증이 안쪽입니다.

    Args:
        api_key: 보통 서버 ``settings.mcp_api_key`` (OS 환경 변수와 ``.env`` 를 모두 반영한 값).
        env_file: ``MCP_CORS_ORIGINS`` 를 읽을 ``.env`` 파일들. 서버 설정과 같은
            ``env_files(__file__)`` 을 넘기면 CORS 도 루트 ``.env`` 와 패키지 ``.env`` 를 같은 규칙으로
            읽습니다. 생략하면 루트 ``.env`` 만 읽어요.
    """
    return [build_cors_middleware(env_file), build_auth_middleware(api_key)]
