# Spec Parsing: 10섹션 정의서에서 구조화 데이터 추출

`docs/mcp-spec/<name>_v0.X.md` 정의서에서 코드 생성에 필요한 정보를 뽑는 규칙입니다. `mcp-spec-writer`가 만드는 정의서는 한국어판 [template_v2.md](../../mcp-spec-writer/references/template_v2.md) 또는 영어판 [template_v2.en.md](../../mcp-spec-writer/references/template_v2.en.md) 구조를 따르므로 둘 다 받아들입니다.

---

## 1. 유효성 체크리스트 (Phase 1)

다음 헤딩이 **모두** 있어야 합니다. 한국어와 영어 중 어느 쪽이든 되고, 한 문서 안에서 섞여 있어도 됩니다. 번호(`## 5.`, `### 5.2`)로 먼저 찾고 제목은 아래 둘 중 하나와 맞으면 통과로 봅니다.

| 번호 | 한국어 헤딩 | 영어 헤딩 |
|---|---|---|
| §0 | `## 0. 문서 정보` | `## 0. Document Info` |
| §1 | `## 1. 개요` | `## 1. Overview` |
| §2 | `## 2. 범위` | `## 2. Scope` |
| §3 | `## 3. 사용자 및 주요 시나리오` | `## 3. Users and Key Scenarios` |
| §4 | `## 4. 시스템 구성` | `## 4. System Architecture` |
| §4.1 | `### 4.1 MCP 서버` | `### 4.1 MCP Server` |
| §4.2 | `### 4.2 연동 백엔드 시스템` | `### 4.2 Backend Systems` |
| §5 | `## 5. 기능 요구사항 (Tools)` | `## 5. Functional Requirements (Tools)` |
| §5.1 | `### 5.1 Tool 목록 (요약)` | `### 5.1 Tool List (Summary)` |
| §5.2 | `### 5.2 Tool 상세 명세` | `### 5.2 Tool Details` |
| §6 | `## 6. 비기능 요구사항` | `## 6. Non-functional Requirements` |
| §7 | `## 7. 에러 처리` | `## 7. Error Handling` |

추가로 §5.2 안에 `#### ▶ T-NN \`tool_name\`` 블록이 **1개 이상** 있어야 합니다 (영어판도 같은 표기). §8~§10은 코드 생성에 쓰지 않으므로 없어도 거부하지 않고 경고만 합니다.

거부 메시지 예: `"이 정의서는 10섹션 표준을 따르지 않습니다(누락: §5.2, T-블록). /mcp-spec-writer로 보강한 뒤 다시 시도하세요."` 사용자가 영어로 요청했으면 영어로 안내합니다.

---

## 2. §0 서버명 추출

§0 표의 "서버명"(Server name) 행 또는 §1.1의 **서버명** 항목을 찾습니다. 형식은 `code-repo-mcp` 같은 kebab-case입니다.

**필수 변환** (넷 다 보관):

| 이름 | 예시 | 규칙 | 쓰는 곳 |
|---|---|---|---|
| `kebab-name` | `code-repo-mcp` | 원본 | FastMCP 이름, 레지스트리, Makefile 타깃, README |
| `snake_name` | `code_repo_mcp` | `kebab.replace("-", "_")` | 패키지 폴더, import, 설정 필드 접두사, 테스트 폴더 |
| `UPPER_NAME` | `CODE_REPO_MCP` | `snake.upper()` | 환경 변수 |
| `ClassPrefix` | `CodeRepoMcp` | PascalCase | 필요할 때만 |

`-mcp` 접미사가 없으면 붙일지 사용자에게 묻지 말고 원본을 그대로 씁니다.

---

## 3. §4.1 Transport 추출

| 스펙 표기 | `--transport` 기본값 | 비고 |
|---|---|---|
| `Streamable HTTP` | `http` | stdio도 함께 지원 |
| `stdio` | `stdio` | HTTP도 함께 지원 |
| `SSE` | `http` | SSE는 레거시. Streamable HTTP로 대체하고 `# TODO(스펙 미정: §4.1 SSE 필요 여부)` |
| 없음, "확인 필요" | Phase 3 질의 | 답이 없으면 `http` |

"사용 프리미티브"(Primitives) 행에 Resources나 Prompts가 있으면 `primitives.py`를 만듭니다 (§6.7).

---

## 4. §4.2 백엔드 시스템 추출

