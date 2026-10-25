# CLAUDE.md

기업 내부 시스템(코드 저장소, RDB, DW, 메타정보 카탈로그, 내부 API 등)을 AI Agent 와 연결하는 다수의 **MCP 서버를 동일 컨벤션으로 개발, 검증, 운영** 하기 위한 통합 코드베이스입니다.

핵심 가치:

1. **스킬 워크플로우 표준화**: `/mcp-spec-writer` → `/mcp-server-builder` → 검증(CLI, 시나리오, Frontend) 흐름을 한 코드베이스 안에서 완결합니다.
2. **로컬 e2e 검증**: stdio(IDE 통합)와 Streamable HTTP(실배포 형태) 양 transport 를 운영 배포 없이 로컬에서 검증합니다.
3. **30 분 인수**: 차기 개발자가 [README.md](README.md) 와 두 스킬만으로 30 분 안에 신규 내부 시스템 서버 1 개를 추가할 수 있어야 해요.

> 사실 출처는 현재 코드와 [docs/update-plan.md](docs/update-plan.md)입니다. [docs/history/](docs/history/)의 PRD, task-plan, meta-prompt 는 MVP 당시 설계 기록(역사 문서)이라 현재 코드와 다를 수 있으며, 충돌하면 코드와 update-plan 을 따릅니다.

## 서버 목록

레지스트리 [configs/mcp_servers.yaml](configs/mcp_servers.yaml) 이 CLI 와 Frontend 공용 사실 출처입니다.

| 레지스트리 이름 | 패키지 | transport / 포트 | 비고 |
|---|---|---|---|
| `starter-mcp`, `starter-mcp-http` | `starter_mcp` | stdio, HTTP :8001 | 캐노니컬 스타터. 도구 4, 리소스 4, 프롬프트 2 (`primitives.py`) |
| `mock-repo-mcp` | `mock_repo_mcp` | HTTP :8002 | Mock 백엔드 baseline (`fixtures/`) |
| `nl2sql-mcp`, `nl2sql-mcp-http` | `nl2sql_mcp` | stdio, HTTP :8004 | NL2SQL 가드레일 레퍼런스. 도구 5. 기본 Mock 백엔드(Pagila 픽스처), `real` 이면 PostgreSQL 샘플 DB(Pagila), Oracle 은 선택 dialect |

## 기술 스택

- **MCP 서버**: Python 3.12, FastMCP 3.4 (uv.lock 기준 3.4.11, 4.x 는 major 라 `<4` 로 고정), MCP Python SDK 1.30 (uv.lock 기준 1.30.0, `<2` 로 고정), pydantic-settings, tenacity, httpx, sqlglot, psycopg 3 (Oracle 은 `uv sync --extra oracle`)
- **CLI**: typer, PyYAML, `fastmcp.Client` (`fastmcp.client.transports`)
- **Frontend**: Next.js 16.4 (App Router), React 19.3, TypeScript, Tailwind CSS v4, shadcn/ui (Base UI), next-themes, zod, sonner, `@modelcontextprotocol/sdk` ^1.29 (lock 1.32), Node.js 24 LTS (`frontend/.nvmrc`). Next.js 16 은 학습 데이터와 API 가 다를 수 있으니 [frontend/AGENTS.md](frontend/AGENTS.md) 안내대로 `node_modules/next/dist/docs/` 를 먼저 확인합니다.
- **LLM** (기본값은 `frontend/src/lib/storage/settings.ts`): Anthropic `claude-sonnet-4-6`, OpenAI `gpt-4o`, OpenRouter `anthropic/claude-sonnet-4.6` (자유 입력)
- **Package manager**: uv (Python), npm (Node)
- **Lint/Format**: ruff (line-length=105, target=py312), eslint
- **Test**: pytest (`asyncio_mode = "auto"`, `--import-mode=importlib`, `-m integration` 기본 제외), vitest, Playwright

## 디렉토리 구조

