---
name: mcp-server-builder
description: Builds a runnable Python + FastMCP MCP server from a 10-section MCP server spec (Korean or English) in this repo's conventions. Use whenever the user wants to implement, build, scaffold, or generate code for an MCP server from a spec ("implement this MCP spec", "build the MCP server from docs/mcp-spec/...", "scaffold an MCP server that wraps our internal API", "MCP 서버 구현해줘", "스펙대로 만들어줘", "이 요구사항 정의서로 MCP 서버 빌드", "MCP 서버 스캐폴드/뼈대 코드"), or when a spec already exists under docs/mcp-spec/ and the next step is code, even if the words "implement" or "scaffold" are not used. Output: src/mcp-servers/<name>/ (server, state, tools, client, config, .env.example, README), tests/<name>/, a scenario YAML for `mcp_cli.py test`, registry entries in configs/mcp_servers.yaml, and Makefile targets. A mock backend makes it run end to end without real integration.
license: MIT
---

# MCP Server Builder

## Overview

`mcp-spec-writer` 스킬(또는 사람)이 작성한 10섹션 요구사항 정의서를 입력으로 받아 **Python + FastMCP** MCP 서버 코드를 생성합니다. 정의서는 한국어판과 영어판을 모두 받습니다. 실제 내부 시스템 연동 정보가 없어도 **Mock 백엔드가 기본으로 동작**하도록 만들고, 실 엔드포인트 부분은 `# TODO(스펙 미정: ...)` 마커로 분리합니다.

생성 코드는 저장소의 세 서버(starter, mock_repo, nl2sql)와 같은 구조이며, 템플릿을 그대로 채우면 이 저장소 설정에서 ruff와 pytest를 통과합니다.

| 항목 | 규칙 |
|---|---|
| 위치 | `src/mcp-servers/<snake_name>/` (부모 폴더는 하이픈, 패키지는 snake_case) |
| 공유 모듈 | `src/mcp-servers/_common/` (모듈 8개: auth, cors, env, errors, logging, masking, retry, trust). **이미 있으므로 import만 함**, `from _common.<module> import ...` |
| 실행 | `cd src/mcp-servers && uv run python -m <snake_name>.server --transport http|stdio` (`make run-<kebab-name>`) |
| 테스트 | `tests/<snake_name>/` (**`__init__.py` 만들지 않음**, importlib 모드) + `tests/scenarios/<kebab-name>.yaml` |
| 등록 | `configs/mcp_servers.yaml`에 stdio 항목과 `-http` 항목 추가 (CLI, Inspector, Chat이 이 파일을 읽음) |
| 언어 | LLM에 보이는 문자열(도구 docstring, 파라미터 설명, 에러 메시지, 프롬프트/리소스 설명)은 **영어**. 코드 주석과 로그는 한국어 허용, README는 스펙과 같은 언어 |

## When to Use

- `docs/mcp-spec/<name>_v0.X.md` 같은 10섹션 정의서를 가리키며 구현, 빌드, 생성을 요청할 때 (한국어/영어 모두)
- 정의서 작성 직후 "이제 코드로 옮겨줘", "next step", "build it"이라고 할 때
- 기존 서버의 정의서에 Tool이 추가되어 코드에도 반영해야 할 때
- `src/mcp-servers/`에 새 서버 폴더가 필요할 때

**사용하지 않는 경우**:
- 정의서가 없거나 10섹션 형식이 아닌 경우 → `mcp-spec-writer` 안내
- 기존 코드의 버그 수정, 리팩터링 → 일반 코딩 작업

**응답 언어**: 사용자가 쓴 언어로 진행 상황과 질문을 전합니다. 생성 코드의 언어 규칙은 위 표를 따릅니다.

---

## Operational Workflow

### Phase 1: Ingest & Validate

1. **입력 수집**: 정의서 경로가 없으면 AskUserQuestion으로 받습니다 (기본 후보: `docs/mcp-spec/` 아래 최신 `_v0.X.md`).
2. **정의서 Read**: 파일 전체를 읽습니다.
3. **유효성 체크**: [references/spec_parsing.md §1](references/spec_parsing.md)의 표로 확인합니다. 한국어 헤딩(`## 5. 기능 요구사항 (Tools)`)과 영어 헤딩(`## 5. Functional Requirements (Tools)`)을 모두 인정합니다. 다음이 하나라도 빠지면 거부하고 `mcp-spec-writer`로 보강을 권합니다.
   - §0 문서 정보, §4 시스템 구성, §4.1 MCP 서버, §5 기능 요구사항, §5.1 Tool 목록, §5.2 Tool 상세
   - `#### ▶ T-NN \`tool_name\`` 블록 1개 이상

