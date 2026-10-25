# PRD 작성 메타 프롬프트: MCP Connectors (사내 시스템 ↔ AI Agent 연동 MCP 서버 개발/검증 코드베이스)

> **역사 문서**: MVP(v0.1) 당시의 설계 기록이며 현재 코드와 다를 수 있습니다. 현재 기준은 코드와 [docs/update-plan.md](../update-plan.md)입니다.

## 프롬프트 사용법

1. 아래 "메타 프롬프트" 블록 전체(코드펜스 안)를 복사한다.
2. Claude Code 신규 세션에 그대로 붙여넣어 실행한다.
3. 출력은 `docs/PRD.md` 한 파일로 저장되며, 이후 본 코드베이스 구현(아래 워크플로우)이 이 PRD를 기준으로 진행된다.
4. MCP 서버 자체의 코드는 본 PRD가 아닌 **`/mcp-spec-writer` → `/mcp-server-builder`** 흐름으로 별도 생성한다. 본 PRD는 그 둘이 동작하는 *주변 코드베이스*(클라이언트, 프론트엔드, 테스트, 설정)에 집중한다.

---

## 메타 프롬프트

```
당신은 솔로 개발자를 위한 PRD 전문가입니다.
아래 프로젝트 정보를 바탕으로 실용적이고 개발 가능한 PRD 문서를 작성해주세요.

## 프로젝트 개요

**프로젝트명**: MCP Connectors (사내 시스템 ↔ AI Agent 연동 MCP 서버 개발/검증 코드베이스)

**핵심 목표**:
MCP Connectors는 기업 사내 시스템(코드 저장소, RDB, DW, 메타정보 카탈로그, 사내 API 등)을 AI Agent와 연결하기 위해 다수의 MCP 서버를 동일 컨벤션으로 개발, 검증, 운영하는 통합 코드베이스이다.
실제 MCP 서버는 사내 폐쇄망에서만 배포되므로, **로컬 환경에서 stdio / Streamable HTTP 양쪽 transport로 동작을 약식 검증**할 수 있는 Python CLI 클라이언트와 Next.js 기반 검증용 프론트엔드를 함께 제공하는 것이 본 코드베이스의 책임이다.
본 MVP는 *실제 사내 서버를 1개도 포함하지 않은 코드베이스*를 완성하는 것이 목적이며, baseline MCP 서버 2종(`echo-mcp`, `mock-repo-mcp`)으로 e2e 파이프라인을 시증한다. 실 사내 서버는 향후 `/mcp-spec-writer`, `/mcp-server-builder` 스킬을 통해 추가될 예정이므로, 본 PRD는 *해당 스킬들이 만들어 낼 산출물 구조를 가정한 채 그 주변을 채우는 것*에 집중한다.


**사용자 (개발자) 시나리오**:

0. 사전 준비
   - `uv sync --extra dev` 로 Python 의존성 동기화
   - `frontend/` 에서 `npm install`
   - `cp .env.example .env` 후 ANTHROPIC_API_KEY / OPENAI_API_KEY 입력 (둘 다 비워도 Inspector는 동작)

1. 신규 MCP 서버 정의서 작성
   - Claude Code 에서 `/mcp-spec-writer` 실행
   - 인터뷰 종료 후 `docs/mcp-spec/<server-name>_v0.1.md` 자동 생성

2. MCP 서버 스캐폴드 생성
   - `/mcp-server-builder` 실행, 위 정의서 경로 지정
   - 생성 위치: `src/mcp-servers/<snake_name>/` + `tests/<snake_name>/`
   - 의존성 추가: `uv add fastmcp httpx pydantic-settings tenacity`

3. 서버 기동 및 1차 검증 (CLI)
   - stdio: `make run-<snake_name>`
   - Streamable HTTP: `make run-<snake_name>-http` (포트 자동 할당)
   - `python scripts/mcp_cli.py list-tools --server <name>`
   - `python scripts/mcp_cli.py call --server <name> --tool <tool> --params '{...}'`

4. 프론트엔드 Inspector 검증
   - `cd frontend && npm run dev` → `http://localhost:3000`
   - 대시보드(`/`)에서 서버 카드 헬스체크 확인
   - `/inspector` → 서버 선택 → tool 목록 → 폼 자동 생성 → 호출 → JSON 응답 패널 확인

5. 프론트엔드 Chat 검증 (LLM tool-use 루프)
   - `/chat` → 모델(Anthropic / OpenAI) 선택
   - 자연어 입력 → LLM 이 baseline tool 호출 → 응답 표시
   - tool_use / tool_result 단계가 메시지 흐름에 가시화

6. 회귀 테스트
   - `make test-<snake_name>` (Tool 단위 unit + FastMCP in-memory client e2e)
   - `cd frontend && npm run test:e2e` (Playwright happy path 1건)