```
.
├── src/mcp-servers/
│   ├── _common/        # auth, cors, env, errors, logging, masking, retry, trust (8 모듈)
│   ├── starter_mcp/    # server, tools, primitives, config, models
│   ├── mock_repo_mcp/  # server, tools, client, fixtures/
│   └── nl2sql_mcp/     # server, state, tools/, guardrails/, db/ (dialects, mock, postgres, oracle)
├── scripts/            # mcp_cli.py, mcp_ops.py, scenario_core.py, scenario_runner.py, run_mcp_tests.py (NL2SQL 러너)
├── configs/
│   ├── mcp_servers.yaml        # 서버 레지스트리
│   ├── prompts/chat_system.md  # Chat 시스템 프롬프트 템플릿 (/api/chat 이 요청마다 읽음)
│   └── schemas/scenario.schema.json
├── docker/postgres/    # NL2SQL 샘플 DB 이미지 (PostgreSQL 17 + Pagila)
├── frontend/
│   ├── src/app/        # / (Dashboard), /inspector, /chat, /settings, api/ (chat, mcp/[server], mcp-runtime, registry)
│   ├── src/lib/        # mcp (client, registry, proxy), llm, chat (+history), inspector, runtime, i18n, storage, shell, trace 등
│   ├── src/components/ # chat, dashboard, inspector, servers, settings, shell, trace, ui 등
│   ├── src/styles/globals.css  # 디자인 토큰
│   └── tests/e2e/      # Playwright
├── tests/              # _common, starter_mcp, mock_repo_mcp, nl2sql_mcp (+integration), http_transport, scripts, scenarios/starter.yaml
├── docs/
│   ├── getting-started.md, architecture.md, writing-a-server.md, guardrails.md, faq.md  # 영문 사용자 문서
│   ├── scenario-format.md      # mcp_cli.py test 시나리오 형식
│   ├── update-plan.md          # 개편 계획 (현재 기준)
│   ├── mcp-spec/               # MCP 서버 정의서 (/mcp-spec-writer 산출물)
│   ├── nl2sql-mcp-test-data/   # NL2SQL YAML 시나리오와 결과
│   ├── assets/                 # demo, diagrams, screenshots
│   ├── revamp/                 # 개편 작업 기록 (디자인 시안, QA 등)
│   └── history/                # 역사 문서
├── README.md, README.ko.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md
├── .github/            # ISSUE_TEMPLATE, pull_request_template.md
└── .claude/            # skills/, agents/dev/, commands/git/
```

shadcn 컴포넌트 (`frontend/src/components/ui/`): alert, button, checkbox, chip, collapsible, command, confirm-dialog, dialog, dropdown-menu, empty, field, form, input, input-group, item, kbd, label, progress, radio-group, resizable, scroll-area, select, separator, sheet, skeleton, sonner, spinner, tabs, textarea, toggle, toggle-group, tooltip. badge, card, breadcrumb 는 Phase 4 에서 제거했으니 다시 쓰지 않습니다.

## 개발 워크플로우: 신규 MCP 서버 추가

1. `/mcp-spec-writer` 로 `docs/mcp-spec/<server-name>_v0.X.md` 정의서 작성 (한국어 또는 영어)
2. `/mcp-server-builder` 로 `src/mcp-servers/<snake_name>/`, `tests/<snake_name>/`, 시나리오 YAML, 레지스트리 항목, Makefile 타깃 생성
3. `make test-<server-name>` 로 회귀 검증
4. `uv run python scripts/mcp_cli.py call --server <name> --tool <tool> --params '<json>'` 로 CLI 1 차 검증, `mcp_cli.py test <yaml>` 로 시나리오 검증
5. Frontend `/inspector` (도구, 리소스, 프롬프트 단건 호출) 또는 `/chat` (LLM 과 MCP tool-use 루프) 으로 시각 검증

## 자주 쓰는 명령

전체 목록은 `make help` 로 확인해요.

