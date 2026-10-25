# MCP Connectors 상세 개발 계획서

> **역사 문서**: MVP(v0.1) 당시의 설계 기록이며 현재 코드와 다를 수 있습니다. 현재 기준은 코드와 [docs/update-plan.md](../update-plan.md)입니다.

## Context

본 계획서는 [docs/PRD.md](PRD.md) (v0.1, 2026-05-19) 의 MVP 요구사항을 **기능 의존성 축** 으로 재정렬하여 Phase 단위로 실행 가능하게 분해한 문서다. PRD 부록 A 의 10 영업일 일정은 각 Phase 머리말에 보조 정보(Day n)로만 표기한다.

산출물은 **Python + FastMCP 기반 MCP 서버 3 종** (`simple-mcp-server`, `echo-mcp`, `mock-repo-mcp`) + **Python CLI 클라이언트** + **Next.js 프론트엔드(대시보드/Inspector/Chat/Settings)** 의 단일 레포 구조이며, 사내 실서버 연동은 본 MVP 범위에서 의도적으로 제외된다 (PRD §8).

**현재 구현 상태:** `docs/` 와 `.claude/skills/` 만 존재. `src/`, `frontend/`, `tests/`, `configs/`, `scripts/`, `Makefile`, `pyproject.toml`, `.env.example` 모두 미생성, Phase 0 부터 신규 작성.

**기능 ID 매핑 (PRD §3.0):** F-1 `echo-mcp`, F-1B `simple-mcp-server`, F-2 `mock-repo-mcp`, F-3 CLI, F-4 Inspector, F-5 Chat, F-6 MCP 직결 어댑터, F-7 테스트, F-8 `_common/`.

---

## Phase 0: 환경 셋업 & 레지스트리 골격

**목표:** 모든 후속 Phase 가 의존하는 패키지, 도구, 설정 골격 확립
**의존성:** 없음
**기능 ID:** (선행 인프라)
**참조 일정:** 부록 A Day 1 일부

### 0-1. Python 의존성 / 가상환경
- [x] `pyproject.toml` 작성: `mcp>=1.0`, `fastmcp`, `httpx>=0.27`, `pydantic-settings`, `tenacity`, `pyyaml>=6.0`, `typer>=0.12`
- [x] `pyproject.toml` `[project.optional-dependencies] dev`: `pytest`, `pytest-asyncio`, `pytest-httpx`, `ruff`
- [x] `pyproject.toml` `[tool.pytest.ini_options] pythonpath = [".", "src/mcp-servers"]` 설정
- [x] `pyproject.toml` `[tool.ruff]`: line-length=105, target=py312 ([CLAUDE.md](../../CLAUDE.md) 컨벤션)
- [x] `uv sync --extra dev` 실행 확인

### 0-2. 환경 변수 / 설정 골격
- [x] 루트 `.env.example`: `MCP_API_KEY=` (비활성), `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`
- [x] `configs/mcp_servers.yaml` 골격 (엔트리 4 종 자리: `name`/`transport` 필드만, `url`/`command` 는 Phase 2~3 에서 채움)
- [x] `configs/prompts/chat_system.md` 빈 placeholder (Phase 5 에서 채움)

### 0-3. Makefile / 디렉토리 골격
- [x] `Makefile`: `init`, `init-dev`, `clean` 기본 target (서버별 `run-*` / `test-*` 는 Phase 2 부터 추가)
- [x] `src/mcp-servers/__init__.py` 빈 파일
- [x] `tests/conftest.py` 빈 파일 (공용 fixture 자리)
- [x] `.gitignore` 확인 (`.env`, `.venv`, `__pycache__`, `.next`, `node_modules` 포함)

### 0-4. 검증 (DoD)
- [x] `uv sync --extra dev` 성공
- [x] `uv run ruff check src/mcp-servers/` 0 errors (빈 상태)
- [x] `make init` 성공

---

## Phase 1: `_common/` 공유 모듈 (F-8)

**목표:** 6 모듈의 *책임 경계 + 단방향 의존* 을 [PRD §3.9.2/3.9.3](PRD.md) 표대로 확정
**의존성:** Phase 0
**기능 ID:** F-8
**참조 일정:** 부록 A Day 1 잔여

### 1-1. 모듈 생성
- [x] `src/mcp-servers/_common/__init__.py`
- [x] `src/mcp-servers/_common/logging.py`: JSON 포맷 로깅 + `hash_params(params: dict) -> str` (SHA256 short)
- [x] `src/mcp-servers/_common/masking.py`: 주민/카드/계좌 정규식 마스킹 + 사번 익명화
- [x] `src/mcp-servers/_common/trust.py`: `wrap_untrusted(meta: dict, untrusted: dict) -> dict`
- [x] `src/mcp-servers/_common/retry.py`: tenacity 기반 backoff 데코레이터 헬퍼
- [x] `src/mcp-servers/_common/auth.py`: `X-MCP-API-Key` 헤더 검증 (`MCP_API_KEY` env 미설정 시 통과)
- [x] `src/mcp-servers/_common/errors.py`: `InvalidInputError`, `NotFoundError`, `AccessDeniedError`, `BackendUnavailableError`, `ResponseTooLargeError`

### 1-2. 의존 방향 점검
- [x] `_common/*.py` 어디에서도 `from echo_mcp` / `from mock_repo_mcp` / `from simple_mcp_server` import 없음 (단방향)
- [x] 외부 의존은 `fastmcp`, `tenacity`, 표준 라이브러리로 한정

### 1-3. 검증 (DoD: PRD §3.9.4)
- [x] 6 모듈 모두 생성 완료
- [x] `_common` 이 어떤 서버 모듈도 import 하지 않음
- [x] `from _common.<module> import ...` 임포트가 `[tool.pytest.ini_options] pythonpath` 설정으로 작동 (Phase 2 conftest 에서 검증)

---

## Phase 2: MCP 서버 3 종 (F-1B → F-1 → F-2)

**목표:** stdio, Streamable HTTP 양 transport 의 실제 검증 표적 확보 + `_common/` 호출 패턴 시증
**의존성:** Phase 1
**기능 ID:** F-1B, F-1, F-2
**참조 일정:** 부록 A Day 2~4

### 2-1. `simple-mcp-server` 코드베이스 동봉 샘플 (F-1B, Day 2)

> echo-mcp 와 도구가 동일하지만, `_common/` 의 logging, errors, trust 모듈을 *최소 1 회씩* 호출하는 패턴이 코드 안에 *보이도록* 작성. 차기 개발자가 "그대로 읽고 따라 짜는" 캐노니컬 스타터 역할.

#### 2-1-1. 서버 코드
- [x] `src/mcp-servers/simple_mcp_server/__init__.py`
- [x] `src/mcp-servers/simple_mcp_server/server.py`: FastMCP 인스턴스 + stdio/Streamable HTTP 진입점
- [x] `src/mcp-servers/simple_mcp_server/tools.py`: `echo` / `add` / `current_time` 3 tool 등록, `_common/{logging,errors,trust}` 호출
- [x] `src/mcp-servers/simple_mcp_server/config.py`: pydantic-settings (`SIMPLE_MCP_SERVER_PORT=8003` 등 최소 셋)
- [x] `src/mcp-servers/simple_mcp_server/models.py`: 입출력 모델 + `wrap_untrusted` 응답 모델

#### 2-1-2. 환경 / 문서
- [x] `src/mcp-servers/simple_mcp_server/.env.example`: `MCP_API_KEY=` (비활성), `SIMPLE_MCP_SERVER_PORT=8003`
- [x] `src/mcp-servers/simple_mcp_server/README.md`: 6 절 (목적 / 폴더 구조 / 실행 / `_common` 호출 위치 / **신규 서버 만드는 5 단계** / 다음 단계)

#### 2-1-3. 테스트
- [ ] ~~`tests/simple_mcp_server/__init__.py`~~, **의도적 미생성**: `src/mcp-servers/simple_mcp_server` 패키지와 이름 충돌하여 pytest 가 test dir 을 우선 로드함. 대신 `pyproject.toml` 에 `addopts = "--import-mode=importlib"` + `asyncio_mode = "auto"` 추가.
- [x] `tests/simple_mcp_server/conftest.py`: `mcp_client` (FastMCP in-memory client) fixture
- [x] `tests/simple_mcp_server/test_tools.py`: 각 tool 의 `_common` 호출 동작 검증 포함 (6 케이스)
- [x] `tests/simple_mcp_server/test_mcp_contract.py`: `list_tools()` / `call_tool()` contract (5 케이스)

#### 2-1-4. Makefile target
- [x] `make run-simple-mcp-server` (stdio)
- [x] `make run-simple-mcp-server-http` (Streamable HTTP, 포트 8003)
- [x] `make test-simple-mcp-server`

#### 2-1-5. 검증 (DoD: PRD §3.2.4)
- [x] `make run-simple-mcp-server` / `make run-simple-mcp-server-http` 모두 기동 (HTTP 는 `initialize` 200 OK 확인)
- [x] `make test-simple-mcp-server` pass (11/11 passed)
- [x] `tools.py` 가 `_common/logging.py`, `_common/errors.py`, `_common/trust.py` 를 각각 1 회 이상 호출
- [x] `README.md` 가 "신규 서버 만드는 5 단계" 를 명시 (§5)

### 2-2. `echo-mcp` baseline (F-1, Day 3)

> 외부 호출이 전혀 없는 최소 baseline. 자동 회귀 검사 표적.

#### 2-2-1. 서버 코드
- [x] `src/mcp-servers/echo_mcp/__init__.py`
- [x] `src/mcp-servers/echo_mcp/server.py`: stdio/HTTP 분기 진입점
- [x] `src/mcp-servers/echo_mcp/tools.py`: `echo(text)` / `add(a,b)` / `current_time(tz)` 3 tool
- [x] `src/mcp-servers/echo_mcp/client.py`: 사용 안 함 placeholder (외부 백엔드 없음)
- [x] `src/mcp-servers/echo_mcp/config.py`: pydantic-settings (`ECHO_MCP_PORT=8001`)
- [x] `src/mcp-servers/echo_mcp/models.py`: 입출력 Pydantic 모델

#### 2-2-2. 환경 / 문서
- [x] `src/mcp-servers/echo_mcp/.env.example`
- [x] `src/mcp-servers/echo_mcp/README.md`: 4 절 (목적 / 폴더 구조 / 실행 / 환경변수). simple-mcp-server 와 달리 "신규 서버 5 단계" 미포함