| 행 | 추출 | 미정 처리 |
|---|---|---|
| 시스템명 | README와 모듈 docstring | - |
| 엔드포인트 | `<UPPER_NAME>_BACKEND_URL` 기본값은 항상 빈 값(Mock) | `**확인 필요**`면 `# TODO(스펙 미정: §4.2 엔드포인트)` |
| 프로토콜 | 클라이언트 구현 선택 (REST/CLI/DB) | `**확인 필요**`면 Phase 3 질의 |
| 인증 방식 | `HttpBackendClient` 헤더, env 키 | `**확인 필요**`면 Phase 3 질의, 답이 없으면 Bearer + TODO |
| 권한 모델 | Read-only 여부 (도구 annotations와 대조) | - |
| 네트워크 | README 참고 메모 | - |

백엔드가 여럿이면(예: Oracle + REST) 백엔드마다 Protocol, Mock, 실 클라이언트를 따로 두고 `AppState`에 필드를 나눕니다. env 키도 `<UPPER_NAME>_DB_DSN`, `<UPPER_NAME>_API_URL`처럼 구분합니다.

---

## 5. §5.1 Tool 목록 표 추출

```markdown
| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `list_repositories` | 접근 가능한 저장소 목록 조회 | true | false | true |
```

- `tool_id`, `tool_name`(백틱 제거), `human_description`(README 표용, 스펙 언어 그대로)
- `hints = {"readOnlyHint": ..., "destructiveHint": ..., "idempotentHint": ...}` → `TOOLS` 튜플의 두 번째 값
- Hint 칼럼 대신 `Read/Write` 칼럼만 있으면 Read는 `{True, False, True}`, Write는 생성/수정/삭제 성격에 따라 spec-writer `fastmcp_patterns.md §2` 표를 따릅니다

**Tool 개수에 따른 파일 배치**:

| 개수 | 배치 |
|---|---|
| 1~4 | `tools.py` 하나 (함수 + `TOOLS` + `register_tools`) |
| 5~10 | `tools/` 패키지, 그룹 모듈(`files.py`, `search.py` 등) + `tools/__init__.py`에 `TOOLS`와 `register_tools` |
| 11+ | `tools/<tool_name>.py` 1파일 1도구 + `tools/__init__.py` |

5~10개의 그룹은 동사 접두사(`list_*`, `get_*`, `search_*`)나 §3 UC 매핑으로 묶습니다.

---

## 6. §5.2 Tool 상세 블록 추출

블록 형태 (영어판은 `Description`, `LLM Description`, `Input parameters`, `Output example (JSON)`, `Empty result`, `Response size control`, `Error responses`):

````
#### ▶ T-NN `tool_name`

- **설명**: ...
- **LLM Description**
  ```
  (여러 줄)
  ```
- **입력 파라미터**
  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
- **출력 예시 (JSON)**
  ```json
  { ... }
  ```
- **빈 결과**: ...
- **응답 크기 제어**: ...
- **에러 응답**
  | 코드 | 메시지 예시 |
````

### 6.1 LLM Description → docstring

코드 펜스 안의 내용을 docstring으로 씁니다. **영어로 씁니다.** 스펙이 영어면 그대로, 한국어면 4요소(무엇, 언제, 언제 쓰지 말 것, 호출 예시)와 대체 도구 이름을 유지해 번역합니다. 호출 예시의 도구 이름과 인자는 바꾸지 않습니다. 규칙 전체는 [fastmcp_code_patterns.md §6](fastmcp_code_patterns.md).

### 6.2 입력 파라미터 표 → `Annotated[..., Field(description=...)]`

| 스펙 타입 | Python 타입 힌트 |
|---|---|
| `string` | `str` |
| `int` / `integer` | `int` |
| `bool` / `boolean` | `bool` |
| `float` / `number` | `float` |
| `ISO8601` | `str` (형식 검증이 필요하면 `datetime`) |
| `enum(a,b)` | `Literal["a", "b"]` |
| `dict` / `object` | `dict[str, Any]` |
| `list[X]` / `array` | `list[X]` |

- 필수 `Y`는 기본값 없음, `N`은 `= None`(타입 `X | None`) 또는 description에 적힌 기본값
- description 칼럼은 영어로 `Field(description=...)`에 넣습니다 (스펙이 한국어면 번역). 기본값, 최대값, 예시 값은 그대로
- 따옴표가 든 description은 바깥을 작은따옴표로 감싸 이스케이프를 피합니다

```python
async def list_repositories(
    name_pattern: Annotated[
        str | None, Field(description='Repository name filter (SQL LIKE, e.g. "billing_%")')
    ] = None,
    limit: Annotated[int, Field(description="Maximum number of results. Default 20, max 100")] = 20,
    offset: Annotated[int, Field(description="Pagination offset. Default 0")] = 0,
) -> dict[str, Any]:
    """..."""
```

### 6.3 출력 예시 JSON → `MockBackendClient`