7. 저장 / 공유
   - 정의서: `docs/mcp-spec/`
   - 서버 코드: `src/mcp-servers/<snake_name>/`
   - 변경: git commit

## 기술 스택 (고정)

| 구분 | 기술 | 비고 |
|---|---|---|
| Python 런타임 | Python 3.12 + uv | `pyproject.toml` 기존 설정 유지 |
| MCP 서버 | FastMCP | stdio + Streamable HTTP 양쪽 지원 |
| 데이터 모델 | pydantic v2, pydantic-settings | Tool 입력/출력 + 설정 |
| HTTP 클라이언트 | httpx (async) | CLI + Mock 백엔드 호출 |
| 재시도 | tenacity | `_common/retry.py` 에서 한 번만 정의 |
| 백엔드 Mock | MockBackendClient (정의서 §5.2 출력 예시 그대로 반환) | mcp-server-builder 가 자동 생성 |
| 테스트 (Python) | pytest, pytest-asyncio, pytest-httpx | FastMCP in-memory client 종단간 |
| 린트/포맷 | ruff (line-length 105, target py312) | 기존 pyproject 설정 유지 |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui | CLAUDE.md 스택과 정합 |
| MCP TS 클라이언트 | `@modelcontextprotocol/sdk` (Frontend 직결용) | Streamable HTTP fetch |
| LLM SDK | `@anthropic-ai/sdk` + `openai` (Node) | Next.js Route Handler 내부에서만 사용 |
| Frontend 테스트 | Playwright (e2e 1건) | Inspector happy path |
| 패키지 매니저 | uv (Python) / npm (Node) | 변경 없음 |
| 공유 모듈 | `src/mcp-servers/_common/` (logging / masking / trust / retry / auth / errors) | mcp-server-builder 첫 실행 시 자동 생성 |

> **참고**: 본 MVP는 데이터베이스(RDB/Vector DB)를 사용하지 않는다. 사내 시스템 연동의 *Mock 검증*이 목적이므로 영속 저장이 필요 없다. Frontend 의 사용자 설정(모델, API 키, 최근 호출)은 `localStorage` 에 둔다.

## PRD 작성 요구사항

### 1. 문서 구조

다음 9 섹션을 빠짐없이 포함하여 작성하세요. 각 섹션 안에 표, 코드 블록, 디렉토리 트리 등 *바로 구현 가능한 수준*의 디테일을 둡니다.

1. **프로젝트 개요**
   - 프로젝트 이름 및 한줄 설명
   - 해결하려는 문제 (사내 환경 검증 부재, MCP 서버 컨벤션 표준화)
   - 핵심 가치 제안 (스킬 워크플로우 표준화 + 로컬 e2e 검증)

2. **사용자 정의**
   - 주 사용자: MCP 서버 개발자 (1인)
   - 부 사용자: 코드베이스를 인수하여 사내 서버를 추가할 차기 개발자
   - 각 사용자별 니즈와 목표 명시

3. **핵심 기능 (MVP 범위)**
   다음 8 기능을 **Must Have** 로 포함하고, 각 항목별 상세 요구사항(입출력/에러/경로)을 표 또는 항목 리스트로 기술:
   - F-1: `echo-mcp` baseline 서버 (`echo`, `add`, `current_time`)
   - F-2: `mock-repo-mcp` baseline 서버 (`list_repositories`, `get_file_content`, `search_code`, Mock 데이터)
   - F-3: Python CLI MCP 클라이언트 (`scripts/mcp_cli.py`): `list-servers`, `list-tools`, `call` 서브커맨드. transport 자동 분기 (`stdio` vs Streamable HTTP)
   - F-4: Frontend Inspector 페이지: 서버 선택 → tool 메타 → JSON Schema → 폼 자동 생성 → 호출 → 응답 트리뷰
   - F-5: Frontend Chat 페이지: Anthropic / OpenAI 멀티 프로바이더, tool_use ↔ tool_result 루프 시각화
   - F-6: Frontend → MCP 서버 직결 어댑터 (`frontend/src/lib/mcp/`): Streamable HTTP, CORS 처리
   - F-7: 테스트 (Tool 단위 unit + FastMCP in-memory client e2e + Playwright Inspector happy path 1건)
   - F-8: `_common/` 공유 모듈 (mcp-server-builder 가 자동 생성, PRD 에서는 *경계와 의존 관계*만 명시)

   각 기능에 대해 **선행 의존성** 과 **완료 기준(definition of done)** 을 함께 적습니다.