#### 2-2-3. 테스트
- [ ] ~~`tests/echo_mcp/__init__.py`~~, **의도적 미생성**: `src/mcp-servers/echo_mcp` 패키지와 이름 충돌하여 pytest 가 test dir 을 우선 로드함 (simple_mcp_server 와 동일 사유). `pyproject.toml` 의 `addopts = "--import-mode=importlib"` + `asyncio_mode = "auto"` 가 이미 적용되어 정상 동작.
- [x] `tests/echo_mcp/conftest.py`: FastMCP in-memory `Client(mcp)` async fixture
- [x] `tests/echo_mcp/test_tools.py`: 6 케이스 (echo 정상 / 빈 입력 / add / current_time UTC / Asia/Seoul / 알 수 없는 tz)
- [x] `tests/echo_mcp/test_mcp_contract.py`: 4 케이스 (`list_tools` 3 종 / inputSchema object / echo.text required / current_time.tz optional)

#### 2-2-4. Makefile target
- [x] `make run-echo-mcp` (stdio)
- [x] `make run-echo-mcp-http` (포트 8001)
- [x] `make test-echo-mcp`

#### 2-2-5. 검증 (DoD: PRD §3.1.4)
- [x] `make run-echo-mcp` (stdio), `make run-echo-mcp-http` (포트 8001) 모두 기동 (HTTP 는 `initialize` 200 OK + `serverInfo.name == "echo-mcp"` 확인)
- [x] `make test-echo-mcp` 통과 (10/10 passed)
- [x] 빈 `text` 입력 시 에러 반환: `_common` 미사용 결정에 따라 `ValueError("text is required")` raise (FastMCP 가 ToolError 로 자동 변환). `test_echo_empty_raises` 로 검증.

### 2-3. `mock-repo-mcp` baseline (F-2, Day 4)

> Mock 백엔드 + `MockBackendClient` 패턴 + `wrap_untrusted` + 페이지네이션, 빈결과, 에러 코드 시증.

#### 2-3-1. 서버 코드
- [x] `src/mcp-servers/mock_repo_mcp/__init__.py`
- [x] `src/mcp-servers/mock_repo_mcp/server.py`
- [x] `src/mcp-servers/mock_repo_mcp/tools.py`: `list_repositories` / `get_file_content` / `search_code`
- [x] `src/mcp-servers/mock_repo_mcp/client.py`: `BackendClient` Protocol + `MockBackendClient` + `HttpBackendClient` (`NotImplementedError` stub)
- [x] `src/mcp-servers/mock_repo_mcp/config.py`: pydantic-settings (`MOCK_REPO_MCP_PORT=8002`)
- [x] `src/mcp-servers/mock_repo_mcp/models.py`

#### 2-3-2. Fixtures
- [x] `src/mcp-servers/mock_repo_mcp/fixtures/repos.json`: 저장소 3 종 예시 (`repo-alpha` / `repo-beta` / `repo-gamma`)
- [x] `src/mcp-servers/mock_repo_mcp/fixtures/files/`: 경로별 sample 파일 (저장소당 2 파일, `TODO`/`FIXME` 키워드 포함)

#### 2-3-3. 환경 / 문서
- [x] `src/mcp-servers/mock_repo_mcp/.env.example`
- [x] `src/mcp-servers/mock_repo_mcp/README.md`: 7 절 (목적 / 폴더 구조 / 실행 / 환경변수 / Mock 백엔드 & 픽스처 스키마 / `_common` 호출 위치 / 다음 단계)

#### 2-3-4. 테스트
- [ ] ~~`tests/mock_repo_mcp/__init__.py`~~, **의도적 미생성**: `src/mcp-servers/mock_repo_mcp` 패키지와 이름 충돌하여 pytest 가 test dir 을 우선 로드함 (§2-1-3 / §2-2-3 와 동일 사유). `pyproject.toml` 의 `addopts = "--import-mode=importlib"` + `asyncio_mode = "auto"` 가 이미 적용되어 정상 동작.
- [x] `tests/mock_repo_mcp/conftest.py`: FastMCP in-memory `Client(mcp)` async fixture
- [x] `tests/mock_repo_mcp/test_tools.py`: 11 케이스 (list_repositories 5 + get_file_content 2 + search_code 4; 성공 + FILE_NOT_FOUND + 빈결과 + 페이지네이션 + invalid input 커버)
- [x] `tests/mock_repo_mcp/test_mcp_contract.py`: 5 케이스 (list_tools 3 종 / inputSchema object / required 필드 매트릭스)

#### 2-3-5. Makefile target
- [x] `make run-mock-repo-mcp` (Streamable HTTP, 포트 8002)
- [x] `make test-mock-repo-mcp`

#### 2-3-6. 검증 (DoD: PRD §3.3.4)
- [x] `make run-mock-repo-mcp` (포트 8002) 기동 (HTTP 는 `initialize` 응답에서 `serverInfo.name == "mock-repo-mcp"` 확인)
- [x] `make test-mock-repo-mcp` pass (16/16 passed: 성공 + 에러 케이스 모두)

---

## Phase 3: Python CLI MCP 클라이언트 (F-3)

**목표:** stdio vs Streamable HTTP 자동 분기 + 3 서브커맨드 완성
**의존성:** Phase 2 (검증 표적 4 엔트리)
**기능 ID:** F-3
**참조 일정:** 부록 A Day 5

### 3-1. 서버 레지스트리 완성
- [x] `configs/mcp_servers.yaml` 4 엔트리 완성 (PRD §5.2): `simple-mcp-server` (stdio), `echo-mcp` (stdio), `echo-mcp-http` (streamable_http:8001), `mock-repo-mcp` (streamable_http:8002)

### 3-2. CLI 구현
- [x] `scripts/mcp_cli.py`: typer 기반 단일 파일
- [x] `list-servers` 서브커맨드: 레지스트리 표 출력
- [x] `list-tools --server <name>` 서브커맨드: tool 이름 + description + `inputSchema` 요약
- [x] `call --server <name> --tool <tool> --params '<json>'` 서브커맨드: 결과 JSON
- [x] transport 자동 분기 (stdio → `fastmcp.client.transports.StdioTransport` 로 subprocess spawn / streamable_http → `StreamableHttpTransport`)

#### 3-2-1. Makefile target (사용자 추가 요건)
- [x] `make cli-list-servers` / `cli-list-tools-echo` / `cli-list-tools-mock-repo` / `cli-call-echo`

### 3-3. 검증 (DoD: PRD §3.4.4 / §9)
- [x] 3 서브커맨드 모두 동작
- [x] stdio (`echo-mcp`) + HTTP (`mock-repo-mcp`) 양쪽 호출 성공: `list-tools` / `call list_repositories` fixture 응답 확인
- [x] `python scripts/mcp_cli.py call --server echo-mcp --tool echo --params '{"text":"hi"}'` → `{"result": "hi"}` 반환
- [x] 잘못된 `--params` JSON 입력 시 exit code 2 + stderr `Invalid JSON in --params: ...`
- [x] 알 수 없는 `--server` 입력 시 exit code 2 + stderr `Unknown server '...'. Available: ...`
- [x] `uv run ruff check scripts/` 0 errors, `uv run ruff format --check scripts/` clean

---

## Phase 4: Frontend 기반 + Inspector (F-6, F-4)

**목표:** Next.js 스캐폴드 + MCP 서버 직결 어댑터 + 대시보드 + Inspector 자동폼
**의존성:** Phase 2 (HTTP transport 서버) + Phase 3 (`configs/mcp_servers.yaml` 사실 출처)
**기능 ID:** F-6, F-4
**참조 일정:** 부록 A Day 6~8

### 4-1. Next.js 스캐폴드 (Day 6 상반)
- [x] `frontend/package.json`: Next.js **16.2.6** (App Router) + TypeScript + Tailwind v4. `create-next-app@latest` 가 현재 16.x 를 설치. App Router, Tailwind v4 호환이라 그대로 채택 (당초 명세 "15.x" 에서 상향).
- [x] `frontend/next.config.ts`
- [x] `frontend/tsconfig.json`
- [x] `frontend/tailwind.config.ts`: Tailwind v4 는 CSS-based config 사용. 본 파일은 task-plan.md 명세 충족용 stub (`content` 패턴만 + 상단 NOTE 주석).
- [x] `frontend/postcss.config.mjs`: `@tailwindcss/postcss` 플러그인 (CLI 자동 생성).
- [x] `frontend/.env.example`: 기존 `NEXT_PUBLIC_API_URL=http://localhost:8000` (FastAPI 잔재) 제거. Phase 5 의 LLM API key 자리만 주석으로 표시.
- [x] `frontend/src/app/layout.tsx`: `import "@/styles/globals.css"`, `lang="ko"`, `title="MCP Connectors"` 로 교체.
- [x] `frontend/src/styles/globals.css` (Tailwind v4 import): `src/app/globals.css` 에서 이동. `components.json` 의 `tailwind.css` 경로도 동기화.
- [x] shadcn/ui init: `frontend/src/components/ui/` 자동 생성. shadcn CLI 옵션 개편으로 `--base-color` 대신 `--defaults` (preset=`base-nova`, baseColor=`neutral`) 사용. button + card 2 종 install. `frontend/src/lib/utils.ts` (`cn` 헬퍼) 동시 생성.
- [x] (계획서 추가) `Makefile`: `frontend-install` / `frontend-dev` / `frontend-build` 3 target 추가.
- [x] (계획서 추가) `frontend/README.md`: MCP Connectors 용 안내로 교체 (구조, Next.js 16 채택 사유 명시).

#### 4-1-1. 검증 (DoD)
- [x] `cd frontend && npm install` 성공 (create-next-app 자동 실행, ERR! 0건)
- [x] `cd frontend && npm run build`: Compiled 1319ms / TS 735ms / static 라우트 `/` + `/_not-found`, 0 errors
- [x] `cd frontend && npm run lint`: ESLint flat config clean (출력 없음)
- [x] `cd frontend && npm run dev` → :3000 LISTEN, HTTP 200, 페이지에 "MCP Connectors" h1, "Phase 4-1 scaffold OK" 문구, shadcn `<Button>` 모두 렌더
- [x] `frontend/src/components/ui/{button,card}.tsx`, `frontend/src/lib/utils.ts`, `frontend/components.json` 생성 확인
- [x] 백엔드 영향 0건: `src/mcp-servers/`, `configs/`, `tests/`, `scripts/`, `pyproject.toml`, `uv.lock` 변경 없음 (변경 영역은 `frontend/` + `Makefile` 한정)