거부 메시지 예: "이 정의서는 10섹션 표준을 따르지 않습니다(누락: §5.1). `/mcp-spec-writer`로 보강한 뒤 다시 시도하세요."

### Phase 2: Extract

[references/spec_parsing.md](references/spec_parsing.md) 규칙으로 다음을 뽑아 작업 메모에 둡니다 (사용자에게는 한 줄 요약만).

- **서버명**: `kebab-name`, `snake_name`, `UPPER_NAME` 세 표기를 모두 보관
- **§4.1**: 기본 transport, 사용 프리미티브 (Resources/Prompts 여부)
- **§4.2**: 백엔드별 시스템명, 엔드포인트, 프로토콜, 인증. `**확인 필요**`는 Phase 3 대상
- **§5.1**: 도구별 `(T-NN, name, 설명, readOnly, destructive, idempotent)`. 개수로 파일 배치 결정 (1~4 `tools.py`, 5~10 `tools/<group>.py`, 11+ `tools/<tool>.py`)
- **§5.2**: LLM Description, 입력 파라미터, 출력 예시 JSON, 빈 결과, 크기 제어, 에러 표
- **§5.3 (선택)**: Resources/Prompts
- **§6.2, §6.3, §7**: MCP 인증, 백엔드 자격 증명, 마스킹, 로깅, timeout, 재시도

### Phase 3: Clarify (배칭)

미정 항목을 **AskUserQuestion 한 번(최대 4개)**으로 묻습니다. 표준 옵션은 [references/question_bank.md](references/question_bank.md)에 있습니다. 우선순위는 Transport > MCP 인증 > 백엔드 프로토콜 > 백엔드 인증 > 엔드포인트 > 기타이고, 5번째부터는 묻지 않고 기본값 + TODO 마커로 처리합니다.

답하지 않거나 "확인 필요"로 답한 항목은 `# TODO(스펙 미정: <항목>)` + 기본값으로 채웁니다. Mock은 항상 §5.2 출력 예시를 그대로 돌려주므로 데모에는 지장이 없습니다. AskUserQuestion을 쓸 수 없는 환경(비대화형 실행)이면 묻는 대신 같은 기본값 + TODO로 진행하고 요약에 적습니다.

### Phase 4: Scaffold

**선결 체크**: `src/mcp-servers/<snake_name>/`이 이미 있으면 AskUserQuestion으로 분기합니다 (전체 재생성 / Tool만 추가 / 중단). 사용자 확인 없이 덮어쓰지 않습니다. 포트도 기존 서버(8001, 8002, 8004)와 겹치지 않게 고릅니다.

**`_common/`**: 이미 있으므로 생성하거나 고치지 않습니다. 모듈 설명과 사용법은 [references/common_module.md](references/common_module.md). 정말 없는 새 저장소일 때만 그 문서의 코드로 8개 모듈을 만듭니다.

**서버 파일**: 템플릿은 [references/server_skeleton.md](references/server_skeleton.md), 패턴의 이유는 [references/fastmcp_code_patterns.md](references/fastmcp_code_patterns.md).

| 파일 | 내용 |
|---|---|
| `__init__.py` | 한 줄 docstring |
| `server.py` | `FastMCP("<kebab-name>", lifespan=lifespan)` + `register_tools()` + `main()`의 `--transport stdio|http`, `--host`, `--port`. HTTP 분기에만 `middleware=build_http_middleware(settings.mcp_api_key)` |
| `state.py` | `AppState(backend)` + `get_backend()`. 도구는 `server.py` 대신 여기서 백엔드를 꺼냄 (순환 import 방지) |
| `tools.py` 또는 `tools/` | 데코레이터 없는 async 함수 + `TOOLS = ((fn, hints), ...)` + `register_tools(mcp)`. 파라미터는 `Annotated[T, Field(description=<영어>)]`, docstring은 영어 LLM Description |
| `primitives.py` | (스펙에 Resources/Prompts가 있을 때만) starter_mcp 방식 |
| `client.py` | `BackendClient` Protocol + `MockBackendClient`(§5.2 예시 그대로) + 실 클라이언트(`NotImplementedError` + TODO) |
| `config.py` | `pydantic-settings`, `env_file=env_files(__file__)`, `<snake_name>_port`, `<snake_name>_backend_url`(빈 값이면 Mock), `mcp_api_key` |
| `models.py` | (선택) 응답 모델 |
| `.env.example` | 서버별 키 + `MCP_API_KEY`, `MCP_CORS_ORIGINS` |
| `README.md` | 실행, 환경 변수, Tool 표, 검증 명령, TODO 확인 방법 |