```bash
# 환경
make init-dev                     # uv sync --all-extras --dev + pre-commit install
cp .env.example .env              # 루트 .env (서버는 _common/env.py 로 루트 .env 를 읽음)

# 서버 실행
make run-starter-mcp              # stdio
make run-starter-mcp-http         # HTTP :8001
make run-mock-repo-mcp            # HTTP :8002
make run-nl2sql-mcp               # stdio
make run-nl2sql-mcp-http          # HTTP :8004 (nl2sql-mcp 컨테이너를 먼저 멈춤)

# Docker (frontend :3000 + 서버 3종, nl2sql-mcp 는 Mock)
make docker-up / docker-down / docker-logs / docker-build
make nl2sql-sample-db             # 샘플 Postgres + nl2sql-mcp(real), 되돌리기는 make nl2sql-mock
make sample-db-up / sample-db-down / sample-db-reset / sample-db-psql

# 테스트
make test                         # 전체 pytest (integration 제외)
make test-starter-mcp             # 서버별 (test-mock-repo-mcp, test-nl2sql-mcp 도 동일)
make test-http                    # Streamable HTTP transport
make test-cli                     # scripts/ (CLI, 시나리오 러너)
make test-integration             # 샘플 DB 대상 (sample-db-up 선행 자동)
make test-scenarios               # NL2SQL YAML 시나리오 (Mock), test-scenarios-real 은 샘플 DB
make test-scenarios-starter       # tests/scenarios/starter.yaml (stdio)
make frontend-test                # vitest
make test-e2e                     # Playwright (mock-repo-mcp 자동 기동, CHAT_MOCK_LLM=1)
make coverage

# CLI (scripts/mcp_cli.py)
make cli-list-servers / cli-list-tools-starter / cli-list-tools-mock-repo / cli-call-starter
uv run python scripts/mcp_cli.py list-resources --server starter-mcp   # read-resource, list-prompts, get-prompt 도 있음
uv run python scripts/mcp_cli.py test tests/scenarios/starter.yaml --junit out.xml

# Frontend
make frontend-install / frontend-dev / frontend-build

# Lint
make lint-py                      # ruff check + format --check (src, scripts, tests)
make lint-fe                      # eslint
make lint-all
```

## Claude 스킬 / 에이전트

| 스킬 | 트리거 시점 |
|---|---|
| `/mcp-spec-writer` | 새 내부 시스템 연동 요청 직후. 10 섹션 정의서 작성 |
| `/mcp-server-builder` | 정의서 확정 후. 서버 스캐폴드, 테스트, 시나리오, 레지스트리, Makefile 생성 |

정본은 [.claude/skills/mcp-spec-writer/SKILL.md](.claude/skills/mcp-spec-writer/SKILL.md), [.claude/skills/mcp-server-builder/SKILL.md](.claude/skills/mcp-server-builder/SKILL.md) 이고, 각 스킬에 `references/` 와 `evals/` 가 있습니다.

보조 에이전트는 `.claude/agents/dev/` 의 `backend-developer` (Python, pytest), `nextjs-app-developer` (Frontend 페이지), `ui-markup-specialist` (shadcn 마크업), `code-reviewer` (변경 리뷰) 4 종입니다. git 명령은 `.claude/commands/git/` 의 branch, commit, merge, pr 입니다.

## 코딩 컨벤션

