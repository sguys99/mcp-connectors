# `_common/` 공유 모듈 명세

`src/mcp-servers/_common/`은 모든 서버가 함께 쓰는 공유 유틸입니다. 스펙 §6.2, §6.3, §7이 모든 MCP 서버에 같은 요건(인증, 마스킹, 신뢰 경계, 로깅, 재시도)을 걸기 때문에 서버마다 다시 구현하지 않고 이 패키지를 가져다 씁니다.

> **정본은 저장소의 실제 코드입니다.** 이 저장소에는 `_common/`이 이미 있으므로 스킬은 **아무것도 생성하거나 고치지 않고 import만 합니다.** 아래 코드 블록은 `_common/`이 없는 새 저장소에 이 컨벤션을 옮길 때 그대로 복사하는 용도이며, 2026-10-23 기준 `src/mcp-servers/_common/*.py`와 글자 단위로 같습니다. 둘이 다르면 저장소 코드를 따르세요.

## 폴더 구조 (모듈 8개 + `__init__.py`)

```
src/mcp-servers/_common/
├── __init__.py
├── auth.py      # X-MCP-API-Key ASGI 미들웨어 + build_http_middleware (HTTP transport 전용)
├── cors.py      # 브라우저 직결용 CORS 미들웨어 (MCP_CORS_ORIGINS)
├── env.py       # config.py 의 env_file 절대 경로 (루트 .env, 패키지 .env)
├── errors.py    # ToolError 서브클래스 5종
├── logging.py   # JSON 구조화 로깅(stderr), 파라미터 해시
├── masking.py   # PII 정규식 정본 (PII_RULES, mask_pii)
├── retry.py     # tenacity AsyncRetrying 래퍼 (with_backoff)
└── trust.py     # wrap_untrusted (신뢰 경계)
```

각 모듈의 회귀 테스트는 `tests/_common/test_<module>.py`에 있습니다.

## import 방식

폴더 이름 `mcp-servers`에 하이픈이 있어 Python 패키지 경로로 쓸 수 없습니다. 그래서 `src/mcp-servers`를 import 루트로 두고, 그 아래 `_common`과 각 서버 패키지를 최상위 패키지처럼 가져옵니다.

```python
from _common.errors import NotFoundError          # O
from mcp_servers._common.errors import ...        # X (존재하지 않는 경로)
```

이 경로가 잡히는 곳은 세 군데입니다.

| 실행 경로 | 설정 |
|---|---|
| pytest | `pyproject.toml` `[tool.pytest.ini_options]`의 `pythonpath = [".", "src/mcp-servers"]`, `addopts = "--import-mode=importlib ..."`, `asyncio_mode = "auto"` (이미 설정됨) |
| 서버 실행 | `cd src/mcp-servers && uv run python -m <snake_name>.server` (Makefile 타깃이 이 형태) |
| CLI와 시나리오 러너 | `scripts/mcp_cli.py`가 stdio 서버를 `cwd=src/mcp-servers`로 띄움 |

ruff의 isort는 `src/mcp-servers` 아래 패키지를 스스로 찾지 못하므로 `[tool.ruff.lint.isort] known-first-party`에 새 서버 패키지 이름을 **반드시 추가**해야 합니다. 빠뜨리면 `from <snake_name>.x import ...`가 서드파티로 분류돼 `I001`이 납니다.

```toml
[tool.ruff.lint.isort]
known-first-party = ["_common", "starter_mcp", "mock_repo_mcp", "nl2sql_mcp", "<snake_name>"]
```

의존 방향은 `<각 서버> → _common` 한쪽뿐입니다. `_common` 안에서 서버 모듈을 import하지 않습니다.

---

## 1. `logging.py`

```python
"""구조화 로깅. JSON 포맷, 파라미터 자동 해싱."""

from __future__ import annotations

import hashlib
import json
import logging
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # extra 필드 병합
        for key, value in record.__dict__.items():
            if key in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "message",
                "module",
                "msecs",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "thread",
                "threadName",
            }:
                continue
            payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def setup_logger(server_name: str) -> logging.Logger:
    """서버명 기반 logger를 반환. JSON 포맷, 중복 등록 방지."""
    logger = logging.getLogger(server_name)
    if logger.handlers:
        return logger
    # ponytail: stdio MCP transport은 stdout을 JSONRPC 전용으로 예약하므로 stderr로 출력
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def hash_params(params: dict[str, Any]) -> str:
    """입력 파라미터 dict의 SHA256 short hash. 민감정보 원문 저장 방지용."""
    blob = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]
```

**사용**:
```python
from _common.logging import hash_params, setup_logger

logger = setup_logger("<kebab-name>")
logger.info("get_file_content called", extra={"params_hash": hash_params({"path": path})})
```