### 4-2. MCP 직결 어댑터 (F-6, Day 6 하반)
- [x] `frontend/src/lib/mcp/types.ts`: `ServerConfig` (discriminated union: `StreamableHttpServer` | `StdioServer`), `ToolMeta`, `ToolResult`, `PingResult`, `ToolCall`
- [x] `frontend/src/lib/mcp/registry.ts`: `configs/mcp_servers.yaml` 의 frontend 가시 부분을 TS 상수로 미러링 (`SERVERS`, `getServerByName`, `getBrowserReachableServers`). 상단에 "YAML 이 정본" 주석 명시.
- [x] `frontend/src/lib/mcp/client.ts`: `createMCPClient(serverConfig)` → `{ listTools, callTool, ping, close }`. lazy connect + 30 s timeout (PRD §3.7.2) + stdio 입력 시 throw + 재시도 없음.
- [x] `@modelcontextprotocol/sdk` (^1.29.0) Streamable HTTP transport (`Client` + `StreamableHTTPClientTransport`) 사용. `frontend/package.json` 에 명시 의존성 추가.
- [x] **MCP 서버측 CORS 허용 origin 환경변수 적용**: `_common/auth.py` 대신 **`_common/cors.py` 신규 모듈** 로 분리 (auth ≠ CORS, 책임 분리). 각 `server.py` HTTP 분기에서 `mcp.run(..., middleware=[build_cors_middleware()])`. env `MCP_CORS_ORIGINS` (콤마 구분, 기본 `http://localhost:3000`). 3 서버 `.env.example` 에 라인 추가.
- [x] (구현 중 발견) `Access-Control-Expose-Headers` 에 `mcp-session-id`, `mcp-protocol-version` 명시: 브라우저 CORS 모드에서 SDK 가 응답 헤더의 세션 ID 를 읽지 못해 두 번째 요청(`notifications/initialized`)이 `400 Bad Request: Missing session ID` 로 실패하던 문제 해결.

#### 4-2-1. 검증 (DoD: PRD §3.7.4)
- [x] `createMCPClient` 로 `mock-repo-mcp` 연결 → `listTools()` 가 3 종 반환 (`list_repositories`, `get_file_content`, `search_code`): 헤드리스 브라우저(Playwright) 로 확인
- [x] `callTool("list_repositories", {})` 응답이 fixture 와 일치: `repo-alpha` / `repo-beta` / `repo-gamma` + `total_count: 3`
- [x] 브라우저 콘솔 CORS 에러 0 건 (`access-control-allow-origin: http://localhost:3000` + `access-control-expose-headers: mcp-session-id, mcp-protocol-version` 응답 헤더 확인)
- [x] 회귀: `make test-echo-mcp` / `test-mock-repo-mcp` / `test-simple-mcp-server` (37 passed), `ruff check src/ scripts/` 0 errors, `npx tsc --noEmit` 0 errors, `npm run lint` clean
- [x] 임시 검증 페이지 (`frontend/src/app/dev/mcp-smoke/`) 는 검증 후 제거. Phase 4-3 정식 대시보드가 이 자리를 대체할 예정.
- [x] (메모) Next.js 16 App Router 의 *private folder* 규칙 (`_<name>/` 은 라우팅 제외) 으로 인해 검증 페이지는 `dev/mcp-smoke/` (underscore 없음) 로 배치.

### 4-3. 대시보드 페이지 (`/`, Day 6 잔여)
- [x] `frontend/src/app/page.tsx`: 4 서버 카드 그리드 (Server Component, `SERVERS` 매핑, `sm:grid-cols-2 xl:grid-cols-4`)
- [x] `frontend/src/components/dashboard/ServerCard.tsx`: `Card` + `Badge` + ping 상태 (Server Component, `HealthIndicator` 만 client island)
- [x] `frontend/src/components/dashboard/HealthIndicator.tsx`: `lib/mcp/client.ts::ping` 호출 (`"use client"`, 5s UI cap + 수동 refresh + stale-session reset)

#### 4-3-1. 계획서 추가 산출물
- [x] `frontend/src/components/ui/badge.tsx`: `npx shadcn add badge` 로 추가 (수동 작성 금지).
- [x] `frontend/src/app/layout.tsx`: 최소 top nav 4 링크 (Dashboard / Inspector / Chat / Settings). Inspector/Chat/Settings 는 Phase 4-4/5 완료 전까지 404 (의도된 임시 상태).
- [x] `<Button asChild>` 대신 `<Link className={cn(buttonVariants(...))}>` 패턴 채택: 현재 Button 이 `@base-ui/react` 기반으로 `asChild` prop 을 노출하지 않음 (Pre-flight 결과).

#### 4-3-2. 검증 (DoD)
- [x] `cd frontend && npm run lint` clean: React 19 의 `react-hooks/set-state-in-effect` 회피를 위해 `useEffect` 안에서 `setTimeout(..., 0)` 로 첫 ping 호출을 macrotask 분리.
- [x] `cd frontend && npm run build`: 0 errors (Compiled 1078ms, TS 953ms, `/` + `/_not-found` static 렌더).
- [x] 브라우저 검증 (`make run-echo-mcp-http` + `make run-mock-repo-mcp` + `npm run dev`):
  - [x] 4 카드 렌더, stdio 2 종은 `n/a (stdio)` + Inspector/Chat 비활성, HTTP 2 종은 `healthy, 10~11ms` + 정상 링크.
  - [x] Top nav 4 링크 정상 표시 (Inspector/Chat/Settings 클릭 시 404: 의도).
  - [x] **Offline 시나리오:** echo-mcp-http 종료 → refresh → `offline, Failed to fetch` red badge (`title` 속성에 full error).
  - [x] **Recovery 시나리오:** echo-mcp-http 재기동 → refresh → `healthy, {ms}` 복귀 (stale-session reset 로직 검증; 최초 구현에서 `Session not found` 발생 → ping 실패 시 client close+nullify 보강).
  - [x] Console 비-fetch 에러 0 건 (의도된 `ERR_CONNECTION_REFUSED` / `ERR_INCOMPLETE_CHUNKED_ENCODING` 만 발생).
- [x] 백엔드 영향 0건: `src/mcp-servers/`, `configs/`, `tests/`, `scripts/`, `pyproject.toml`, `uv.lock` 변경 없음.

### 4-4. Inspector 페이지 (F-4, Day 7~8)
- [x] `frontend/src/app/inspector/page.tsx`: `"use client"` + Next.js 16 `use(searchParams)` 패턴
- [x] `frontend/src/lib/schema/jsonSchemaToZod.ts`: JSON Schema Draft-07 → zod 변환
- [x] `frontend/src/components/inspector/ServerSelect.tsx`
- [x] `frontend/src/components/inspector/ToolList.tsx`
- [x] `frontend/src/components/inspector/AutoForm.tsx`: `react-hook-form` + `@hookform/resolvers/zod`
- [x] `frontend/src/components/inspector/ResponseViewer.tsx`: `@uiw/react-json-view` 트리뷰 + 복사 버튼
- [x] 폼 자동 생성 매핑 (PRD §3.5.3): string/enum/number/boolean/object/array 위젯

#### 4-4-0. 계획서 추가 산출물 / 의도적 보강
- [x] `frontend/src/components/ui/form.tsx`: shadcn 의 base-nova preset 이 `form.json` 을 stub 으로 emit (file 0 개) 하여 `shadcn add form` 이 무동작. radix-ui 의존성 회피 위해 **`React.cloneElement` 기반 FormControl** 로 이식.
- [x] `frontend/src/lib/schema/jsonSchemaToZod.test.ts`: vitest 35 케이스 (DoD 4 의 4 종 widget 시증 포함, FastMCP 실측 형태 `anyOf` 회귀 포함).
- [x] `frontend/src/lib/mcp/registry.ts`: `getBrowserReachableServers()` 반환 타입을 `StreamableHttpServer[]` 로 narrowing (type predicate 추가).
- [x] `Makefile` `frontend-test` target + `frontend/package.json` `scripts.test`.

#### 4-4-1. 검증 (DoD: PRD §3.5.4)
- [x] `mock-repo-mcp.list_repositories()` 호출 결과가 JSON 트리뷰로 렌더: `Response (410 B, 60 ms)` + `repositories:[3]` + `total_count:3` (Playwright 검증).
- [x] 빈 필수 필드 제출 시 인라인 에러 (서버 호출 발생 안 함): `search_code` 빈 query 호출 시 `Required` 인라인 표시 + Network 탭 추가 `tools/call` 0 건.
- [x] 응답 패널 "JSON 복사" 버튼 동작: `navigator.clipboard.readText()` 로 646 chars pretty-printed JSON 확인.
- [x] 4 종 입력 타입 (string / number / bool / object) 모두 자동 폼 생성: `jsonSchemaToZod.test.ts` 35/35 pass (DoD 4 직접 시증).
- [x] 추가 시나리오 (계획서 §4-4-5-2):
  - [x] **server 전환**: `echo-mcp-http` 선택 → `echo({text:"ping"})` → `{"result":"ping"}` 렌더.
  - [x] **offline 시나리오**: echo-mcp-http 종료 시 `Error, 8 ms / Failed to fetch` destructive 박스. 페이지 다른 영역 정상.
  - [x] **stale-session 회복**: 서버 재기동 → 첫 호출 `Session not found` → clientRef nullify → 두 번째 호출 자동 reconnect 후 `Response (17 B, 19 ms)` 정상.
- [x] 회귀: vitest 35/35, `ruff check src/ scripts/` clean, `pytest tests/` 37/37, `npm run lint` clean, `npm run build` 0 errors (route table: `/` static, `/inspector` dynamic, `/_not-found` static), Dashboard 4 카드 패턴 회귀 없음 (healthy/n.a. 배지 정상).

#### 4-4-2. 구현 중 발견 / 학습
- (FastMCP 실측) `Optional[X]` 의 JSON Schema 는 **`{anyOf: [{type:X},{type:"null"}]}`** 형태, 계획서 기존 가정 `{type:["X","null"]}` 와 다름. 매퍼의 `extractType` 가 anyOf 분기를 우선 처리하도록 보강 + AutoForm 의 라벨 표기 (`(string, optional)`) 도 같은 함수 재사용.
- shadcn CLI `add form` 이 base-nova preset 에서 silent no-op 인 점이 plan 작성 시점에 미식별. 실행 단계에서 발견 → 본 프로젝트용 form.tsx 직접 이식.