4. **시스템 아키텍처**
   - 컴포넌트 다이어그램 (텍스트 트리 또는 mermaid)
     ```
     [Developer] → [Python CLI] → (stdio | HTTP) → [MCP Server] → [MockBackendClient]
     [Developer] → [Next.js Inspector / Chat] → fetch (Streamable HTTP) → [MCP Server]
                                              ↘ Route Handler → Anthropic / OpenAI API
     ```
   - **Frontend ↔ MCP 서버는 BFF 없이 직결**. 별도 FastAPI 서버를 두지 않음.
   - LLM API 호출은 반드시 Next.js Route Handler (server-side) 에서 처리하여 API 키 노출 방지.
   - 페이지 라우팅 (최대 4 페이지):
     - `/` 대시보드 (서버 카드, 헬스체크)
     - `/inspector` 단일 서버 도구 검증기
     - `/chat` Tool-aware 채팅
     - `/settings` 모델, 엔드포인트, API 키 (`localStorage`)

5. **데이터 모델**
   - **DB 없음** (의도적 제외, MVP 범위 보호)
   - 서버 레지스트리: `configs/mcp_servers.yaml`
     ```yaml
     servers:
       - name: echo-mcp
         transport: stdio
         command: ["uv", "run", "python", "-m", "echo_mcp.server"]
       - name: echo-mcp-http
         transport: streamable_http
         url: http://localhost:8001/mcp
       - name: mock-repo-mcp
         transport: streamable_http
         url: http://localhost:8002/mcp
     ```
   - Frontend `localStorage` 키 스키마 (TypeScript 인터페이스로 명시)
   - 정의서 (`docs/mcp-spec/*.md`) 와 서버 코드의 매핑 규칙은 `/mcp-server-builder` 의 산출 규약을 그대로 인용

6. **UI/UX 요구사항**
   - 4 페이지 와이어프레임 텍스트 설명
   - shadcn/ui 컴포넌트 사용 (`Card`, `Table`, `Form`, `Tabs`, `Sheet`, `Dialog`, `Tooltip`)
   - 반응형: 데스크탑 우선, 모바일은 768px 미만에서 단일 컬럼 폴백만
   - Inspector 의 *폼 자동 생성* 은 MCP `inputSchema`(JSON Schema) 를 React-Hook-Form + zod resolver 로 매핑 (라이브러리 명시)
   - Chat 의 *tool_use 가시화*: 각 어시스턴트 메시지 아래 펼침 패널로 tool 이름, 인자, 결과 JSON 표시

7. **프롬프트 관리 / 구성**
   - 시스템 프롬프트: `configs/prompts/chat_system.md`
     - LLM 에게 "현재 연결된 MCP 서버의 도구 목록과 인자 스키마" 를 system message 에 주입
     - 도구 호출 정책(읽기 전용, 민감정보 마스킹, 외부 콘텐츠는 `untrusted_content` 로 감싸기 안내)
   - 도구 메타데이터 → LLM tool 정의 변환 규칙 (Anthropic / OpenAI 둘 다 명시)
   - 사용자 시스템 프롬프트 오버라이드 가능 (Settings)

8. **MVP 제외 사항** (의도적 제거: 임의 추가 금지)
   - 인증/로그인, 다중 사용자, 세션 영속 저장
   - 데이터베이스 (RDB, 벡터 DB)
   - 사내 실서버 연동 (Mock 으로만 검증, 실 연동은 *별도 PRD/티켓*)
   - 다중 MCP 서버 동시 연결 채팅 (Chat 은 단일 서버 컨텍스트만)
   - 호출 이력 영구 저장, 감사 로그
   - 도커라이즈 (`Dockerfile` 은 빈 파일 유지)
   - 인증 미들웨어 (스펙상 `X-MCP-API-Key` 있어도 본 MVP 에서는 기본 비활성)
   - i18n, 다크모드 토글 (Tailwind 기본 스킴만)

9. **성공 지표 (MVP 완료 기준)**
   다음을 모두 만족하면 MVP 종료:
   - `make test-echo-mcp` 및 `make test-mock-repo-mcp` 모두 pass
   - `python scripts/mcp_cli.py call --server echo-mcp --tool echo --params '{"text":"hi"}'` → `"hi"` 반환
   - Inspector 페이지에서 `mock-repo-mcp.list_repositories()` 호출 → 카드 형태로 결과 렌더
   - Chat 페이지에서 *"echo 로 'ping' 보내줘"* 입력 → LLM 이 `echo` 도구 호출 → `"ping"` 응답 표시
   - Playwright e2e: Inspector happy path 1건 green
   - `uv run ruff check src/` 0 errors
   - 신규 사내 서버를 추가하려는 차기 개발자가 README + `/mcp-spec-writer` + `/mcp-server-builder` 만 보고 30분 내 서버 1개 더 추가 가능

### 2. 작성 원칙