핸들러는 **stderr**에 씁니다. stdio transport는 stdout을 JSON-RPC 전용으로 쓰므로 stdout에 로그를 찍으면 프로토콜이 깨집니다. 서버 코드에서 `print()`도 쓰지 마세요.

---

## 2. `masking.py`

```python
"""민감정보(PII) 마스킹 정규식의 정본.

모든 서버는 이 모듈의 :data:`PII_RULES` 와 :func:`mask_pii` 만 씁니다. 서버 안에서 PII 정규식을
따로 정의하지 않아요 (NL2SQL 결과 마스킹도 여기서 가져갑니다).

규칙은 위에서부터 순서대로 적용합니다. 앞 규칙이 바꾼 문자열은 뒤 규칙이 다시 보지 않으므로
더 구체적인 패턴(카드, 주민번호)을 일반적인 패턴(긴 숫자열)보다 앞에 둡니다.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import NamedTuple


class PiiRule(NamedTuple):
    """마스킹 규칙 한 건. ``replacement`` 는 :meth:`re.Pattern.sub` 에 그대로 넘깁니다."""

    name: str
    pattern: re.Pattern[str]
    replacement: str | Callable[[re.Match[str]], str]


# 카드번호: 4-4-4-4 (하이픈, 공백, 붙여 쓰기 모두)
CARD_NUMBER = re.compile(r"\b(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})[-\s]?(\d{4})\b")
# 주민등록번호: 6-7 (하이픈 생략 허용)
RESIDENT_ID = re.compile(r"\b(\d{6})-?(\d{7})\b")
# 하이픈 없는 10~14자리 숫자열 (Pagila 처럼 붙여 쓴 전화번호 등)
LONG_DIGITS = re.compile(r"(?<!\d)(\d{10,14})(?!\d)")
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# 국내 전화번호: 0으로 시작하는 지역/이동통신 번호, 국번 이후만 가림
PHONE = re.compile(r"\b(0\d{1,2})-?(\d{3,4})-?(\d{4})\b")
# 계좌번호: 3~4 / 3~6 / 5~8 자리 하이픈 구분 (예: 110-123-456789)
ACCOUNT_NUMBER = re.compile(r"\b\d{3,4}-\d{3,6}-\d{5,8}\b")

PII_RULES: tuple[PiiRule, ...] = (
    PiiRule("card_number", CARD_NUMBER, "**** **** **** ****"),
    PiiRule("resident_id", RESIDENT_ID, "******-*******"),
    PiiRule("long_digits", LONG_DIGITS, lambda m: "*" * len(m.group())),
    PiiRule("email", EMAIL, "***@***.***"),
    PiiRule("phone", PHONE, r"\1-****-****"),
    PiiRule("account_number", ACCOUNT_NUMBER, "***-***-***"),
)


def mask_pii(text: str) -> str:
    """텍스트에서 :data:`PII_RULES` 의 패턴을 순서대로 마스킹합니다."""
    for rule in PII_RULES:
        text = rule.pattern.sub(rule.replacement, text)
    return text
```

PII 정규식의 **정본**입니다. 서버 안에 PII 정규식을 따로 두지 말고 `PII_RULES`/`mask_pii`를 가져다 씁니다. 새 PII 유형이 필요하면 서버가 아니라 이 모듈의 `PII_RULES`에 추가하고 `tests/_common/test_masking.py`에 케이스를 더합니다.

**사용**:
```python
from _common.masking import mask_pii

clean = mask_pii(external_text)  # 외부 텍스트를 응답에 싣기 직전
```

사번 같은 식별자 익명화 헬퍼는 두지 않습니다. 스펙 §6.2가 요구할 때만 해당 서버 안에 구현합니다.

---

## 3. `trust.py`

```python
"""신뢰 경계 헬퍼. 외부 텍스트를 untrusted_content 필드로 격리."""

from __future__ import annotations

from typing import Any


def wrap_untrusted(
    metadata: dict[str, Any],
    untrusted_content: dict[str, Any],
) -> dict[str, Any]:
    """MCP 응답을 신뢰 경계 분리 형태로 감싼다.

    - metadata: MCP 서버가 생성한 신뢰 가능 데이터 (경로, 크기, 리비전 ID 등)
    - untrusted_content: 외부 시스템에서 온 텍스트 (파일 본문, 커밋 메시지, 사용자 입력 등)
      LLM이 이 필드의 내용을 명령으로 해석하지 않도록 시스템 프롬프트에서 명시해야 함 (Agent 측 책임).
    """
    return {"metadata": metadata, "untrusted_content": untrusted_content}
```

**사용**: 외부 시스템에서 온 텍스트(파일 본문, 커밋 메시지, 검색 결과, 사용자가 넣은 문자열)는 항상 `untrusted_content` 쪽에 담습니다.
```python
from _common.trust import wrap_untrusted

return wrap_untrusted(
    metadata={"path": path, "revision": rev, "size": size},
    untrusted_content={"content": file_text},
)
```