---

## Phase 5: Frontend Chat + Settings (F-5)

**목표:** LLM tool-use 루프 + 멀티 프로바이더 (Anthropic / OpenAI) + Settings 저장
**의존성:** Phase 4 (MCP 어댑터)
**기능 ID:** F-5
**참조 일정:** 부록 A Day 9

### 5-1. Settings 페이지 + localStorage
- [x] `frontend/src/lib/storage/settings.ts`: `MCPSettings`, `ToolCallRecord` 타입 + getter/setter (PRD §5.3 스키마) + zod 런타임 검증으로 손상/타입 drift 자동 복구 + SSR 가드 + FIFO 20 `pushRecentCall`/`clearRecentCalls`
- [x] `frontend/src/lib/storage/settings.ts`: `DEFAULT_SETTINGS` 상수 (PRD §5.3)
- [x] `frontend/src/app/settings/page.tsx`: `RadioGroup` (provider) + `Input` (API Key, show/hide 토글) + `Select` (model) + `Textarea` (system prompt override) + Save / Reset to defaults

#### 5-1-0. 계획서 추가 산출물 / 의도적 보강
- [x] `frontend/vitest.config.ts` 신규: `environment: "happy-dom"`. 기존 vitest config 부재 + `localStorage` 테스트를 위해 필요. devDeps 에 `happy-dom` 추가 (`npm install -D happy-dom`).
- [x] `frontend/src/components/ui/radio-group.tsx`: `npx shadcn@latest add radio-group` 로 추가 (base-nova preset 이 정상 emit; form.json 케이스 같은 silent no-op 없음).
- [x] `frontend/src/lib/storage/settings.test.ts`: vitest 12 케이스 (기본값 / 라운드트립 / 손상 JSON 복구 / 타입 drift 복구 / partial merge / FIFO 20 / SSR 안전성 / `selectedServer` 외부 write 경로).
- [x] Form schema 는 plan 의 `discriminatedUnion` 대신 **`z.object().superRefine`** 로 구현: provider 별 API Key 필수 검증을 단일 객체 스키마 안에서 처리해 RHF type narrowing 복잡도 회피 (validation 의미는 동일).
- [x] **legacy 모델 처리**: 하이드레이션 시 저장된 모델이 curated 목록(Anthropic 3 / OpenAI 2)에 없으면 Select 옵션 맨 앞에 `<SelectItem>{model} (legacy)</SelectItem>` 동적 prepend. 외부 주입 (`gpt-4-turbo`) 시증 완료.
- [x] React 19 `react-hooks/set-state-in-effect` 회피: Dashboard `HealthIndicator` (§4-3-2) 와 동일 패턴 (`setTimeout(..., 0)`) 으로 하이드레이션 useEffect 안의 form.reset + setLegacy* 호출을 macrotask 분리.
- [x] React Compiler 경고 회피: `form.watch("llmProvider")` → `useWatch({ control, name })` 로 교체 (RHF watch 는 memoize 불가).

#### 5-1-1. 검증 (DoD)
- [x] `cd frontend && npm run test`: vitest **47/47** pass (35 기존 + 12 신규).
- [x] `cd frontend && npm run lint` clean (0 errors / 0 warnings).
- [x] `cd frontend && npm run build`: 0 errors. Route table: `/`, `/_not-found`, `/inspector`, **`/settings` (static)**.
- [x] 브라우저 검증 (Playwright, `make run-echo-mcp-http` + `make run-mock-repo-mcp` + `npm run dev`):
  - [x] DEFAULT_SETTINGS 초기 렌더 (Anthropic 선택, claude-sonnet-4-6, 빈 API Key, password type).
  - [x] API Key 입력 → Save → reload → 값 유지 + `localStorage["mcp-connectors.settings"]` 가 PRD §5.3 형태 JSON 으로 저장.
  - [x] Show/Hide 토글: `input.type` password↔text, aria-label "Show API key"↔"Hide API key".
  - [x] Provider 토글 (anthropic → openai): UI 가 OpenAI 키/모델로 전환, anthropic 키는 form state 잔존 (RHF `shouldUnregister: false`).
  - [x] 빈 OpenAI 키로 Save → 인라인 에러 "OpenAI API Key 가 필요합니다." + localStorage 미변경.
  - [x] OpenAI 키 입력 + Save → 양쪽 provider 키 모두 localStorage 에 저장 (`anthropicApiKey: "sk-ant-test-12345"`, `openaiApiKey: "sk-openai-test-67890"`).
  - [x] Reset to defaults → confirm 후 DEFAULT_SETTINGS 복귀 (storage + form 모두).
  - [x] Legacy 모델 시증: `localStorage.setItem` 으로 `openaiModel: "gpt-4-turbo"` 강제 주입 후 reload → Select 트리거에 `gpt-4-turbo` 유지 (자동 reset 없음).
- [x] 회귀: Dashboard 4 카드 정상 (stdio 2 `n/a`, HTTP 2 `healthy, ~30ms`), Inspector `/inspector?server=mock-repo-mcp` 에서 3 tool (`list_repositories` / `get_file_content` / `search_code`) 렌더 정상.
- [x] 백엔드 영향 0건: `src/mcp-servers/`, `configs/`, `tests/`, `scripts/`, `Makefile`, `pyproject.toml`, `uv.lock`, `frontend/src/app/layout.tsx`, `frontend/src/components/dashboard/`, `frontend/src/components/inspector/`, `frontend/src/lib/mcp/` 모두 무변경 (`git status` 로 확인).

#### 5-1-2. 후속 wiring (5-1 범위 외, 5-4 작업 시 처리)
- Chat (5-4) 와 Inspector retrofit: 서버 전환 시 `saveSettings({selectedServer})` 1 줄 호출 추가. 본 모듈의 `saveSettings(patch: Partial<MCPSettings>)` 시그니처가 이를 자연 지원.

### 5-2. LLM 어댑터 (server-only, Anthropic / OpenAI / OpenRouter)

> 사용자 추가 요건으로 OpenRouter 도입. OpenRouter 는 OpenAI 호환 API (`https://openrouter.ai/api/v1`) 이므로 `openai` SDK 의 `baseURL` + 권장 헤더 (`HTTP-Referer`, `X-Title`) 만 바꿔 재사용: 별도 SDK 의존성 없음. 모델명은 `provider/model` 형식 (예: `anthropic/claude-sonnet-4-6`). PRD v0.1 미반영, 차기 PRD 개정 시 §3.6 / §5.3 / §7.3 / §8 에 반영 필요.

#### 5-2-0. Settings 스키마/UI 레트로핏 (5-1 결과물 확장)
- [x] `MCPSettings.llmProvider` 유니온에 `"openrouter"` 추가 → `"anthropic" | "openai" | "openrouter"`
- [x] `MCPSettings` 신규 필드 `openrouterApiKey: string`, `openrouterModel: string` (default `"anthropic/claude-sonnet-4-6"`)
- [x] `settingsSchema` zod 정의에 두 필드 추가 (`.partial()` 보존: legacy 데이터 안전)
- [x] `frontend/src/lib/storage/settings.test.ts`: 신규 3 케이스 (default / legacy 호환 / round-trip)
- [x] `frontend/src/app/settings/page.tsx`: `RadioGroup` 에 OpenRouter 추가 + API Key (show/hide) + Model **자유 입력 `Input`** (placeholder `anthropic/claude-sonnet-4-6` + 안내 문구) + `superRefine` 검증 분기

#### 5-2-1. 패키지 추가
- [x] `frontend/package.json` `dependencies`: `@anthropic-ai/sdk@^0.97.1`, `openai@^6.38.0`, `server-only@^0.0.1`
- [x] **OpenRouter 전용 SDK 없음**: `openai` SDK 의 `baseURL` 오버라이드로 처리

#### 5-2-2. `frontend/src/lib/llm/adapter.ts`: 타입/인터페이스 정본
- [x] `import "server-only";` + `import type { ToolMeta } from "@/lib/mcp/types"` 재사용 (PRD §7.3)
- [x] `ChatMessage` 통합 히스토리 (`user` / `assistant` with `toolUses?` / `tool_result`) + `ChatToolUse`
- [x] `LLMEvent` streaming union (`iteration` / `text_delta` / `tool_use` / `tool_result` / `done`)
- [x] `ChatTurnInput` (`system`, `messages`, `tools`, `onToolCall`, `maxIterations?`, `signal?`)
- [x] `LLMAdapter` 인터페이스: `chatWithTools(input): AsyncIterable<LLMEvent>`
- [x] `DEFAULT_MAX_ITERATIONS = 5` (PRD §3.6.2 step 3c) + `toMessage(err)` 공용 헬퍼

#### 5-2-3. `frontend/src/lib/llm/anthropic.ts`
- [x] `createAnthropicAdapter(apiKey, model)` factory + 클로저 lazy `new Anthropic({apiKey})`
- [x] `toAnthropicTools(tools)`: `{ name, description, input_schema }` 매핑
- [x] `toAnthropicMessages(messages)`: 통합 히스토리 → anthropic `messages` (text+tool_use 한 turn 병합, 연속 tool_result 한 user 메시지 묶음)
- [x] async generator 루프: `messages.stream` + `text_delta` 실시간 yield + `finalMessage()` 로 stop_reason / tool_use 블록 추출 + `onToolCall` 순차 dispatch + max 5 회
- [x] SDK throw → `done(stopReason:"error")` 후 종료 (예외 누설 금지)

#### 5-2-4. `frontend/src/lib/llm/openai.ts`
- [x] **내부 헬퍼** `createOpenAICompatAdapter({apiKey, model, baseURL?, defaultHeaders?})`: OpenAI 호환 엔드포인트 공용 (openrouter.ts 가 재사용)
- [x] **공개 팩토리** `createOpenAIAdapter(apiKey, model)`: 헬퍼에 baseURL 미지정
- [x] `toOpenAITools(tools)`: `{ type:"function", function:{ name, description, parameters } }`
- [x] `toOpenAIMessages(system, messages)`: system 맨 앞 + assistant `content || null` + `tool_calls[].function.arguments = JSON.stringify(input)` + `{ role:"tool", tool_call_id, content }`
- [x] async generator 루프: `chat.completions.create({stream:true})` → chunk delta 누적 (index 별 tool_call.id/name/arguments) → `finish_reason === "tool_calls"` 분기
- [x] tool_call arguments **JSON.parse 실패 시 onToolCall 호출 0 건 + `isError:true` tool_result** yield (루프 계속)
- [x] 병렬 tool_calls: 입력 순서대로 yield + dispatch (Map index 정렬)