- **구체적**: 모호한 표현 금지. 모든 경로, 환경변수, 명령은 실제 값으로 적기 (`<placeholder>` 사용 금지, 단 `<name>` 같은 변수 자리는 명시적으로 표기)
- **개발자 친화적**: 표, 코드 펜스, 디렉토리 트리, TypeScript 인터페이스 등 *바로 복붙 가능한 형태* 사용
- **MVP 집중**: 위 "MVP 제외 사항"을 어기는 기능은 PRD 본문에 등장시키지 말 것. 미래 확장은 별도 "추후 확장" 부록 1개로만 묶기
- **재사용 자산 우선**: `/mcp-spec-writer`, `/mcp-server-builder` 가 만들 산출물(`docs/mcp-spec/*.md`, `src/mcp-servers/<name>/`, `tests/<name>/`, `_common/`)을 가정하고 그 주변만 채울 것. 두 스킬의 내부 구현/템플릿은 인용하지 말고 *입력, 출력 경로만 인용*
- **분량**: 1인 개발자 기준 **2주(영업일 10일)** 내 완료 가능한 범위로 압축

### 3. 출력 형식

- 파일 경로: `docs/PRD.md`
- 형식: 마크다운, 한국어 본문 (기술 용어는 영어 그대로)
- 표, 코드 펜스, 디렉토리 트리 적극 사용
- TypeScript 인터페이스, Python 타입 시그니처, YAML 예시 등 코드 예시 포함
- 문서 길이 가이드: 800~1500 라인 (과도한 분량 지양)

### 4. 추가 컨텍스트 (PRD 작성 시 반드시 참조할 파일)

다음 파일을 PRD 작성 전에 Read 하여 톤, 구조, 이미 결정된 컨벤션을 그대로 반영:

| 파일 | 용도 |
|---|---|
| `CLAUDE.md` | 프로젝트 표준 스택, 디렉토리 구조, 코딩 컨벤션 |
| `.claude/skills/mcp-spec-writer/SKILL.md` | 정의서 생성 흐름: PRD §3 의 워크플로우 묘사 근거 |
| `.claude/skills/mcp-server-builder/SKILL.md` | 서버 코드 생성 흐름: PRD §4 아키텍처 / §5 데이터 모델 근거 |
| `.claude/skills/mcp-server-builder/references/common_module.md` | `_common/` 공유 모듈의 책임 경계 |
| 사내 코드 저장소 시스템 정의서 (당시 `docs/mcp-spec/` 의 v2 초안, 현재 삭제됨) | 실제 정의서 톤/디테일 수준: Inspector 가 처리해야 할 정의서 형태 참고 |

---

위 요구사항을 바탕으로 `docs/PRD.md` 한 파일을 작성해주세요. 작성 후 다음을 자체 점검:

1. 9 섹션이 모두 존재하는가?
2. baseline 서버 2 종(`echo-mcp`, `mock-repo-mcp`)이 §3 핵심 기능과 §9 성공 지표 양쪽에 등장하는가?
3. Inspector 와 Chat 두 페이지가 §4 아키텍처와 §6 UI 양쪽에 등장하는가?
4. Anthropic 과 OpenAI 둘 다 §7 프롬프트 관리에 등장하는가?
5. "MVP 제외 사항" 의 항목 중 어느 것도 본문 기능에 등장하지 않는가?
6. 일정이 2주(10 영업일)로 명시되었는가?
7. 모든 경로가 실제 디렉토리(`src/mcp-servers/`, `frontend/`, `tests/`, `configs/`, `docs/mcp-spec/`)와 일치하는가?
```

---

## 예상 PRD 구조

생성될 PRD는 다음과 같은 구조를 가집니다:

```
docs/PRD.md
├── 1. 프로젝트 개요
├── 2. 사용자 정의
├── 3. 핵심 기능 (MVP)
│   ├── 3.1 echo-mcp baseline 서버
│   ├── 3.2 mock-repo-mcp baseline 서버
│   ├── 3.3 Python CLI MCP 클라이언트
│   ├── 3.4 Frontend Inspector 페이지
│   ├── 3.5 Frontend Chat 페이지 (Anthropic + OpenAI)
│   ├── 3.6 Frontend → MCP 서버 직결 어댑터
│   ├── 3.7 테스트 (pytest + Playwright)
│   └── 3.8 _common/ 공유 모듈 경계
├── 4. 시스템 아키텍처
│   ├── 4.1 컴포넌트 다이어그램
│   ├── 4.2 두 검증 경로 (CLI / Frontend)
│   └── 4.3 페이지 라우팅 (4 페이지)
├── 5. 데이터 모델
│   ├── 5.1 configs/mcp_servers.yaml 스키마
│   ├── 5.2 Frontend localStorage 스키마
│   └── 5.3 정의서 ↔ 서버 코드 매핑
├── 6. UI/UX 요구사항
├── 7. 프롬프트 관리 / 구성
├── 8. MVP 제외 사항
└── 9. 성공 지표
```