---

## 4. `retry.py`

```python
"""백엔드 호출 재시도 (tenacity 기반 지수 백오프).

사용처: ``mock_repo_mcp/client.py::HttpBackendClient`` 가 네트워크 오류와 5xx/429 를 재시도할 때 씁니다.
``retry_on`` 에는 재시도해도 안전한 일시 장애 예외만 넣으세요 (4xx 같은 영구 오류는 넣지 않음).
"""

from __future__ import annotations

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


def with_backoff(
    max_attempts: int = 2,
    initial_wait: float = 1.0,
    max_wait: float = 4.0,
    retry_on: tuple[type[Exception], ...] = (Exception,),
):
    """tenacity AsyncRetrying을 반환하는 helper. 사용:

    async for attempt in with_backoff():
        with attempt:
            result = await call_backend()
    """
    return AsyncRetrying(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=initial_wait, max=max_wait),
        retry=retry_if_exception_type(retry_on),
        reraise=True,
    )
```

**사용** (실 구현 예시는 `src/mcp-servers/mock_repo_mcp/client.py::HttpBackendClient`):
```python
async for attempt in with_backoff(retry_on=(httpx.TransportError, _RetryableStatusError)):
    with attempt:
        response = await http.get(path, params=query)
        if response.status_code >= 500 or response.status_code == 429:
            raise _RetryableStatusError(response)  # 5xx/429 만 재시도
# 재시도 소진 시 BackendUnavailableError("... [BACKEND_UNAVAILABLE]")로 바꾸고, 404 는 NotFoundError
```

Circuit Breaker는 기본으로 넣지 않습니다(PoC 단순화). 스펙 §7이 명시할 때만 별도 구현하며 후보는 `purgatory`, `pybreaker`입니다.

---

## 5. `cors.py`

```python
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
```

---

## 6. `auth.py`

```python
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
```

**server.py 연결** (HTTP 분기에서만, stdio는 영향 없음):
```python
from _common.auth import build_http_middleware

mcp.run(
    transport="http",
    host=args.host,
    port=args.port,
    # [CORS, Auth] 순서 고정. env_file 을 넘기면 MCP_CORS_ORIGINS 도 설정과 같은 .env 를 읽는다
    middleware=build_http_middleware(settings.mcp_api_key, env_file=settings.model_config.get("env_file")),
)
```

**주의**:
- 순서가 `[Auth, CORS]`로 뒤집히면 401 응답에 CORS 헤더가 빠져 브라우저가 에러 원인을 읽지 못합니다. 항상 `build_http_middleware`를 쓰세요.
- 키는 `os.environ`이 아니라 `settings.mcp_api_key`로 넘깁니다. `.env`에만 적힌 값은 OS 환경 변수에 없기 때문입니다.
- 401 본문은 영어(`Authentication failed: ...`)이고 JSON-RPC 에러 코드는 `-32001`입니다.
- 클라이언트(CLI, Frontend 프록시)는 같은 키를 `X-MCP-API-Key` 헤더로 보냅니다. `scripts/mcp_cli.py`와 레지스트리 `headers`가 `MCP_API_KEY`를 자동으로 붙입니다.

---

## 7. `env.py`

```python
"""서버 설정용 `.env` 파일 경로 해석.

pydantic-settings 의 ``env_file=".env"`` 는 실행 디렉터리(CWD) 기준이라, IDE 의 stdio 실행,
``cd src/mcp-servers`` 실행, 저장소 루트의 pytest 실행마다 서로 다른 파일을 읽었습니다.
이 모듈은 ``Path(__file__).resolve()`` 로 절대 경로를 계산해 어디서 실행하든 같은 파일을 읽게 합니다.

읽는 순서 (뒤가 앞을 덮어씀, OS 환경 변수는 항상 최우선):

1. 저장소 루트 ``.env`` (단일 사실 출처, 정본 항목은 루트 ``.env.example``)
2. 서버 패키지 안의 ``.env`` (선택, 해당 서버만 값을 바꾸고 싶을 때 쓰는 override)

없는 파일은 pydantic-settings 가 조용히 건너뛰므로 둘 다 없어도 기본값으로 동작해요.
"""

from __future__ import annotations

from pathlib import Path

# src/mcp-servers/_common/env.py 기준 parents[3] = 저장소 루트 (Docker 에서는 /app)
REPO_ROOT = Path(__file__).resolve().parents[3]


def env_files(config_file: str | Path, repo_root: Path | None = None) -> tuple[Path, Path]:
    """``(루트 .env, 패키지 .env)`` 절대 경로 튜플을 반환한다.

    Args:
        config_file: 호출하는 서버의 ``config.py`` 경로. 보통 ``__file__`` 을 넘깁니다.
        repo_root: 저장소 루트. 테스트에서만 지정하고, 생략하면 :data:`REPO_ROOT` 를 씁니다.
    """
    root = (repo_root or REPO_ROOT).resolve()
    package_dir = Path(config_file).resolve().parent
    return (root / ".env", package_dir / ".env")
```

