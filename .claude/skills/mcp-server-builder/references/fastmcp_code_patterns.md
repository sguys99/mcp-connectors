# FastMCP 코드 패턴

스펙 §5.2 블록을 Python + FastMCP 코드로 옮길 때의 표준 패턴과 그 이유입니다. 그대로 복사할 파일 템플릿은 [server_skeleton.md](server_skeleton.md)에 있고, 이 문서는 "왜 이렇게 쓰는가"와 변형 규칙을 다룹니다. 기준 버전은 FastMCP 3.3.1(`uv run python -c "import fastmcp; print(fastmcp.__version__)"`)입니다.

---

## 1. Tool 함수 표준 형태

스펙 §5.2의 블록 하나가 `tools.py`의 평범한 async 함수 하나가 됩니다. 데코레이터를 붙이지 않고, 등록은 `register_tools()`가 한 곳에서 합니다.

```python
from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from _common.errors import NotFoundError, ResponseTooLargeError
from _common.logging import hash_params, setup_logger
from _common.masking import mask_pii
from _common.trust import wrap_untrusted
from code_repo_mcp.state import get_backend

logger = setup_logger("code-repo-mcp")

MAX_FILE_BYTES = 5 * 1024 * 1024


async def get_file_content(
    repository_id: Annotated[str, Field(description="Repository ID returned by list_repositories")],
    path: Annotated[str, Field(description="File path from the repository root (not a directory)")],
    revision: Annotated[
        str | None, Field(description="Revision (commit SHA or branch). Default: default branch")
    ] = None,
) -> dict[str, Any]:
    """Return the full content of one file at a given revision.
    Use it when a diff is not enough and you need the surrounding unchanged code.
    Do not use it to find where a string appears; call search_code instead.
    Files over 5 MB return FILE_TOO_LARGE, so check the size first when unsure.
    Example: "show login.py" -> get_file_content(repository_id="repo-alpha", path="src/login.py")
    """
    logger.info("get_file_content called", extra={"params_hash": hash_params({"path": path})})
    content, size = await get_backend().get_file_content(repository_id, path, revision)
    if size > MAX_FILE_BYTES:
        raise ResponseTooLargeError(
            f"The file is {size / 1024 / 1024:.1f} MB, over the 5 MB limit. "
            "Use search_code to read only the matching lines. [FILE_TOO_LARGE]"
        )
    return wrap_untrusted(
        metadata={"repository_id": repository_id, "path": path, "revision": revision, "size": size},
        untrusted_content={"content": mask_pii(content)},
    )
```

**체크리스트** (모든 도구):

- [ ] `async def`, 데코레이터 없음. 백엔드는 `get_backend()`로 꺼냄 (`server.py`를 import하지 않음)
- [ ] 파라미터는 `Annotated[type, Field(description=...)]`, 기본값은 시그니처에 둠 (`Field(default=...)` 금지)
- [ ] 필수 Y는 기본값 없음, N은 `= None` 또는 스펙에 적힌 기본값
- [ ] docstring = §5.2 LLM Description 4요소, **영어** (§6 참조). Google 스타일 `Args:` 섹션은 넣지 않음 (파라미터 설명은 `Field`가 이미 노출)
- [ ] 입력 검증과 크기 제한은 함수 안에서, 에러는 `_common.errors` 서브클래스 + 메시지 끝 `[CODE]`
- [ ] 외부 텍스트는 `mask_pii` 후 `wrap_untrusted(metadata=..., untrusted_content=...)`
- [ ] 호출 로그는 `hash_params`로 파라미터 원문 대신 해시만

---

## 2. 등록: `register_tools()`와 annotations

```python
_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True}

TOOLS = (
    (list_repositories, _READ_ONLY),
    (get_file_content, _READ_ONLY),
    (search_code, {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": False}),
)


def register_tools(mcp: FastMCP) -> FastMCP:
    for fn, hints in TOOLS:
        mcp.tool(fn, annotations=hints)
    return mcp
```

