# FastMCP 구현 패턴 참고

이 문서는 작성하는 요구사항 정의서가 **Python + FastMCP**로 곧바로 구현 가능한 정밀도를 갖도록, 정의서의 각 섹션이 어떤 FastMCP 구성요소와 매핑되는지 설명한다. 이 매핑을 염두에 두고 정의서를 작성하면 개발자/AI가 1:1로 구현할 수 있다.

---

## 1. Tool 정의 → 도구 함수 + Pydantic `Field`

정의서 5.2의 **입력 파라미터 표**는 함수 시그니처의 `Annotated[type, Field(description=...)]`로, **LLM Description**은 docstring으로, 5.1 Hint 칼럼은 등록 시 `annotations`로 옮겨집니다. 이 저장소의 서버는 도구를 데코레이터 없는 함수로 두고 `mcp.tool(fn, annotations=...)`로 등록합니다 (`mcp-server-builder` 스킬이 생성).

```python
from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field


async def get_file_content(
    repository_id: Annotated[str, Field(description="Repository ID returned by list_repositories")],
    path: Annotated[str, Field(description="File path from the repository root (not a directory)")],
    revision: Annotated[str | None, Field(description="Revision. Default: default branch")] = None,
) -> dict[str, Any]:
    """Return the full content of one file at a given revision.
    Use it when a diff is not enough and you need the surrounding unchanged code.
    Do not use it to find where a string appears; call search_code instead.
    Example: "show login.py" -> get_file_content(repository_id="repo-alpha", path="src/login.py")
    """
    ...


mcp = FastMCP("code-repo-mcp")
mcp.tool(
    get_file_content,
    annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True},
)
```

**작성 시 매핑 규칙**:
- docstring 전체가 정의서의 **LLM Description**과 같은 내용이어야 합니다. 사람용 한 줄 설명은 5.1 표와 5.2 "설명"에만 적습니다.
- 입력 파라미터 표의 `description` 칼럼이 `Field(description=...)`로 들어갑니다.
- **필수 Y/N**은 기본값 유무로 표현됩니다 (`= None`이나 `= 20`이 있으면 N).
- 타입(`string`, `int`, `bool`, `ISO8601`, `enum`)은 Python 타입 힌트로 옮겨집니다. `ISO8601`은 `str` 또는 `datetime`, enum은 `Literal[...]`.
- **언어**: 이 저장소는 LLM에 보이는 문자열(LLM Description, 파라미터 description, 에러 메시지)을 영어로 구현합니다. 한국어 정의서는 한국어로 써도 되며 빌더가 의미를 유지해 영어로 옮깁니다. 영어 정의서는 그대로 복사되므로 처음부터 최종 문구로 씁니다.

---

## 2. Tool Annotations → 5.1 Hint 칼럼

정의서 5.1 표의 `readOnly` / `destructive` / `idempotent` 칼럼은 다음 가이드라인을 따른다:

| 백엔드 작업 유형 | readOnly | destructive | idempotent |
|---|---|---|---|
| 조회 (GET, SELECT) | `true` | `false` | `true` |
| 생성 (POST, INSERT) | `false` | `false` | `false` |
| 수정 (PUT/PATCH, UPDATE) | `false` | `true` | `true` (같은 입력 → 같은 상태) |
| 삭제 (DELETE) | `false` | `true` | `true` |
| 검색 (read-only, 비결정적 정렬) | `true` | `false` | `false` |

PoC 단계에서 쓰기 작업을 제외한다면 모든 Tool이 `readOnly: true, destructive: false, idempotent: true`가 된다.

---

## 3. Transport → 4.1 MCP 서버

정의서 4.1의 Transport는 기본값을 정한다. 이 저장소의 서버는 `--transport stdio|http` 인자로 둘 다 지원하고, 4.1 값이 그 기본값이 된다.

```python
mcp.run(transport="http", host="0.0.0.0", port=settings.code_repo_mcp_port)  # Streamable HTTP
mcp.run(transport="stdio")                                                     # IDE 통합
```

엔드포인트는 기본 `http://host:port/mcp`. K8s 등 배포 환경에서는 Ingress/Service가 이 경로를 외부로 노출한다. SSE는 레거시이므로 새 정의서에는 Streamable HTTP 또는 stdio를 적는다.

---

## 4. 에러 응답 → 7장 + 5.2 에러 표

정의서 7장은 "코드만 반환하지 않고 **자연어 원인+조치**를 함께 포함"하라고 명시한다. FastMCP에서는 두 가지 패턴 중 하나로 구현:

**패턴 A (권장)**: 도메인 예외를 raise하고 자연어 메시지를 message에 담는다. FastMCP가 자동으로 `isError: true` 응답으로 변환한다. 이 저장소는 메시지 끝에 `[CODE]` 태그를 붙여 코드를 전달한다 (시나리오 러너와 Frontend가 이 태그를 읽음).

```python
from _common.errors import NotFoundError

if not pr_exists:
    raise NotFoundError("PR 1234 was not found. pr_id must be a numeric string. [PR_NOT_FOUND]")
```

**패턴 B**: 구조화된 에러 dict를 반환.