**사용** (`config.py`):
```python
from pydantic_settings import BaseSettings, SettingsConfigDict

from _common.env import env_files


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=env_files(__file__),
        env_file_encoding="utf-8",
        extra="ignore",
    )
```

`env_file=".env"` 같은 상대 경로는 실행 디렉터리(CWD) 기준이라 IDE stdio 실행과 `make` 실행이 서로 다른 `.env`를 읽습니다. 그래서 항상 `env_files(__file__)`를 씁니다. 공용 값(`MCP_API_KEY`, `MCP_CORS_ORIGINS`, 포트)의 정본은 루트 `.env.example`입니다.

---

## 8. `errors.py`

```python
"""공통 에러 클래스. ToolError 기반."""

from __future__ import annotations

from fastmcp.exceptions import ToolError


class InvalidInputError(ToolError):
    """INVALID_INPUT 코드 대응."""


class NotFoundError(ToolError):
    """*_NOT_FOUND 코드 대응 (파일/리비전/엔티티 등)."""


class AccessDeniedError(ToolError):
    """ACCESS_DENIED 코드 대응."""


class BackendUnavailableError(ToolError):
    """BACKEND_UNAVAILABLE / *_TIMEOUT 코드 대응."""


class ResponseTooLargeError(ToolError):
    """*_TOO_LARGE 코드 대응."""
```

스펙 에러 코드와의 대응:

| 스펙 코드 | 클래스 |
|---|---|
| `INVALID_INPUT` | `InvalidInputError` |
| `*_NOT_FOUND` | `NotFoundError` |
| `ACCESS_DENIED` | `AccessDeniedError` |
| `BACKEND_UNAVAILABLE`, `*_TIMEOUT` | `BackendUnavailableError` |
| `*_TOO_LARGE` | `ResponseTooLargeError` |
| 도메인 고유 코드 (`INVALID_REGEX` 등) | `fastmcp.exceptions.ToolError` 직접 |

**메시지 규칙**: LLM에 그대로 보이므로 **영어**로 쓰고, 원인과 다음 조치를 한 문장에 담은 뒤 끝에 `[CODE]` 태그를 붙입니다. 시나리오 러너(`mcp_cli.py test`)의 `expect.error_code`와 Frontend가 이 태그로 코드를 읽습니다.

```python
raise NotFoundError(
    f"File '{path}' was not found at revision {rev}. Call list_files to check the path. [FILE_NOT_FOUND]"
)
```

---

## 9. `__init__.py`

```python
"""공유 유틸 모음. _common.<module>로 import."""
```

---

## 10. 사용 위치 요약

| 모듈 | 사용 위치 | 빈도 |
|---|---|---|
| `logging.setup_logger` | `tools.py`, `server.py` 모듈 상단 | 모듈당 1회 |
| `logging.hash_params` | 각 도구의 호출 로그 | 도구마다 |
| `masking.mask_pii` | 외부 텍스트를 응답에 싣기 직전 | 자주 |
| `trust.wrap_untrusted` | 외부 텍스트가 들어간 응답 | 거의 모든 외부 텍스트 응답 |
| `retry.with_backoff` | `HttpBackendClient` 호출 | 백엔드 호출마다 |
| `env.env_files` | `config.py` | 서버당 1회 |
| `auth.build_http_middleware` | `server.py` HTTP 분기 | 서버당 1회 |
| `errors.*` | 도구와 클라이언트의 raise | 자주 |

`cors.build_cors_middleware`는 `build_http_middleware`가 대신 부르므로 서버에서 직접 쓸 일은 없습니다.

---

## 11. 자주 빠지는 함정

- **import 실패**: `from mcp_servers._common...`처럼 하이픈 폴더를 경로에 넣었거나, `src/mcp-servers` 밖에서 `python -m`을 실행함
- **ruff I001**: `known-first-party`에 새 서버 패키지를 넣지 않음
- **테스트 패키지 충돌**: `tests/<snake_name>/__init__.py`를 만듦. importlib 모드에서 `src/mcp-servers/<snake_name>`과 이름이 겹치므로 만들지 않습니다
- **stdio 프로토콜 깨짐**: stdout에 로그나 `print()` 출력
- **순환 import**: `_common`이 서버 모듈을 import함. 의존은 한 방향
- **인증이 안 걸림**: stdio에는 원래 인증이 없음. HTTP 분기에서 `middleware=`를 빠뜨렸는지 확인