도구가 많으면 **도구 1개씩** Write/Edit합니다. 한 번에 7~10개를 쓰면 출력이 잘릴 수 있습니다.

**테스트**: 템플릿은 [references/test_patterns.md](references/test_patterns.md).

| 파일 | 내용 |
|---|---|
| `conftest.py` | `mock_backend`(state 교체) + `mcp_client`(`fastmcp.Client(mcp)` in-memory) |
| `test_tools.py` (또는 `test_tools_<group>.py`) | 도구별 성공 1건 + 에러 코드별 1건 (`match=r"\[CODE\]"`) |
| `test_mcp_contract.py` | `list_tools` 이름과 annotations, 도구별 `call_tool` 성공, 에러가 `is_error`로 오는지 |
| `test_auth_middleware.py` | Streamable HTTP 또는 §6.2 MCP 인증이 있을 때. `mcp.http_app(middleware=...)` + Starlette `TestClient`로 401/200 |
| `tests/scenarios/<kebab-name>.yaml` | 범용 시나리오 러너용. 도구별 smoke + 대표 에러 (`docs/scenario-format.md`) |

**저장소 연결** (기존 내용은 건드리지 않고 추가만):

- `configs/mcp_servers.yaml`: `<kebab-name>`(stdio)와 `<kebab-name>-http`(streamable_http) 항목. `description`(영어)와 `description_ko`(한국어) 둘 다. `internalUrl`은 docker-compose 서비스를 만들 때만, `headers`는 필요할 때만
- `Makefile`: `run-<kebab-name>`, `run-<kebab-name>-stdio`(또는 `-http`), `test-<kebab-name>`, `test-scenarios-<kebab-name>`, 그리고 `.PHONY` 목록
- `pyproject.toml`: `[tool.ruff.lint.isort] known-first-party`에 `<snake_name>` 한 개만 추가. 이것 말고는 편집하지 않습니다. 빠뜨리면 ruff I001이 납니다
- 루트 `.env.example`: `<UPPER_NAME>_PORT=<port>` 한 줄

**의존성**: fastmcp, httpx, pydantic-settings, tenacity, starlette, pytest, pytest-asyncio는 이미 `pyproject.toml`에 있습니다. 백엔드 드라이버가 새로 필요할 때만(예: `aiomysql`) `uv add` 명령을, Oracle이면 기존 `uv sync --extra oracle`을 **README의 실행 절과 생성 요약 둘 다에** 적습니다. 드라이버 import는 실 클라이언트 안에서 지연 import로 두어 Mock 경로와 테스트가 드라이버 없이 돌게 합니다.

### Phase 5: Verify (자동 실행)

의존성 설치(`uv add`)가 더 이상 필요 없으므로 검증은 스킬이 직접 돌립니다. 모두 몇 초 안에 끝나고 저장소 밖에 부작용이 없습니다. 실패하면 고친 뒤 다시 돌려 **넷 다 통과한 상태로** 마칩니다.

```bash
# 1. 포맷과 린트 (pyproject 의 known-first-party 추가가 선행). ruff check 는 0건이어야 함
uv run ruff format src/mcp-servers/<snake_name> tests/<snake_name>
uv run ruff check src/mcp-servers/<snake_name> tests/<snake_name>

# 2. 단위, contract 테스트
make test-<kebab-name>

# 3. 범용 시나리오 러너 (stdio 서버를 직접 띄움, Result: OK 여야 함. 형식 오류면 종료 코드 2)
make test-scenarios-<kebab-name>
```

자주 걸리는 것:
- `ruff format`은 긴 문자열과 주석(E501, 105자)을 줄여 주지 않습니다. 긴 에러 메시지는 문자열 이어 붙이기로, 긴 주석은 두 줄로 나눕니다
- 시나리오 YAML 한 줄 표기(`{field: ..., op: ...}`) 안에서 `repositories[0].id`처럼 `[`가 든 경로는 반드시 따옴표로 감쌉니다 (`field: "repositories[0].id"`). 안 그러면 YAML 파싱 오류로 아무 케이스도 실행되지 않습니다

사용자에게는 이어서 해 볼 명령을 안내합니다.

```bash
uv run python scripts/mcp_cli.py list-tools --server <kebab-name>
uv run python scripts/mcp_cli.py call --server <kebab-name> --tool <tool> --params '{...}'
make run-<kebab-name>    # Streamable HTTP, 이후 Frontend /inspector 에서 <kebab-name>-http 선택
```

마지막으로 **생성 요약**을 출력합니다.