- §5.1 Hint 칼럼(`readOnly`, `destructive`, `idempotent`)을 그대로 옮깁니다. 표에 `Read/Write` 칼럼만 있으면 Read는 위 `_READ_ONLY`, Write는 [spec-writer fastmcp_patterns.md §2](../../mcp-spec-writer/references/fastmcp_patterns.md) 표를 따릅니다.
- **왜 데코레이터를 쓰지 않는가**: `@mcp.tool`을 쓰려면 `tools.py`가 `server.py`의 `mcp`를 import해야 하고, `server.py`는 도구 등록을 위해 `tools.py`를 import해야 해서 순환이 생깁니다 (`# noqa: E402`를 부르는 원인). 평범한 함수 + `register_tools()` + `state.py`면 순환이 없고, 단위 테스트가 함수를 바로 부를 수 있습니다. starter, mock_repo, nl2sql 세 서버가 모두 이 방식입니다.
- 루프 변수 이름을 `annotations`로 쓰지 않습니다 (`from __future__ import annotations`를 가려 ruff F402).

---

## 3. 상태와 lifespan

```python
@asynccontextmanager
async def lifespan(app: FastMCP) -> AsyncIterator[None]:
    owned = state.backend is None
    if owned:
        state.backend = build_backend()
    try:
        yield
    finally:
        if owned and state.backend is not None:
            await state.backend.aclose()
            state.backend = None


mcp = register_tools(FastMCP("code-repo-mcp", lifespan=lifespan))
```

- **도구 호출마다 `httpx.AsyncClient()`를 새로 만들지 않습니다.** 연결 풀이 새고 인증 토큰을 매번 다시 받게 됩니다. 클라이언트는 lifespan에서 한 번 만들고 종료 때 닫습니다.
- `owned` 검사는 테스트가 `state.backend`에 미리 넣은 Mock을 lifespan이 덮어쓰거나 닫지 않게 합니다.
- 백엔드 선택은 설정값으로 합니다. `<UPPER_NAME>_BACKEND_URL`이 비어 있으면 Mock이 기본입니다 (mock_repo와 같은 규칙). 그래서 실 연동 정보가 없어도 `make run-<kebab-name>`, Inspector, Chat, 시나리오 러너가 모두 바로 동작합니다.
- 백엔드가 둘 이상이면 `AppState`에 필드를 나누고 lifespan에서 둘 다 열고 닫습니다. Mock 선택도 백엔드마다 따로 합니다 (`<snake_name>_db_dsn`이 비면 DB만 Mock, `<snake_name>_api_url`이 비면 API만 Mock). 하나가 실패해도 다른 하나는 닫히도록 `contextlib.AsyncExitStack`을 써도 됩니다.

---

## 4. Transport와 미들웨어

```python
if args.transport == "stdio":
    mcp.run(transport="stdio")
else:
    mcp.run(
        transport="http",
        host=args.host,
        port=args.port,
        middleware=build_http_middleware(settings.mcp_api_key, env_file=settings.model_config.get("env_file")),
    )
```

- 스펙 §4.1은 기본 transport만 정합니다. 생성 코드는 항상 `--transport stdio|http` 둘 다 지원합니다 (IDE는 stdio, Inspector/Chat/배포는 Streamable HTTP).
- 인증과 CORS는 `_common.auth.build_http_middleware`가 `[CORS, API Key]` 순서로 붙입니다. 도구 함수 안에서 헤더를 검사하지 않습니다. stdio에는 HTTP 계층이 없으므로 영향이 없습니다.
- `MCP_API_KEY`가 비어 있으면 인증이 꺼집니다 (개발 기본값). 운영 배포에서는 반드시 채웁니다.

---

## 5. Resources와 Prompts (스펙에 있을 때만)

스펙 §4.1 "사용 프리미티브"에 Resources나 Prompts가 있거나 §5.3이 있으면 `primitives.py`를 만듭니다. 정본은 `src/mcp-servers/starter_mcp/primitives.py`(함수)와 `server.py`(등록)입니다.

```python
# primitives.py  (이 파일은 from __future__ import annotations 를 쓰지 않음)
import json

from fastmcp.prompts import Message
from pydantic import Field

from _common.trust import wrap_untrusted

SCHEMA_URI = "code-repo://schema"
README_URI_TEMPLATE = "code-repo://repos/{repository_id}/readme"


def schema() -> str:
    return json.dumps({"tools": ["list_repositories", "get_file_content", "search_code"]})


def review_session(
    language: str = Field(description="Programming language of the code"),
) -> list[Message]:
    return [Message(f"You are reviewing {language} code. Ask for the file first.")]
```

```python
# server.py, mcp = register_tools(...) 아래
mcp.resource(SCHEMA_URI, name="schema", description="...", mime_type="application/json")(
    primitives.schema
)
mcp.prompt(name="review_session", description="...")(primitives.review_session)
```

FastMCP 3.3.1에서 확인된 주의점 (starter P5-1 기록):