` ```json ``` ` 블록을 값 그대로 Mock 응답(dict literal 또는 모듈 상수)으로 옮깁니다. 그래야 데모와 Inspector가 실제처럼 응답하고, 테스트의 기준이 스펙과 같아집니다. `timestamp` 같은 동적 필드도 그대로 하드코딩하고, 테스트는 값 대신 키 존재를 봅니다. 출력 JSON에 `metadata`/`untrusted_content`가 있으면 도구에서 `wrap_untrusted`로 같은 모양을 만듭니다.

### 6.4 빈 결과

기본 응답만 Mock에 두고, 빈 결과가 입력으로 재현되면(존재하지 않는 필터 등) Mock이 빈 배열을 돌려주게 합니다. 재현이 어려우면 단위 테스트에서 Mock 메서드를 바꿔 확인합니다.

### 6.5 응답 크기 제어

- `limit` 최대값 → 도구 안 입력 검증 (`InvalidInputError(... [INVALID_INPUT])`)
- `cursor` → 응답에 `next_cursor` 키 (Mock은 `None`)
- `*_TOO_LARGE` 조건 → 크기 측정 후 `ResponseTooLargeError(... [<CODE>])`

### 6.6 에러 응답 표 → `_common.errors`

| 스펙 코드 | 클래스 |
|---|---|
| `*_NOT_FOUND` | `NotFoundError` |
| `ACCESS_DENIED` | `AccessDeniedError` |
| `INVALID_INPUT` | `InvalidInputError` |
| `BACKEND_UNAVAILABLE`, `*_TIMEOUT` | `BackendUnavailableError` |
| `*_TOO_LARGE` | `ResponseTooLargeError` |
| 도메인 고유 (`INVALID_REGEX` 등) | `fastmcp.exceptions.ToolError` |

메시지는 스펙 표의 문장을 영어로 옮기고(영어 스펙이면 그대로) 끝에 `[<CODE>]`를 붙입니다. 테스트와 시나리오 YAML은 이 태그로 코드를 검증합니다.

### 6.7 (선택) §5.3 Resources / Prompts

스펙에 `### 5.3 Resources / Prompts`가 있으면 표의 URI, 이름, mime type, 설명(영어), 프롬프트 인자를 `primitives.py`와 `server.py` 등록으로 옮깁니다. 패턴은 [fastmcp_code_patterns.md §5](fastmcp_code_patterns.md), 정본은 `starter_mcp/primitives.py`입니다. 테스트는 `tests/starter_mcp/test_primitives.py`처럼 `list_resources`, `read_resource`, `list_prompts`, `get_prompt`를 in-memory client로 확인합니다.

---

## 7. §6.2 → 인증, 마스킹, 신뢰 경계

- MCP 인증 → `server.py` HTTP 분기 `middleware=build_http_middleware(settings.mcp_api_key)`, `test_auth_middleware.py` 생성. `MCP_API_KEY`가 비어 있으면 자동 비활성
- 백엔드 자격 증명 → `config.py` 필드와 `.env.example` 항목. 값은 코드와 로그에 남기지 않음
- 민감정보 마스킹 → 응답 직전 `_common.masking.mask_pii()`. 새 PII 유형은 `_common/masking.py::PII_RULES`에 추가할 일로 TODO를 남기고 서버 안에 정규식을 만들지 않음
- 간접 prompt injection 방어 → `wrap_untrusted(metadata=..., untrusted_content=...)`

## 8. §6.3 → 로깅

`setup_logger("<kebab-name>")`(stderr, JSON)와 `hash_params`로 도구명과 파라미터 해시를 남깁니다. 외부 수집 시스템(Splunk 등)이 적혀 있어도 코드는 stderr JSON까지만 만들고 연동은 README에 메모합니다.

## 9. §7 → timeout, 재시도, Circuit Breaker

- timeout → `<snake_name>_backend_timeout` 기본값과 `httpx.AsyncClient(timeout=...)`
- 재시도 → `_common.retry.with_backoff` (네트워크 오류와 5xx/429만). 예시는 `mock_repo_mcp/client.py`
- Circuit Breaker → 스펙이 명시할 때만. 기본은 미적용

---

## 10. 빠른 참조: 추출 순서

1. 헤딩 체크 (한국어/영어) → 거부 여부
2. 서버명 → 네 가지 표기
3. §4.1 → 기본 transport, 프리미티브 사용 여부
4. §4.2 → 클라이언트 종류, env 키, 미정 항목
5. §5.1 → 도구 목록, hints, 파일 배치
6. §5.2 (도구마다) → 영어 docstring, 시그니처, Mock 응답, 에러 매핑
7. §5.3 (있으면) → `primitives.py`
8. §6.2, §6.3, §7 → 공통 적용 항목
9. 미정 항목 → Phase 3 질의 또는 TODO 마커