```python
return {
    "isError": True,
    "code": "FILE_TOO_LARGE",
    "message": "파일 크기가 5MB를 초과합니다(현재 7.2MB). 일부 영역만 필요하면 get_diff 또는 search_code를 사용하세요.",
}
```

5.2의 에러 응답 표(`코드 / 메시지 예시`)는 그대로 위 message 텍스트가 된다. 코드 이름은 `SCREAMING_SNAKE_CASE` 권장 (예: `PR_NOT_FOUND`, `ACCESS_DENIED`, `FILE_TOO_LARGE`).

---

## 5. 응답 크기 제어 → 5.2 + 6.1

정의서 6.1은 응답을 바이트와 토큰 양측면에서 제약하라고 명시한다. 5.2 각 Tool의 "응답 크기 제어" 항목은 다음 패턴 중 하나로 구현:

- **`limit` + `offset`** (정수 페이지네이션): 단순 리스트
- **`cursor`** (불투명 문자열): 다음 페이지 토큰을 응답에 포함, 다음 호출 입력으로 전달
- **`include_diff: bool`** 같은 토글: 비싼 필드 제외해 응답 축소

토큰 한도 측정은 응답 직렬화 후 tiktoken 등으로 추정. 한도 초과 시 `cursor` 반환하거나 `*_TOO_LARGE` 에러로 반환.

```python
if len(response_json) > 8 * 1024 * 1024:  # 8MB 가드
    raise ToolError("응답이 한도를 초과했습니다. limit를 줄여 다시 시도하세요.")
```

---

## 6. 자격증명 및 인증 → 6.2

정의서 6.2의 "백엔드 자격증명은 Vault/시크릿 매니저에서 주입"은 다음으로 구현:

```python
import os
BACKEND_TOKEN = os.environ["CODE_REPO_PAT"]  # K8s Secret → env로 마운트
```

평문 노출 금지(로그/응답에 마스킹). MCP Agent 인증은 `X-MCP-API-Key` 같은 헤더로 받아 미들웨어에서 검증:

```python
# 이 저장소의 공용 구현: _common/auth.py (ASGI 미들웨어, HTTP transport 전용)
from _common.auth import build_http_middleware

mcp.run(
    transport="http",
    port=settings.port,
    middleware=build_http_middleware(settings.mcp_api_key, env_file=settings.model_config.get("env_file")),  # [CORS, Auth] 순서
)
# 키 불일치 시 401 + JSON-RPC 에러 본문, MCP_API_KEY 미설정 시 자동 비활성
```

---

## 7. 간접 prompt injection 방어 → 6.2

정의서 6.2 "외부 텍스트(파일 본문, 커밋 메시지 등)는 별도 필드로 격리"는 응답 스키마 설계 시 다음과 같이:

```python
return {
    "metadata": {  # 신뢰 가능 (MCP가 생성)
        "path": "/src/auth/login.java",
        "revision": "r2451",
        "size": 4823,
    },
    "untrusted_content": {  # 외부 시스템에서 온 내용
        "content": file_text,
        "commit_message": msg,
    },
}
```

키 이름 자체(`untrusted_*`)로 LLM이 신뢰 경계를 인식할 수 있게 한다.

---

## 8. 민감정보 마스킹 → 6.2

```python
# 이 저장소의 PII 정규식 정본: _common/masking.py (카드, 주민번호, 긴 숫자열, 이메일, 전화, 계좌)
from _common.masking import mask_pii

clean = mask_pii(file_text)
```

정의서에 새 PII 유형이 필요하면 서버 안에 정규식을 따로 두지 말고 `_common/masking.py::PII_RULES` 에 추가하도록 적습니다. 사번 같은 식별자 익명화는 요구될 때만 해당 서버에 구현해요.

---

## 9. 재시도 및 Circuit Breaker → 7장

```python
import httpx
from _common.retry import with_backoff  # tenacity AsyncRetrying 래퍼

async for attempt in with_backoff(max_attempts=2, retry_on=(httpx.TransportError,)):
    with attempt:
        response = await http.get(url)
```

Circuit Breaker는 `purgatory` 또는 자체 카운터로 구현. 10초 내 5회 실패 → 30초 차단.

---

## 10. 정의서 ↔ FastMCP 매핑 체크리스트

정의서 작성 시 각 Tool에 대해 다음이 모두 정의되어 있는지 확인. 누락되면 개발자가 추측해야 한다.

- [ ] Tool 이름 (`snake_case`)
- [ ] LLM Description (3~7줄, "언제 호출/언제 안 함/대체 Tool" 포함)
- [ ] 입력 파라미터: 이름 / 타입 / 필수 여부 / description
- [ ] 출력 JSON 스키마 (예시 1개 이상)
- [ ] 빈 결과 처리 명시
- [ ] 응답 크기 제어 (`limit`/`cursor`/`include_*` 등)
- [ ] 에러 코드 + 자연어 메시지 (`*_NOT_FOUND`, `ACCESS_DENIED`, `INVALID_INPUT` 최소)
- [ ] Annotations 3종 (`readOnly`/`destructive`/`idempotent`)