- prompt 인자는 `str = Field(description=...)`로 선언합니다. `from __future__ import annotations`, `Annotated`, `Literal`을 쓰면 인자 설명에 JSON schema 안내문이 덧붙습니다. 그래서 `primitives.py`는 future import를 쓰지 않습니다.
- URI에 `{param}`이 있으면 resource template이 됩니다. template 함수가 `str`을 반환하면 mime type이 `text/plain`이 되므로, JSON이 필요하면 `fastmcp.resources.ResourceResult`/`ResourceContent`로 mime type을 명시합니다.
- 리소스에 외부 입력(URI 파라미터 등)이 섞이면 `wrap_untrusted`로 감쌉니다.
- 리소스나 프롬프트를 하나라도 등록하면 `initialize` 응답 capabilities에 `resources`/`prompts`가 자동으로 실리고, Inspector의 Resources/Prompts 탭과 `mcp_cli.py list-resources`/`list-prompts`가 바로 동작합니다.

---

## 6. 언어 규칙: LLM에 보이는 문자열은 영어

Phase 4 결정에 따라 **LLM에 노출되는 문자열은 모두 영어**로 씁니다. 스펙이 한국어라도 마찬가지입니다.

| 대상 | 언어 | 스펙이 한국어일 때 |
|---|---|---|
| 도구 docstring (LLM Description) | 영어 | 4요소와 의미를 유지해 번역. 도구 이름, 인자 이름, 예시 호출은 그대로 |
| `Field(description=...)` | 영어 | 번역. 기본값, 최대값, 예시 값은 그대로 |
| 클라이언트로 돌려주는 에러 메시지 | 영어 + `[CODE]` | 원인과 조치를 유지해 번역 |
| Resource/Prompt `description`, 프롬프트 메시지 | 영어 | 번역 |
| 레지스트리 `description` / `description_ko` | 영어 / 한국어 | 둘 다 작성 |
| 코드 주석, 모듈 docstring, 로그 메시지 | 한국어 허용 | 저장소 관례 |
| README | 스펙과 같은 언어 | |
| 식별자 | 영어 snake_case/PascalCase | |

스펙이 영어로 쓰였으면 LLM Description과 메시지를 **그대로** 옮깁니다. 번역했다면 생성 요약에 "LLM 노출 문자열 N건을 영어로 옮김"을 적어 리뷰어가 대조할 수 있게 합니다.

---

## 7. 에러 매핑

```python
from fastmcp.exceptions import ToolError

from _common.errors import (
    AccessDeniedError,  # ACCESS_DENIED
    BackendUnavailableError,  # BACKEND_UNAVAILABLE, *_TIMEOUT
    InvalidInputError,  # INVALID_INPUT
    NotFoundError,  # *_NOT_FOUND
    ResponseTooLargeError,  # *_TOO_LARGE
)

raise AccessDeniedError(
    "You do not have read access to this repository. Ask its owner for access. [ACCESS_DENIED]"
)
raise InvalidInputError("limit must be between 1 and 100. Use offset to page further. [INVALID_INPUT]")
raise ToolError("Invalid regular expression. Retry with is_regex=false. [INVALID_REGEX]")
```

- FastMCP는 `ToolError`를 `isError: true` 응답으로 바꿉니다. 코드 인자가 따로 없으므로 코드는 메시지 끝 `[CODE]`로 전달합니다.
- 백엔드 예외(`httpx.TimeoutException`, DB 드라이버 예외)는 클라이언트 안에서 위 클래스로 바꿉니다. 도구 함수까지 원시 예외가 올라오지 않게 합니다.

---

## 8. 자주 빠지는 함정

- **`from mcp_servers._common ...`**: 존재하지 않는 경로. `from _common.x import ...`
- **`@mcp.tool` + `from <snake_name>.server import mcp`**: 순환 import. `register_tools()` 패턴 사용
- **`settings.transport` 같은 설정으로 transport 선택**: 저장소 서버는 모두 `--transport` 인자를 씁니다. Makefile, 레지스트리, Docker가 이 인자를 전제로 합니다
- **stdout 출력**: stdio 프로토콜이 깨집니다. 로그는 `setup_logger`(stderr)
- **`/health` 라우트 추가**: 저장소에서 쓰지 않습니다. 상태 확인은 `/mcp` 응답으로 합니다
- **Mock 응답 변형**: 스펙 §5.2 예시 값을 바꾸면 스펙과 회귀 테스트가 어긋납니다. 그대로 옮기고 `copy.deepcopy`로 반환
