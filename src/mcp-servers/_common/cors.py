"""브라우저 직결을 위한 CORS 미들웨어 빌더.

Phase 4-2 (F-6): Next.js 프론트엔드가 ``http://localhost:3000`` 에서
``http://localhost:80xx/mcp`` 로 직접 요청할 수 있도록 Starlette
:class:`CORSMiddleware` 를 FastMCP 의 ``middleware`` 파라미터에 주입한다.

* 허용 origin 은 ``MCP_CORS_ORIGINS`` (콤마 구분) 로 제어. 다른 서버 설정과 같은 규칙으로 읽는다:
  OS 환경 변수가 최우선이고, 없으면 저장소 루트 ``.env`` 와 서버 패키지 ``.env``
  (뒤가 앞을 덮어씀) 를 본다 (``_common/env.py``). 예전에는 OS 환경 변수만 읽어
  호스트 실행 시 루트 ``.env`` 의 값이 무시됐다.
* 미설정 시 개발 기본값 ``http://localhost:3000`` 사용 (PRD §3.7.2).
* MVP 에서는 자격 증명 (cookie/Authorization) 미사용 → ``allow_credentials=False``.
* ``mcp-session-id`` 응답 헤더는 SDK 가 세션 추적용으로 읽어야 하므로
  반드시 ``Access-Control-Expose-Headers`` 에 포함해야 한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from _common.env import REPO_ROOT

_DEFAULT_DEV_ORIGIN = "http://localhost:3000"

# Streamable HTTP 클라이언트가 다음 요청에 실어 보내기 위해 읽어야 하는
# 응답 헤더. CORS 모드에서는 expose_headers 에 명시해야 JS 에서 접근 가능.
_EXPOSE_HEADERS = ["mcp-session-id", "mcp-protocol-version"]


class _CorsSettings(BaseSettings):
    # env_file 은 호출할 때 _env_file 로 넘긴다 (서버마다 패키지 .env 가 다르다).
    model_config = SettingsConfigDict(env_file_encoding="utf-8", extra="ignore")

    mcp_cors_origins: str = ""


def get_cors_origins(env_file: Sequence[str | Path] | None = None) -> list[str]:
    """``MCP_CORS_ORIGINS`` 를 콤마로 분할해 origin 리스트 반환.

    Args:
        env_file: 읽을 ``.env`` 파일들 (뒤가 앞을 덮어씀). 보통 서버 설정의 ``env_files(__file__)`` 이고,
            생략하면 저장소 루트 ``.env`` 만 읽는다. OS 환경 변수는 항상 이 파일들보다 우선한다.

    미설정 또는 빈 문자열이면 개발 기본값 ``["http://localhost:3000"]`` 반환.
    """
    files = tuple(env_file) if env_file is not None else (REPO_ROOT / ".env",)
    raw = _CorsSettings(_env_file=files).mcp_cors_origins.strip()
    if not raw:
        return [_DEFAULT_DEV_ORIGIN]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def build_cors_middleware(env_file: Sequence[str | Path] | None = None) -> Middleware:
    """FastMCP ``mcp.run(..., middleware=[...])`` 에 전달할 CORS 미들웨어 한 건.

    Args:
        env_file: :func:`get_cors_origins` 에 그대로 넘긴다.
    """
    return Middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(env_file),
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
        expose_headers=_EXPOSE_HEADERS,
    )