#### 5-2-5. `frontend/src/lib/llm/openrouter.ts`
- [x] `createOpenRouterAdapter(apiKey, model)`: 5-2-4 의 `createOpenAICompatAdapter` 재사용
- [x] `baseURL = "https://openrouter.ai/api/v1"` + `defaultHeaders = { "HTTP-Referer": "http://localhost:3000", "X-Title": "mcp-connectors" }` (OpenRouter analytics 권장)
- [x] 모델명 형식 검증 없음: OpenRouter 400 응답 시 어댑터의 done(error) 경로로 자연 흡수

#### 5-2-6. `frontend/src/lib/llm/factory.ts`
- [x] `createLLMAdapter(provider, apiKey, model)`: `"anthropic" | "openai" | "openrouter"` switch 분기
- [x] 빈 `apiKey` 즉시 throw + 에러 메시지에 provider 명 포함 (5-3 Route Handler 가 400 으로 매핑)
- [x] TS exhaustive check (`const _: never = provider`), 향후 provider 추가 누락 방지

#### 5-2-7. 단위 테스트 (vitest, 기존 happy-dom config)
- [x] `frontend/vitest.config.ts`: `@` alias + `server-only` → `node_modules/server-only/empty.js` alias (vitest 가 `react-server` condition 미매치라 throw 됨 → 빈 모듈로 치환)
- [x] `adapter.test.ts` (4 케이스): `DEFAULT_MAX_ITERATIONS=5`, `toMessage`, `LLMEvent` exhaustive switch, `ChatMessage` JSON 라운드트립
- [x] `anthropic.test.ts` (9 케이스): `vi.mock("@anthropic-ai/sdk")` 클래스 mock + tool/message 변환 3종 + 단일 turn / 1 tool_use / 다중 tool_use / max_iterations / SDK throw
- [x] `openai.test.ts` (10 케이스): `vi.mock("openai")` 클래스 mock + tool/message 변환 2종 + 단일 turn / tool_call 라운드트립 / 손상 JSON / 병렬 tool_calls / max_iterations / SDK throw / constructor 인자 검증
- [x] `openrouter.test.ts` (4 케이스): `baseURL` 검증 + `defaultHeaders` 검증 + 모델명 패스스루 + tool_use 라운드트립
- [x] `factory.test.ts` (7 케이스): 3 provider dispatch + 3 provider 빈 키 throw + unknown provider

#### 5-2-8. 검증 (DoD: 본 단계 한정)
- [x] `cd frontend && npm install`: `@anthropic-ai/sdk`, `openai`, `server-only` 설치 (OpenRouter 전용 SDK 없음)
- [x] `cd frontend && npm run test`: **84/84** pass (기존 47 + Settings 신규 3 + 어댑터 신규 34. 네트워크 호출 0건, SDK 모두 vi.mock)
- [x] `cd frontend && npm run lint` clean
- [x] `cd frontend && npm run build` 0 errors: route table 동일 (`/`, `/_not-found`, `/inspector`, `/settings`)
- [x] Playwright 시각 검증:
  - 3 라디오 (Anthropic / OpenAI / OpenRouter) 정상 렌더
  - OpenRouter 선택 시 API Key + 자유 입력 모델 (placeholder `anthropic/claude-sonnet-4-6` + "예: anthropic/claude-sonnet-4-6, openai/gpt-4o, google/gemini-pro-1.5" 안내) 표시
  - Save → reload → `localStorage["mcp-connectors.settings"]` 에 9 필드 JSON 정상 직렬화 + UI 값 복원
- [x] 백엔드 영향 0건: `src/`, `configs/`, `tests/`, `scripts/`, `Makefile`, `pyproject.toml`, `uv.lock` 무변경. `uv run ruff check src/ scripts/` clean, `pytest tests/` 37/37

#### 5-2-9. 본 단계가 *하지 않는* 것 (의도적 deferred)
- SSE 인코딩 / `ReadableStream` 변환 → 5-3 (Route Handler 가 `LLMEvent` async iterable 을 `text/event-stream` 으로 직렬화)
- MCP `list_tools` / `call_tool` 호출 → 5-3 (`onToolCall` 콜백 본체는 5-3 이 `createMCPClient` 로 구현)
- 시스템 프롬프트 템플릿 로딩 / `{{server_name}}` 치환 / override 분기 → 5-3
- `MCPSettings` 의 `llmProvider` / `*ApiKey` / `*Model` 읽기 → 5-3 (Route Handler 가 request body 로 받음; 어댑터는 settings 불가지론)
- UI / 메시지 카드 / tool_use 펼침 패널 → 5-4
- 실 SDK 네트워크 호출 시증 (Anthropic + OpenAI + OpenRouter 3 종 echo→ping) → 5-5

### 5-3. 시스템 프롬프트 / Route Handler

> 5-2 의 `LLMAdapter` async iterable + `createMCPClient` 를 묶어 SSE 로 흘려보내는 단일 POST 엔드포인트. 브라우저에 LLM API 키를 노출하지 않도록 server-only 경계를 라우트에서 확정.

#### 5-3-1. 시스템 프롬프트 템플릿
- [x] `configs/prompts/chat_system.md`: PRD §7.1 골격 완성 (`{{server_name}}` / `{{tool_count}}` / `{{tool_definitions_block}}` 3 종 플레이스홀더 + 도구 호출 정책 4 항: 읽기 전용 / `untrusted_content` 데이터 취급 / 마스킹 보존 / 필수 파라미터 확인)

#### 5-3-2. 보조 모듈 (계획서 추가 산출물: 라우트 분리/재사용성)
- [x] `frontend/src/lib/llm/sse.ts`: `encodeEvent(event: LLMEvent): Uint8Array` 단일 함수. `data: <JSON>\n\n` wire format. 5-4 chat page (디코더) 가 동일 형식 공유.
- [x] `frontend/src/lib/llm/prompt.ts`: `import "server-only"` + 3 함수:
  - `renderSystemPrompt({override, serverName, tools})`: override 비어있지 않으면 통째 반환 (placeholder 치환 안 함, PRD §7.4), 아니면 템플릿 읽어 치환.
  - `renderTemplate(template, values)`: `{{key}}` 토큰 단순 치환. 미존재 토큰은 그대로 유지.
  - `toolDefinitionsBlock(tools)`: `list_tools` 결과를 `### name` 헤더 + description + JSON Schema fenced code block 으로 직렬화. 빈 배열 시 `_(no tools available)_`.
  - 템플릿 경로: `resolve(process.cwd(), "..", "configs", "prompts", "chat_system.md")`, Next.js 16 dev/build 모두 cwd 가 `frontend/` 임을 전제로 절대화.
- [x] `frontend/src/lib/llm/prompt.test.ts`: vitest 5 케이스 (renderTemplate 미존재 토큰 보존 / toolDefinitionsBlock 정상, 빈배열 / renderSystemPrompt override 통째 반환, null fallback, whitespace-only fallback)

#### 5-3-3. Route Handler: `frontend/src/app/api/chat/route.ts`
- [x] POST 핸들러 (Next.js 16 App Router, 기본 캐시 비활성)
- [x] 요청 zod 스키마: `provider("anthropic"|"openai"|"openrouter")` / `apiKey` / `model` / `serverName` / `messages[]` (discriminated union: user / assistant[+toolUses?] / tool_result) / `systemPromptOverride?` / `maxIterations?` (1~10, default 5)
- [x] **서버측 LLM API 키 사용 (브라우저 노출 차단)**: 요청 body 로만 받고 응답에 절대 echo 하지 않음. server-only 모듈만 import.
- [x] **server lookup + transport guard**: `getServerByName` 미존재 시 400 + `Unknown server '...'`. `transport !== "streamable_http"` (stdio) 시 400 + 명시 메시지.
- [x] **MCP `list_tools` → LLM tool 정의 변환**: `createMCPClient(server).listTools()` → 어댑터의 `chatWithTools({tools})` 로 그대로 전달 (어댑터 내부에서 provider 별 변환). 실패 시 502 + `Failed to list tools from '...': ...`.
- [x] **시스템 프롬프트 override 적용 (localStorage 값 우선)**: `systemPromptOverride` 가 비어있지 않으면 통째 사용, 아니면 `renderSystemPrompt` 로 템플릿 치환 (PRD §7.4).
- [x] **tool_use → MCP `call_tool` → tool_result 루프 (max 5 회)**: `buildOnToolCall(client)` 가 adapter ↔ MCP 브릿지. `callTool` 결과의 `content` 가 객체이면 `JSON.stringify`, `isError` 패스스루. `maxIterations` 는 요청값 우선 (default `DEFAULT_MAX_ITERATIONS=5`).
- [x] **응답 streaming + tool_use/tool_result 메타 포함**: `ReadableStream` 으로 `AsyncIterable<LLMEvent>` → SSE 변환. `iteration` / `text_delta` / `tool_use` / `tool_result` / `done` 5 종 이벤트 모두 클라이언트로 흐름.
- [x] SSE 응답 헤더: `Content-Type: text/event-stream; charset=utf-8` / `Cache-Control: no-cache, no-transform` / `Connection: keep-alive` / `X-Accel-Buffering: no` (nginx 등 reverse proxy 버퍼링 차단) / `X-Content-Type-Options: nosniff`
- [x] **lifecycle / cleanup**: `done` 이벤트 수신 시 루프 종료, `finally` 에서 `client.close()`, `cancel()` (클라이언트 fetch abort) 에서도 `client.close()`. adapter 는 `request.signal` 통해 SDK abort 까지 전파.
- [x] **adapter 예외 누설 방지**: adapter 내부 try/catch 가 `done(error)` 를 yield 하므로 ReadableStream `start` 의 try/catch 는 안전망 (encodeEvent 직렬화 실패 등 드문 케이스 처리).

#### 5-3-4. 라우트 통합 테스트: `frontend/src/app/api/chat/route.test.ts`
- [x] vitest 7 케이스 (`@/lib/mcp/client`, `@/lib/llm/{anthropic,openai,openrouter}` 모두 vi.mock: 실 네트워크 호출 0 건)
  - validation: invalid JSON body / empty messages / unknown provider (3 건)
  - server lookup: unknown server / stdio server 거부 (2 건)
  - happy path: end_turn-only 대화 SSE 스트림 / tool-use 루프 (MCP callTool 시증 + tool_result content JSON.stringify) (2 건)
  - failure mode: listTools throw → 502 + client.close 호출 보장 (1 건; 합계 8 케이스로 카운트됨)