```
✓ src/mcp-servers/<snake_name>/ (파일 N개, Tool M개, Resources R개, Prompts P개)
✓ tests/<snake_name>/ (테스트 K건 통과) + tests/scenarios/<kebab-name>.yaml (케이스 C건, Result: OK)
✓ ruff check 0건
✓ configs/mcp_servers.yaml (<kebab-name>, <kebab-name>-http)
✓ Makefile (run-, test-, test-scenarios-) / pyproject known-first-party / .env.example
✓ LLM 노출 문자열 영어화 L건 (스펙이 한국어일 때)
⚠ TODO 마커 J개 (확인 필요: ...)
```

---

## 출력 작성 규칙 (반드시 준수)

### 네이밍

- 서버 패키지는 **snake_case** (`code_repo_mcp/`). 하이픈이 있으면 import가 깨집니다
- FastMCP 이름, 로거 이름, 레지스트리 이름, Makefile 타깃은 **kebab-case** (`code-repo-mcp`)
- 클래스는 PascalCase (`BackendClient`, `MockBackendClient`)
- 환경 변수는 `<UPPER_NAME>_*` (`CODE_REPO_MCP_PORT`, `CODE_REPO_MCP_BACKEND_URL`). 공용 키 `MCP_API_KEY`, `MCP_CORS_ORIGINS`는 접두사 없음

### Tool 함수

[references/fastmcp_code_patterns.md §1](references/fastmcp_code_patterns.md)의 체크리스트를 모두 지킵니다. 핵심만 옮기면:

- `async def`, 데코레이터 없음, 백엔드는 `get_backend()`
- 파라미터 `Annotated[T, Field(description="<영어>")]`, 기본값은 시그니처에
- docstring = §5.2 LLM Description 4요소를 **영어로** (영어 스펙이면 그대로)
- annotations는 `TOOLS` 튜플로 §5.1 Hint 그대로
- 에러는 `_common.errors` 서브클래스, 메시지는 영어 + 끝에 `[CODE]`
- 외부 텍스트는 `mask_pii` 후 `wrap_untrusted(metadata=..., untrusted_content=...)`

### 백엔드 클라이언트

- 클라이언트는 lifespan에서 **한 번만** 만들고 종료 때 `aclose()`. 도구 호출마다 `httpx.AsyncClient()`를 만들지 않습니다
- `<UPPER_NAME>_BACKEND_URL`이 비어 있으면 Mock (기본). 값이 있으면 실 클라이언트
- env 키 이름: 스펙 §4.2/§6.2가 키 이름이나 인증 헤더를 정해 두었으면 템플릿의 `_backend_url`/`_backend_token`보다 스펙을 따릅니다 (예: `X-API-Key` 헤더면 `<snake_name>_backend_api_key`). 백엔드가 둘이면 `<snake_name>_db_*`, `<snake_name>_api_*`처럼 나눕니다
- Mock 데이터: 스펙 예시의 개수 필드(`total_count` 등)와 항목 수가 어긋나면 예시 항목은 그대로 두고 개수를 맞추는 최소한의 항목만 추가합니다
- 실 메서드는 엔드포인트가 정해질 때까지 `raise NotImplementedError(...)` + TODO 마커. 정해지면 `_common.retry.with_backoff`로 감쌉니다 (예시: `mock_repo_mcp/client.py`)

### 응답 신뢰 경계

**언제 감싸는가**: 응답에 외부 시스템이나 사람이 쓴 자유 텍스트(파일 본문, 설명, 댓글, 커밋 메시지, 조회한 데이터 행)가 들어가면 `wrap_untrusted`로 감쌉니다. 스펙 §5.2 출력 예시가 평평한 JSON이어도 그 텍스트 필드는 `untrusted_content`로 옮기고, 나머지 키는 `metadata`에 둡니다 (모양이 스펙과 달라진 점은 README와 생성 요약에 적음). ID, 이름, 개수, 타입처럼 서버가 구조로 다루는 값만 있는 응답은 스펙 모양 그대로 둡니다. `mask_pii`는 문자열 값에만 적용합니다 (숫자는 그대로).

```python
return wrap_untrusted(
    metadata={"path": path, "revision": rev, "size": size},
    untrusted_content={"content": mask_pii(file_text)},
)
# → {"metadata": {...}, "untrusted_content": {...}}
```

### 미정 항목 마커

```python
# TODO(스펙 미정: §4.2 엔드포인트) 백엔드팀 회신 대기
```