- **Python**: ruff (line-length=105, target=py312). `from _common.<module> import ...` 는 pytest `pythonpath = [".", "src/mcp-servers"]` 와 ruff `known-first-party` 로 해결합니다.
- **테스트 디렉토리**: `tests/<server>/__init__.py` 는 **의도적으로 만들지 않습니다**. `src/mcp-servers/<server>` 패키지와 namespace 가 충돌하므로 `--import-mode=importlib` 로 운영해요.
- **`_common/` 의존 방향**: `<각 서버> → _common` 단방향. `_common/` 안에서 서버 모듈을 import 하지 않아요.
- **서버 구조**: 데코레이터 대신 `register_tools()`, 공유 상태는 `state.py`, `--transport stdio|http`, HTTP 분기에만 `build_http_middleware` (CORS 다음 인증), 설정은 `env_files(__file__)` (루트 `.env` → 패키지 `.env` → OS env 순으로 덮어씀).
- **언어**: LLM 에 보이는 문자열(도구 description, 인자 설명, 클라이언트로 가는 오류와 가드레일 메시지)은 영어로 쓰고 오류 끝에 `[CODE]` 태그를 붙입니다. 코드 주석과 로그는 한국어입니다.
- **레지스트리**: `description` (영어, 기본) 과 선택 `description_ko` (Frontend 에서 `descriptionKo`, CLI 는 무시) 를 함께 적습니다.
- **응답 신뢰 경계**: 외부 텍스트는 `_common/trust.py::wrap_untrusted(meta, untrusted)` 로 감싸 LLM 이 명령으로 오인하지 않게 격리합니다.
- **TypeScript**: 서버 컴포넌트 우선, `"use client"` 는 최소 island 만. 레지스트리 로더(`lib/mcp/registry.ts`)는 서버 전용입니다.
- **i18n**: 영어 기본, 한국어 전환 (쿠키 `mcpc-lang`). 문구는 `lib/i18n/en.ts` 와 `ko.ts` 에 키를 맞춰 넣고 서버 컴포넌트는 `getT()`, 클라이언트는 `useT()` 로 가져옵니다. 하드코딩 문구는 두지 않아요.
- **디자인 토큰**: `frontend/src/styles/globals.css` 의 `:root` 와 `.dark` 변수를 씁니다. 기준은 [docs/revamp/design-decision.md](docs/revamp/design-decision.md) 와 [docs/revamp/design/tokens.css](docs/revamp/design/tokens.css) 이고, 색을 직접 하드코딩하지 않습니다.
- **MCP 인증**: `X-MCP-API-Key` 헤더 검증은 `MCP_API_KEY` 미설정 시 자동 비활성입니다. 등록 서버는 서버 측 프록시 `/api/mcp/[server]` 경유이고 키는 서버에서만 붙입니다. Docker 안에서는 `MCP_USE_INTERNAL_URL=true` 로 레지스트리 `internalUrl` 을 써요.
- **MCP 서버 CORS**: `_common/cors.py` 가 `MCP_CORS_ORIGINS` (콤마 구분, 기본 `http://localhost:3000`) 를 다른 설정과 같은 규칙(pydantic-settings)으로 읽어요. 우선순위는 프로세스 환경 변수, 서버 패키지 `.env`, 루트 `.env` 순이고, compose 도 `${MCP_CORS_ORIGINS:-http://localhost:3000}` 로 루트 `.env` 값을 세 서버에 넘깁니다.
- **런타임 서버**: Add server 로 추가한 서버는 `sessionStorage` 에만 저장(세션 한정)합니다. 기본은 브라우저 직결(대상 CORS 필요)이고, 서버 env `MCP_ALLOW_RUNTIME_PROXY=true` 일 때만 `/api/mcp-runtime` 프록시와 Chat 에서 쓸 수 있습니다(기본 꺼짐, 서버 `MCP_API_KEY` 는 붙이지 않음).
- **Chat 서버 env**: `CHAT_ALLOW_SERVER_KEYS=true` 일 때만 서버 LLM 키를 대체 사용(기본 꺼짐), `CHAT_APPROVAL_SECRET` (16자 이상) 은 수동 승인 토큰 서명 키(비우면 프로세스마다 무작위), `CHAT_MOCK_LLM=1` 은 e2e 전용 가짜 LLM 입니다(운영에서 켜지 않음).
- **환경 변수**: `.env` 는 git 커밋 금지. 항목의 정본은 루트 `.env.example` 이고 서버 패키지의 `.env.example` 은 override 예시예요.

## 문서 작성 규칙

- Em dash(U+2014)와 중간점(U+00B7)을 쓰지 않습니다. 키워드 나열은 쉼표, "와/과", "/" 를 씁니다. 영문과 한글 모두 같습니다.
  - 예외: `frontend/AGENTS.md` 는 `next dev` 가 자동으로 쓰고 다시 넣는 파일이라 원문(Em dash 포함)을 그대로 둡니다. 코드 주석과 기존 테스트 데이터(`docs/nl2sql-mcp-test-data/`)는 이 규칙의 검사 대상이 아니에요.
- 한글 문서는 해요체와 습니다체를 2:8 비율로 씁니다.
- `README.md` (영문) 와 `README.ko.md` (한글) 는 같은 구조를 유지하며 함께 고칩니다.
- `docs/` 의 새 문서, 오픈소스 표준 문서, 서버별 README 는 영문입니다. 기존 한국어 문서(`docs/update-plan.md`, `docs/revamp/`, `docs/history/`)는 그대로 둡니다.
- 다이어그램은 Mermaid(테마 변수 지정)나 직접 그린 SVG 로 만들고 라이트/다크 양쪽에서 읽히는지 확인합니다.

## 추가 문서

- 개편 계획 (현재 기준): [docs/update-plan.md](docs/update-plan.md)
- 사용자 문서: [docs/getting-started.md](docs/getting-started.md), [docs/architecture.md](docs/architecture.md), [docs/writing-a-server.md](docs/writing-a-server.md), [docs/guardrails.md](docs/guardrails.md), [docs/faq.md](docs/faq.md)
- 시나리오 형식: [docs/scenario-format.md](docs/scenario-format.md)
- 기여와 보안: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md)
- MCP 정의서 예시: [docs/mcp-spec/](docs/mcp-spec/)
- 역사 문서: [docs/history/](docs/history/)