#### 5-3-5. 검증 (DoD: PRD §3.6.4 부분 충족, 본 단계 한정)
- [x] `cd frontend && npm run test`: vitest **98/98** pass (5-2 의 84 + prompt 5 + route 8 + 기타 = 98). 모두 mocked, 네트워크 호출 0 건.
- [x] `cd frontend && npm run lint` clean (0 errors / 0 warnings).
- [x] `cd frontend && npm run build`: 0 errors. Route table 에 `/api/chat` (dynamic, POST) 추가.
- [x] PRD §3.6.4 의 "echo→ping" 실 SDK 호출 시증 (3 provider) 은 **5-5 로 deferred**: 본 단계는 라우트 mock 시증까지.
- [x] 백엔드 영향 0건: `src/mcp-servers/`, `configs/mcp_servers.yaml`, `tests/`, `scripts/`, `Makefile`, `pyproject.toml`, `uv.lock` 무변경. `configs/prompts/chat_system.md` 만 신규 작성 (placeholder → 본문 채움).

#### 5-3-6. 본 단계가 *하지 않는* 것 (의도적 deferred)
- Chat UI (메시지 리스트 / 카드 / tool_use 펼침 패널) → 5-4
- SSE 디코더 클라이언트 훅 → 5-4 (`encodeEvent` wire format 을 그대로 역직렬화)
- 실 SDK 네트워크 시증 (Anthropic + OpenAI + OpenRouter 3 종 `echo→ping`) → 5-5
- Settings 의 `systemPromptOverride` 와의 wiring → 5-4 (Chat page 가 `saveSettings` 의 override 값을 request body 에 실어 전송)

### 5-4. Chat 페이지

> 5-3 의 `/api/chat` SSE 스트림 (`data: <JSON>\n\n`, `LLMEvent` 유니온) 을 소비하는 클라이언트 UI. tool-use 루프는 서버 사이드 (route handler) 가 소유하고, 본 단계는 이벤트를 받아 메시지 카드 + `<details>` 펼침 패널로 가시화.

#### 5-4-1. 페이지 / 진입점
- [x] `frontend/src/app/chat/page.tsx`: `"use client"` + Next.js 16 `use(searchParams)` 패턴 (Inspector 와 동일). `?server=` 만 unwrap 해 `<ChatShell>` 에 전달.
- [x] `frontend/src/app/chat/ChatShell.tsx`: 통합 컨테이너. settings 로딩 + 서버 선택 + useChatStream + UI 컴포넌트 합성.

#### 5-4-2. 데이터 계층 (계획서 추가 산출물)
- [x] `frontend/src/lib/chat/parseSSE.ts`: byte `ReadableStream<Uint8Array>` → `AsyncIterable<LLMEvent>`. `\n\n` 경계로 buffer split + `data: ` 접두 제거 + `JSON.parse`. chunk 경계가 메시지 중간을 가로질러도 안전.
- [x] `frontend/src/lib/chat/serialize.ts`: UI ChatTurn[] ↔ adapter ChatMessage[] 변환 + `applyLLMEvent` reducer + `streamingAsTurnView` 헬퍼.
  - **iteration 경계 보존**: `AssistantTurn.iterations: AssistantIteration[]` 로 분리 저장. 다중 라운드 tool 호출 시 adapter 의 ChatMessage[] 로 정확히 재직렬화 (Anthropic/OpenAI 둘 다 round 마다 assistant 메시지 분리).
  - **미완료 tool_result 안전 처리**: `result === null` 인 tool_use 는 ChatMessage 로 직렬화하지 않음 (adapter 가 mismatched toolUseId 를 거부할 가능성 회피).
- [x] `frontend/src/lib/chat/runChatStream.ts`: fetch + SSE 디코딩의 순수 비동기 코어 (React state 의존 분리 → 단위 테스트 가능). 모든 종료 경로를 `ChatStreamOutcome` (`ok` / `http_error` / `abort` / `exception`) 으로 보고. **throw 안 함**.
- [x] `frontend/src/lib/chat/useChatStream.ts`: React hook. `runChatStream` + `applyLLMEvent` 합성 + abort controller. 노출: `{ turns, streaming, status, error, send, abort, reset }`.

#### 5-4-3. UI 컴포넌트
- [x] `frontend/src/components/chat/MessageList.tsx`: turns + (있다면) streaming partial assistant turn 을 순서대로 렌더 + 새 chunk 마다 bottom auto-scroll (`scrollIntoView`).
- [x] `frontend/src/components/chat/MessageCard.tsx`: user/assistant 단일 카드. assistant 는 `react-markdown` + `remark-gfm` 으로 본문 렌더 + 하단 ToolUsePanel + stopReason 배지 (`max_iterations` → amber / `error` → destructive).
- [x] `frontend/src/components/chat/ToolUsePanel.tsx`: `<details>` 펼침 패널 (PRD §3.6.4 명시 선호, shadcn Collapsible 대신 raw HTML 채택, 의존성 0). 각 호출은 이름 헤더 + arguments `<pre>` + result `<pre>` 3 단. result null 이면 spinner ("Calling…"), isError true 면 destructive 색상.
- [x] `frontend/src/components/chat/Composer.tsx`: Textarea + Send. Enter 전송 / Shift+Enter 줄바꿈 / **IME 한글 조합 중 Enter 무시** (`event.isComposing` 가드) / streaming 중 Send → 중지 버튼으로 토글.
- [x] `frontend/src/components/chat/ChatToolbar.tsx`: 상단 툴바. Inspector `ServerSelect` 재사용 + provider/model `Badge` + "대화 초기화" 버튼.

#### 5-4-4. 기존 파일 수정
- [x] `frontend/package.json`: `dependencies` 에 `react-markdown@^9` + `remark-gfm@^4` 추가.
- [x] `frontend/src/app/inspector/page.tsx`, **5-1-2 deferred wiring 처리**: `handleServerChange` 콜백 추가 (setServerName + `saveSettings({selectedServer})`) → `<ServerSelect onChange={handleServerChange}>`. ServerSelect 컴포넌트 자체는 무수정 (재사용성 보존, Chat 도 동일 패턴).

#### 5-4-5. 단위 테스트 (계획서 추가 산출물)
- [x] `frontend/src/lib/chat/parseSSE.test.ts`: vitest 6 케이스 (단일/연쇄 event, chunk 경계 split, 빈 라인 무시, malformed JSON skip, done 후 종료).
- [x] `frontend/src/lib/chat/serialize.test.ts`: vitest 9 케이스 (serialize 4 + reducer 5: user only, text-only assistant, multi-iteration with tool, in-flight tool_result null, text_delta 누적, iteration 경계 보존, tool_result 매칭 by id, stopReason/error 보존, streamingAsTurnView).
- [x] `frontend/src/lib/chat/runChatStream.test.ts`: vitest 5 케이스 (happy path, tool_use cycle, HTTP 400 JSON 에러 표면화, AbortError → abort outcome, 비-Abort fetch 예외 → exception outcome). 네트워크 mock: `vi.stubGlobal("fetch", ...)` + ReadableStream 직접 주입.

#### 5-4-6. 구현 중 발견 / 의도적 보강
- **React 19 lint 룰 회피**: `react-hooks/refs` (render 중 ref 변경 금지) → useChatStream 의 `turnsRef` 동기화를 `useEffect([turns])` 로 분리. `react-hooks/set-state-in-effect` → ChatShell 의 `didSyncUrlRef` 를 `useState` → `useRef` 로 변환해 cascading render 회피.
- **Settings 변경 반영**: ChatShell 의 `window.addEventListener("focus", reload)` 패턴으로 Settings 페이지에서 변경 후 Chat 으로 복귀 시 자동 reload (동일 탭에서 storage event 미발화 한계 우회).
- **URL ↔ serverName 1회 동기화**: `didSyncUrlRef` 일회성 guard. 초기 URL 에 `?server=` 가 없거나 invalid 일 때 settings.selectedServer/fallback 으로 resolve 후 URL 보정 (북마크 친화).
- **react-markdown link 안전 처리**: `components.a` 오버라이드로 모든 외부 링크 `target="_blank" rel="noopener noreferrer"`.
- **client/server boundary**: parseSSE / serialize / runChatStream / useChatStream 모두 **server-only 값 import 0건** (type-only import 만). adapter.ts 의 `import "server-only"` 부수효과 차단.

#### 5-4-7. 자동 검증 (DoD)
- [x] `cd frontend && npm run test`: vitest **118/118** pass (이전 98 + parseSSE 6 + serialize 9 + runChatStream 5 = 118). 네트워크 호출 0건, 모두 mock.
- [x] `cd frontend && npm run lint`: clean (0 errors / 0 warnings).
- [x] `cd frontend && npm run build`: 0 errors. Route table: `/`, `/_not-found`, `/api/chat` (dynamic), **`/chat` (dynamic, 신규)**, `/inspector` (dynamic), `/settings` (static).
- [x] 백엔드 회귀: `uv run pytest tests/` 37/37, `uv run ruff check src/ scripts/` clean (변경 0건).

#### 5-4-8. Playwright UI 정합성 검증
- [x] `/chat` 진입 → `/chat?server=echo-mcp-http` 로 URL 자동 동기화 (settings 빈 상태에서 첫 reachable 서버로 fallback): console error 0건.
- [x] nav 4 링크 (Dashboard / Inspector / Chat / Settings) 모두 활성.
- [x] ChatToolbar: 서버 select + `anthropic` / `claude-sonnet-4-6` 배지 + "대화 초기화" 버튼 (turns 비었을 때 disabled).
- [x] API Key 미설정 시: amber 배너 ("anthropic API Key 가 설정되지 않았습니다") + `/settings` 링크 + Composer textarea/Send 버튼 disabled + placeholder "Settings 에서 API Key 를 입력하세요".
- [x] Inspector ServerSelect retrofit 시증: `/inspector` 에서 서버 변경 → `localStorage["mcp-connectors.settings"].selectedServer` 가 변경된 서버명으로 저장됨 확인.
- [x] Dashboard 회귀: 4 카드 (stdio 2 `n/a (stdio)` + HTTP 2 `healthy, ~30ms`) 정상.