형식은 `# TODO(스펙 미정: <섹션 또는 항목>) <보조 설명>`으로 통일합니다 (영어 스펙이어도 grep 일관성을 위해 같은 형식). 실 엔드포인트가 미정이어도 설정 기본값은 빈 문자열(Mock)로 두고 가짜 URL을 넣지 않습니다. 스펙 §4.2에 확정 URL이 있어도 기본값은 빈 문자열로 두고(데모와 테스트가 Mock으로 돌도록), 그 URL은 `.env.example`과 README에 예시 값으로 적습니다.

### 언어 규칙

| 대상 | 언어 |
|---|---|
| 도구 docstring, `Field(description=...)`, 에러 메시지, Resource/Prompt 설명 | 영어 (한국어 스펙이면 의미를 유지해 번역) |
| 레지스트리 `description` / `description_ko` | 영어 / 한국어 |
| 코드 주석, 모듈 docstring, 로그 | 한국어 허용 (저장소 관례) |
| README | 스펙과 같은 언어 |
| 식별자 | 영어 |

---

## 새 서버가 자동으로 얻는 것

생성 규칙을 지키면 별도 작업 없이 다음이 바로 동작합니다.

- **CLI**: `mcp_cli.py list-tools / call / list-resources / read-resource / list-prompts / get-prompt --server <kebab-name>` (레지스트리 항목만 있으면 됨, `MCP_API_KEY`는 자동으로 헤더에 실림)
- **범용 시나리오 러너**: `mcp_cli.py test tests/scenarios/<kebab-name>.yaml [--junit out.xml]`. 형식은 `docs/scenario-format.md`이고, Inspector의 히스토리 내보내기도 같은 형식이라 Inspector에서 만든 케이스를 그대로 회귀 테스트로 쓸 수 있습니다
- **Frontend**: Dashboard 카드, `/inspector`(도구 호출, Resources/Prompts 탭), `/chat`(LLM tool-use). 서버 측 프록시 `/api/mcp/<kebab-name>-http`가 API Key를 붙입니다
- **인증과 CORS**: HTTP 분기의 `build_http_middleware` 하나로 `X-MCP-API-Key` 검증과 브라우저 직결 CORS
- **Resources/Prompts**: `primitives.py`를 두면 capabilities가 자동으로 실리고 Inspector 탭이 열립니다. 정본 예시는 `src/mcp-servers/starter_mcp/primitives.py`

---

## 백엔드 유형별 권장 기본 설정

스펙 §4.2의 백엔드 종류에 따라 기본값을 적용합니다 (사용자 지시가 있으면 변경).

| 백엔드 유형 | 실 클라이언트 | 추가 의존성 | Mock 전략 |
|---|---|---|---|
| REST API | `httpx.AsyncClient` + `_common.retry.with_backoff` | 없음 (이미 있음) | `MockBackendClient` + 테스트는 `httpx.MockTransport` |
| CLI 호출 | `asyncio.create_subprocess_exec` | 표준 라이브러리 | stdout 픽스처를 돌려주는 Mock |
| Java API / JNI | HTTP 사이드카 가정 + `# TODO(스펙 미정: JNI 브리지)` | 없음 | 동일 |
| Oracle | `oracledb` (async) | `uv sync --extra oracle` | dict를 돌려주는 Mock (nl2sql_mcp/db 참고) |
| PostgreSQL | `psycopg` (async, 이미 있음) | 없음 | 동일 |
| MySQL | `aiomysql` | `uv add aiomysql` | 동일 |
| Snowflake/BigQuery | 공식 SDK | 해당 패키지 `uv add` | 동일 |
| 메타정보 / 카탈로그 (HTTP) | `httpx` | 없음 | 동일 |

---

## 마무리 안내

작성 후 사용자에게 다음을 안내합니다.

1. **검증 결과**와 이어서 해 볼 CLI, Inspector 명령 (Phase 5)
2. **TODO 마커 확인**: `grep -rn "TODO(스펙 미정" src/mcp-servers/<snake_name>/`. 백엔드 담당팀 회신을 받아 채울 위치
3. **실 백엔드 연동**: 실 클라이언트의 `NotImplementedError`를 실제 호출로 바꾸고 `<UPPER_NAME>_BACKEND_URL`을 설정. Mock에서 통과한 테스트와 시나리오가 그대로 회귀 기준이 됩니다
4. **Tool 추가**: 정의서에 §5.2 블록을 추가한 뒤 이 스킬을 다시 실행하고 "Tool만 추가"를 고릅니다
5. **Docker 배포가 필요하면**: docker-compose 서비스 추가와 레지스트리 `internalUrl`은 별도 작업으로 안내합니다 (nl2sql-mcp 서비스가 예시)