#### 5-4-9. 본 단계가 *하지 않는* 것 (의도적 deferred)
- 실 SDK 네트워크 호출 시증 (Anthropic + OpenAI + OpenRouter `echo→ping`) → **5-5** (사용자 환경의 API Key 의존).
- 채팅 히스토리 영속화 (sessionStorage / localStorage / DB): 새로고침 시 초기화.
- 다중 서버 동시 연결 (한 시점에 1 서버만).
- tool result syntax highlighting (`<pre>` plain monospace).
- `recentToolCalls` 에 chat 으로 발생한 도구 호출 기록 (Inspector 만 기록: 5-1 합의).
- Streaming 중 일부 cancel ("이 응답만 그만"): abort 시 전체 turn 중단.

### 5-5. 검증 (DoD: PRD §3.6.4 + OpenRouter 추가)
- [x] *"echo 로 'ping' 보내줘"* → LLM 이 `echo(text="ping")` 호출 → `"ping"` 응답 가시화 *(Anthropic 시증 완료. OpenAI / OpenRouter 는 키 미확보로 deferred)*
- [x] tool_use / tool_result 가 각 어시스턴트 메시지 하단 `<details>` 펼침 패널에 표시 *(Anthropic 시증으로 가시화 메커니즘 검증 완료: provider 무관 UI 컴포넌트)*
- [~] Anthropic / OpenAI / OpenRouter 3 종 모두에서 위 시나리오 동작 *(Anthropic 만 시증. OpenAI / OpenRouter 는 키 확보 후 동일 절차로 재현 가능: 어댑터 단위 테스트는 5-2-7 에서 23 케이스 통과)*

#### 5-5-1. Anthropic 실 SDK 시증 결과 (2026-05-21)
- 시증 절차서: 로컬 계획서 (`~/.claude/plans/` 아래 개인 작업 파일, 저장소 미포함)
- 입력: `echo 로 'ping' 보내줘` → 서버 `echo-mcp-http`, provider `anthropic` / model `claude-sonnet-4-6`
- **SSE event 시퀀스** (실측, 시간 순):
  ```
  iteration(index=0) → text_delta×3 → tool_use(echo, {text:"ping"}) → tool_result({"result":"ping"}, isError:false)
    → iteration(index=1) → text_delta×4 → done(stopReason:"end_turn")
  ```
- **iteration 실측 2 회**: 계획서의 "1 회만 발생" 추정 정정. Anthropic 은 tool-use 라운드(0) + 최종 응답 라운드(1) 로 항상 2 iteration 발화. PRD §3.6.2 step 3c 의 "max 5 회" 는 라운드 상한이지 실측 기댓값이 아님.
- **tool_use_id 형식**: `toolu_01UREXrPpqbvug7qXnVvmhUM` (Anthropic SDK 의 `toolu_` 프리픽스). OpenAI 는 `call_` 프리픽스 예상.
- **`<details>` 패널 펼침 상태에서의 렌더 검증**: 헤더 `도구 호출 1건` / 도구명 `echo` / arguments `{"text":"ping"}` / result `{"result":"ping"}` 모두 표시 ([frontend/src/components/chat/ToolUsePanel.tsx](../../frontend/src/components/chat/ToolUsePanel.tsx)).
- **응답 헤더** (`POST /api/chat`):
  - `content-type: text/event-stream; charset=utf-8`
  - `cache-control: no-cache, no-transform`
  - `x-accel-buffering: no` (nginx 버퍼링 차단)
  - `connection: keep-alive`
  - `x-content-type-options: nosniff`
  - `transfer-encoding: chunked`
- **API key 누설 검사**: SSE body 24 줄 전체에 `sk-ant-` 프리픽스 + 전체 키 문자열 0 건. server-only 모듈 격리 ([frontend/src/app/api/chat/route.ts](../../frontend/src/app/api/chat/route.ts)) 정상.
- **콘솔 에러 0 건** (`browser_console_messages level=error` 결과).
- 증빙 스크린샷: `5-5-anthropic-ping.png` (저장소 루트, gitignore 권장).

#### 5-5-2. 부수 시증 (계획서 §시증 6 부가 회귀)
- **systemPromptOverride wiring (5-3-6 deferred 마무리)**: Settings 에 `"너는 ping-only 봇이다. 모든 답을 정확히 'ping' 한 단어로만 종료해라."` 주입 → `/chat` 에서 임의 입력(`안녕? 너는 뭐 할 줄 알아?`) → 응답 마지막이 `"무엇이든 말씀해 주세요! ping"` 으로 종료. override 가 통째 사용됨이 정황 증거로 확인 ([prompt.ts:renderSystemPrompt](../../frontend/src/lib/llm/prompt.ts)).
- **toolDefinitionsBlock 부수 시증**: 동일 응답이 `echo` / `add` / `current_time` 3 도구를 본인 능력으로 안내 → MCP `list_tools` → 시스템 프롬프트 주입 경로가 end-to-end 동작.
- **대화 초기화**: turns 비워짐 + 이전 메시지 사라짐 + Composer 활성 유지. ✓
- **Inspector 회귀**: `/inspector?server=mock-repo-mcp` 에서 3 도구 (`list_repositories` / `get_file_content` / `search_code`) 정상 렌더. ✓
- **Dashboard 회귀**: 4 카드 (stdio 2 종 `n/a` + HTTP 2 종 `healthy`). ✓
- **IME 가드 / abort**: Playwright 자동화로 시증 어려움 (조합 이벤트 직접 발화 / streaming 종료가 너무 빨라 timing 불가). 5-4-3 (`event.isComposing` 코드 가드) + 5-4-5 runChatStream 단위 테스트 (AbortError → abort outcome) 로 갈음.

#### 5-5-3. 회귀 검증 (코드 변경 0 건 확인)
- `uv run pytest tests/` 37/37 green
- `cd frontend && npm run test` 118/118 green
- `cd frontend && npm run lint` clean
- `cd frontend && npm run build` 0 errors (route table 변경 0)
- `uv run ruff check src/ scripts/` clean
- `git status`: `5-5-anthropic-ping.png` 만 untracked (증빙 스크린샷). 본 §5-5 절 외 코드 변경 0 건.

#### 5-5-4. OpenAI / OpenRouter 시증을 위한 재현 절차 (키 확보 후)
1. `make run-echo-mcp-http` + `make frontend-dev`
2. `/settings` → 해당 provider 라디오 선택 → API Key 입력 → (OpenRouter 는 model `anthropic/claude-sonnet-4-6` 자유 입력) → Save
3. `/chat?server=echo-mcp-http` 에서 `echo 로 'ping' 보내줘` 전송
4. 5-5-1 의 SSE 시퀀스 / `<details>` 패널 / API key 누설 검사 동일 절차 반복
5. **OpenAI 시증 시 주의**: tool_call arguments 가 JSON.parse 실패 시 어댑터가 `isError:true` tool_result fallback 으로 처리 ([openai.ts](../../frontend/src/lib/llm/openai.ts)). `ping` 시증에서는 정상 parse 되어야 함.
6. **OpenRouter 시증 시 주의**: `HTTP-Referer: http://localhost:3000` + `X-Title: mcp-connectors` 헤더 자동 주입, OpenRouter 콘솔(https://openrouter.ai/activity)에서 `mcp-connectors` 집계 확인 가능 (선택).

> **참고**: 5-4 완료 시점에 인프라 (UI + SSE 디코딩 + tool-use 루프) 는 모두 준비됨. 5-5-1 의 절차는 사용자 API Key 만 있으면 5-10 분 안에 재현 가능.

---

## Phase 6: 통합 테스트 & 인수 검증 (F-7)

**목표:** PRD §9 의 모든 인수 기준 통과 + 차기 개발자 30 분 인수 시나리오 확립
**의존성:** Phase 0 ~ 5 전체
**기능 ID:** F-7
**참조 일정:** 부록 A Day 10

### 6-1. Frontend E2E (Playwright)
- [x] `frontend/tests/e2e/inspector.spec.ts`: Inspector happy path 1 건 (`mock-repo-mcp.list_repositories` 결과 카드 렌더)
- [x] `frontend/package.json` 의 `scripts.test:e2e` 추가 (`"test:e2e": "playwright test"`)
- [x] `frontend/playwright.config.ts`

#### 6-1-0. 계획서 추가 산출물 / 의도적 보강
- [x] `frontend/tests/e2e/global-setup.ts`: `make run-mock-repo-mcp` 를 detached process group 으로 spawn + `:8002/mcp` MCP `initialize` POST polling (200ms × 50회). 이미 떠 있으면 (lsof 가드) skip + `E2E_MCP_OWNED=0`.
- [x] `frontend/tests/e2e/global-teardown.ts`: `E2E_MCP_OWNED=1` 일 때만 `process.kill(-pid, SIGTERM)` 후 500ms grace, 잔존 시 `SIGKILL`. 외부 인스턴스는 보존.
- [x] `frontend/vitest.config.ts`: `test.exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".next/**"]` 추가. vitest 와 Playwright 디렉토리 분리.
- [x] `Makefile` `test-e2e` target (`.PHONY` 등재): 첫 줄 `npx playwright install chromium` (idempotent) + `npm run test:e2e`. mock-repo-mcp 의존 target 불필요 (globalSetup 이 직접 spawn).
- [x] 루트 `.gitignore`: `frontend/playwright-report/`, `frontend/test-results/`, `frontend/playwright/.cache/` 추가.

#### 6-1-1. 검증 (DoD: PRD §9 인수 기준 #5/#7)
- [x] 깨끗한 워크트리 (port 8002/3000 free) 에서 `make test-e2e` → `1 passed (chromium)`, 5.3s.
- [x] 테스트 종료 후 `lsof -ti:8002` 비어 있음 (좀비 mock-repo-mcp 없음, teardown SIGTERM 정상).
- [x] `cd frontend && npm test` (vitest) → 12 files / 118 tests pass, `tests/e2e/*.spec.ts` 픽업 0 건.
- [x] `cd frontend && npm run lint` clean.
- [x] `cd frontend && npm run build` 0 errors (route table 회귀 없음: `/inspector` dynamic 유지, `tests/e2e/` 가 빌드에 잡히지 않음).
- [x] `uv run ruff check src/ scripts/` All checks passed.
- [x] `pytest tests/` 37/37 pass (E2E 도입이 Python 서버 회귀 없음).

#### 6-1-2. 구현 중 발견 / 학습
- ResponseViewer 의 `@uiw/react-json-view` 가 `collapsed={2}` 로 사용되어 배열 안 객체가 `0 : { ... }` 형태로 접힘 → fixture 의 `alpha-service` 등 *깊은 값* 텍스트는 트리뷰에서 직접 가시되지 않는다. 펼침 토글은 svg 아이콘이라 안정적 selector 부재. 어설션을 **collapsed 상태로도 검증 가능한 상위 구조** (`"repositories":[`, 배열 element 3개, `"total_count":3`) 로 조정하여 PRD §9 #5 ("카드 형태로 결과 렌더") 충족.
- Playwright 1.60.0 + Next.js 16.2.6 조합에서 `webServer.command: "npm run dev"` + `reuseExistingServer: !CI` 패턴이 그대로 동작. 별도 standalone 빌드 불필요.
- globalSetup 에서 `lsof -ti:8002` 가드를 두어 개발자가 수동으로 mock-repo-mcp 를 띄워둔 상태에서도 E2E 가 깨지지 않도록 한다 (idempotent).

### 6-2. 린트 / 정합성
- [x] `uv run ruff check src/` 0 errors
- [x] `uv run ruff format src/ scripts/` clean
- [x] `cd frontend && npm run lint` clean

### 6-3. 문서 갱신
- [x] `README.md`: 프로젝트 개요 + 4 페이지 + `/mcp-spec-writer`, `/mcp-server-builder` 워크플로우 + 30 분 인수 시나리오
- [x] `CLAUDE.md` 갱신 (현재 템플릿 → MCP Connectors 컨벤션 반영)

### 6-4. 최종 인수 검증 (DoD: PRD §9 10 항목 전체)

> 실행 계획: 로컬 계획서 (`.claude/plans/` 아래 개인 작업 파일, 저장소 미포함) (§6-4-A ~ §6-4-K, 11 단계). 2026-05-22 1 차 라운드 8/10 통과, OpenAI Chat (§6-4-I) + 30 분 dry-run (§6-4-J) 보류.

- [x] `make test-echo-mcp` 통과: 10/10
- [x] `make test-mock-repo-mcp` 통과: 16/16
- [x] `make test-simple-mcp-server` 통과 *(사용자 추가 요건)*: 11/11
- [x] `python scripts/mcp_cli.py call --server echo-mcp --tool echo --params '{"text":"hi"}'` → `"hi"` 반환 (`make cli-call-echo` 출력: `{"result":"hi"}`)
- [x] Inspector 페이지에서 `mock-repo-mcp.list_repositories()` 호출 → 카드 형태로 결과 렌더 (Playwright MCP 자동 시증: `Response (410 B, 42 ms)` + `"total_count": 3`)
- [ ] Chat 페이지에서 *"echo 로 'ping' 보내줘"* → `echo` 도구 호출 → `"ping"` 응답 (Anthropic, OpenAI 둘 다): **Anthropic ✅ 통과** ("echo 도구를 호출해 'ping'을 보내겠습니다!" → tool call 1 건 → "입력: ping 반환: ping"). **OpenAI 보류** (`.env` 에 `OPENAI_API_KEY` 미설정, 키 확보 후 §6-4-I 재실행 필요)
- [x] `frontend/tests/e2e/inspector.spec.ts` Playwright happy path 1 건 green: `1 passed (5.3s)`, 좀비 mock-repo-mcp 0
- [x] `uv run ruff check src/` 0 errors: `make lint-all` (ruff check + ruff format --check + eslint) 모두 exit 0
- [x] `src/mcp-servers/simple_mcp_server/README.md` 가 "신규 서버 만드는 5 단계" 를 포함 *(사용자 추가 요건)*: `## 5. 신규 서버 만드는 5 단계` heading (line 69) + 5 번호 절차 (1.~5.) 모두 존재
- [ ] 차기 개발자가 `README.md` + `/mcp-spec-writer` + `/mcp-server-builder` 만 보고 **30 분 내** 서버 1 개 추가 가능 (셀프 dry-run 으로 확인): **사용자 별도 신규 Claude Code 세션에서 수행 예정** (현재 세션은 이미 프로젝트 컨텍스트 보유 → fresh perspective 재현 불가)

#### 6-4-1. 구현 중 발견 / 학습
- **Chat 페이지는 BYOK (Bring Your Own Key) 패턴**: `.env` 의 `ANTHROPIC_API_KEY` 는 서버 라우트 (`frontend/src/app/api/chat/route.ts`) 가 *기본값 fallback* 으로만 사용하고, 실제 호출은 `frontend/src/lib/storage/settings.ts:3` `mcp-connectors.settings` localStorage 값에서 키를 읽어 클라이언트가 요청에 포함시킨다. 차기 시증 시에는 `.env` 가 설정되어 있어도 *Settings UI 입력 또는 localStorage 직접 주입* 이 필요함 (헤더 영역에 "anthropic API Key 가 설정되지 않았습니다" 경고 + 입력창 disabled).
- **Playwright MCP `browser_run_code_unsafe` 의 VM context 는 sandboxed**: `require`, `process`, 동적 `import` 모두 차단됨 (`ReferenceError: require is not defined`, `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). 키 주입은 (a) Bash 로 `/tmp/.akey` 추출 + Read 로 호출자가 읽어 (b) `page.evaluate((apiKey) => localStorage.setItem(...), keyLiteral)` 패턴이 유일한 경로. 이 과정에서 키 값이 한 번 tool 인자에 노출되므로, 시증 후 `rm /tmp/.akey` + `localStorage.removeItem` 으로 즉시 폐기.
- **백그라운드 서버 기동의 셸 `cmd > log 2>&1 &` 패턴이 정상 작동**: Bash 도구의 `run_in_background` 와 결합 시 부모 셸이 즉시 종료해도 자식 (mock-repo-mcp / frontend-dev / echo-mcp-http) 은 orphan 으로 살아남고, 종료 시 `lsof -ti:<port> | xargs kill -TERM` 으로 깨끗하게 정리됨. teardown 후 8001/8002/3000 좀비 0.
- **`cd frontend && <cmd>` 후 cwd 가 persist**: Bash 도구의 working directory 가 셀 호출 사이에 유지되므로 (`tool description: "The working directory persists between commands"`), `cd` 사용 시 다음 호출 전에 `cd <저장소 루트>` 로 복귀해야 함. 이로 인해 `make test-e2e` 가 frontend/ 에서 1 회 "No rule" 실패. CLAUDE.md 의 `frontend-*` 패턴 자체는 `cd frontend &&` 를 내장한 Makefile target 을 통하므로 사용자 명령에는 영향 없음.
- **Inspector 결과 카드 렌더는 §6-1-2 학습대로 collapsed JSON view 에서 검증 가능**: `@uiw/react-json-view collapsed={2}` 가 배열 원소를 `0 : { ... }` 로 접지만 `"total_count": 3` 같은 상위 스칼라는 가시됨. Playwright MCP 의 `body.innerText` 정규식 매치 (`/"total_count"[^,}]*:[^,}]*3/`) 가 안정적 어설션.

#### 6-4-2. 잔여 항목 / 후속 액션
- [ ] **§6-4-I OpenAI Chat 시증**: `.env` 에 `OPENAI_API_KEY=sk-...` 추가 후 본 계획서 §6-4-I 단계 1 회 실행 (Provider 만 OpenAI 로 전환, 동일 메시지 "echo 로 'ping' 보내줘", tool call 1 건 + "ping" 응답 확인). 5~10 분 소요 예상.
- [ ] **§6-4-J 30 분 인수 셀프 dry-run**: 사용자가 별도 Claude Code 세션 (또는 신규 IDE 창) 에서 `README.md` + `/mcp-spec-writer` + `/mcp-server-builder` 만으로 toy `greet-mcp` 서버 1 개 추가. 측정 후 본 §6-4-2 에 경과 시간 기록.
- 위 두 항목이 통과되면 §6-4 전체가 `[x]` 로 종료되며 MVP 완료 (PRD §9 10/10).

---

## Phase 의존성 다이어그램

```
Phase 0 (환경 셋업)
    │
    └── Phase 1 (_common/, F-8)
            │
            └── Phase 2 (MCP 서버 3종, F-1B/F-1/F-2)
                    │
                    ├── Phase 3 (Python CLI, F-3) ──────┐
                    │                                    │
                    └── Phase 4 (Frontend 기반 + Inspector, F-6/F-4)
                                │
                                └── Phase 5 (Chat + Settings, F-5)
                                        │
                                        └── Phase 6 (통합 검증, F-7)
```

> Phase 3 과 Phase 4 는 Phase 2 완료 이후 *병렬 착수 가능*: 단, Phase 4-2 (MCP 직결 어댑터) 는 Phase 3 의 `configs/mcp_servers.yaml` 완성을 참조하므로 레지스트리 확정 이후 시작.

---

## 검증 지표 (MVP 성공 기준)

PRD §9 에 정의된 10 개 인수 기준 (Phase 6-4 체크리스트와 동일) 을 모두 만족하면 MVP 종료.

| 항목 | 목표 |
|---|---|
| MCP 서버 3 종 테스트 | `make test-echo-mcp`, `make test-mock-repo-mcp`, `make test-simple-mcp-server` 모두 pass |
| CLI 시나리오 | `echo` 호출 → `"hi"` 반환 |
| Inspector 시나리오 | `mock-repo-mcp.list_repositories()` 카드 렌더 |
| Chat 시나리오 | Anthropic + OpenAI 모두 `echo("ping")` → `"ping"` |
| Playwright e2e | 1 건 green |
| 린트 | `ruff check src/` 0 errors |
| 동봉 샘플 문서 | `simple_mcp_server/README.md` 에 "신규 서버 5 단계" |
| 30 분 인수 | README + 두 스킬만으로 신규 서버 1 개 추가 가능 |

---

## 주요 파일 참조

- [docs/PRD.md](PRD.md): 요구사항 원천 (§3 기능, §4.4 디렉토리, §5.2 레지스트리, §7 프롬프트, §9 성공 지표, 부록 A 일정)
- [docs/task-plan-template.md](task-plan-template.md): 본 계획서의 양식 정본
- [docs/meta-prompt.md](meta-prompt.md): MCP Connectors 메타 프롬프트
- [.claude/skills/mcp-spec-writer/SKILL.md](../../.claude/skills/mcp-spec-writer/SKILL.md): 정의서 작성 스킬
- [.claude/skills/mcp-server-builder/SKILL.md](../../.claude/skills/mcp-server-builder/SKILL.md): 서버 빌드 스킬 (Phase 1 의 `_common/` 자동 생성 정본)
- [CLAUDE.md](../../CLAUDE.md): 코딩 컨벤션 (ruff line-length=105, py312)
