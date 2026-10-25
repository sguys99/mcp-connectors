<div align="center">

# MCP Connectors

**사내 시스템용 MCP 서버를 언제나 같은 방식으로 만들고, 검증하고, 운영합니다.**

스펙 기반 Claude Code 스킬이 서버를 작성하고, 공통 가드레일이 안전을 지키며, 로컬 UI 하나로 도구를 직접 호출하고 실제 LLM이 그 도구를 쓰는 모습까지 확인합니다.

[![CI](https://github.com/sguys99/mcp-connectors/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sguys99/mcp-connectors/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776AB.svg?logo=python&logoColor=white)](pyproject.toml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000.svg?logo=nextdotjs&logoColor=white)](frontend/package.json)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20Streamable%20HTTP-007781.svg)](https://modelcontextprotocol.io)

[English](README.md) | **한국어**

</div>

<p align="center">
  <img alt="Chat 데모: 고객 결제 정보가 담긴 테이블을 묻자 모델이 NL2SQL 서버의 search_tables_schema와 get_table_schema를 호출하고, 답변이 스트리밍되는 동안 Trace 패널에 LLM 요청과 도구 호출이 차례로 쌓입니다" src="docs/assets/demo/chat-tool-use.gif" width="100%">
</p>

MCP Connectors는 코드 저장소, RDB, DW, 메타정보 카탈로그, 내부 API 같은 사내 시스템을 AI Agent와 연결하는 팀을 위한 모노레포입니다. 모든 서버가 같은 구조와 같은 보안 모듈을 쓰고 같은 CLI와 웹 UI로 검증되므로, 열 번째 서버도 첫 번째 서버만큼 쉽게 리뷰할 수 있어요.

## 목차

- [왜 MCP Connectors인가](#왜-mcp-connectors인가)
- [빠른 시작 (Docker)](#빠른-시작-docker)
- [화면 둘러보기](#화면-둘러보기)
- [구성 요소](#구성-요소)
- [아키텍처](#아키텍처)
- [나만의 서버 추가하기](#나만의-서버-추가하기)
- [저장소 구조](#저장소-구조)
- [문서](#문서)
- [기여, 보안, 라이선스](#기여)

## 왜 MCP Connectors인가

| | 얻는 것 |
|---|---|
| **스펙 주도 개발** | `/mcp-spec-writer`가 인터뷰를 거쳐 리뷰 가능한 10섹션 정의서를 씁니다. `/mcp-server-builder`는 그 정의서로 서버, 테스트, 시나리오 파일, 레지스트리 항목을 만듭니다. 팀은 정의서를 리뷰하고, 코드는 정의서와 1:1로 맞습니다. |
| **기본으로 갖춘 엔터프라이즈 가드레일** | 공통 `_common` 모듈이 API Key 인증, CORS, PII 마스킹, 외부 텍스트의 신뢰 경계 래핑, 재시도, 인자 대신 해시를 남기는 JSON 로그를 모든 서버에 제공합니다. |
| **Inspector와 Chat을 한곳에서** | Inspector에서 도구, 리소스, 프롬프트를 하나씩 호출하고, Chat에서는 Anthropic, OpenAI, OpenRouter 모델이 같은 서버를 쓰게 합니다. Trace 워터폴, 수동 승인, 토큰 사용량도 함께 봅니다. |
| **NL2SQL 가드레일 레퍼런스** | `nl2sql_mcp`는 Agent가 쓴 SQL을 읽기 전용 강제, 행 수와 기간 제한, 대량 조회와 카티션 조인 차단, PII 통제, 감사 로그 뒤에서 실행합니다. 설치 직후에는 Mock 백엔드로 돌고, 명령 하나로 PostgreSQL(Pagila 샘플)에 붙어요. |

## 빠른 시작 (Docker)

Compose v2가 포함된 Docker만 있으면 돼요. 스택과 웹 UI를 쓰는 데는 호스트에 따로 설치할 것이 없습니다.

```bash
git clone https://github.com/sguys99/mcp-connectors.git
cd mcp-connectors
cp .env.example .env
docker compose up -d --wait
```

<http://localhost:3000>을 엽니다. 처음에는 이미지를 빌드하느라 몇 분이 걸리고, 다음부터는 몇 초 안에 뜹니다. `git pull` 뒤에는 `docker compose up -d --build --wait`로 다시 빌드하세요. 그냥 `up`은 예전 이미지를 그대로 씁니다. Frontend가 `:3000`, MCP 서버 세 개가 `:8001`, `:8002`, `:8004`에서 실행됩니다. 기본값 그대로 동작하며 인증은 꺼져 있고, NL2SQL은 메모리 안의 Mock 백엔드를 쓰고, LLM 키도 필요 없어요.

### Inspector에서 첫 호출

1. <http://localhost:3000/inspector?server=starter-mcp-http&tool=echo>를 엽니다(또는 **Inspector**에서 `starter-mcp-http`를 고르고 `echo` 도구를 선택합니다).
2. `text` 칸에 `hi`를 입력합니다.
3. **Run**을 누릅니다(`Cmd+Enter` / `Ctrl+Enter`). 응답 창에 **OK**와 함께 `{"metadata": {"length": 2}, "untrusted_content": {"content": "hi"}}`가 정렬된 텍스트 블록으로 나오고, 같은 객체가 `structuredContent`로 한 번 더 표시됩니다.

브라우저는 8001 포트에 직접 붙지 않습니다. 같은 origin의 프록시 `/api/mcp/starter-mcp-http`를 부르고, Frontend 서버가 요청을 넘기면서 설정된 `X-MCP-API-Key`를 붙입니다. 그래서 키가 브라우저로 내려가지 않아요.

<p align="center">
  <img alt="Inspector 데모: 탐색기에서 nl2sql-mcp-http를 고르고 run_sql_query를 선택해 SELECT를 입력한 뒤 Run을 누르면 Mock sample data 알림과 함께 OK 응답이 나타납니다" src="docs/assets/demo/inspector-call.gif" width="100%">
</p>

### 선택: LLM과 Chat

**Settings**에서 Anthropic, OpenAI, OpenRouter 중 하나를 고르고 키를 붙여 넣습니다(키는 이 브라우저의 `localStorage`에만 저장됩니다). 이어서 **Chat**을 열고 **Tools exposed to the model**에서 서버를 체크한 뒤, 예를 들어 `List the repositories and show the README of the first one.`이라고 물어보세요. 서버 쪽 키를 쓰려면 `.env`에 키와 `CHAT_ALLOW_SERVER_KEYS=true`를 함께 적고 `docker compose up -d --wait`를 다시 실행합니다.

### 선택: 실제 PostgreSQL에서 NL2SQL

```bash
make nl2sql-sample-db    # PostgreSQL 17 + Pagila, nl2sql-mcp switches to the real backend
make nl2sql-mock         # back to the Mock backend
```

전부 멈출 때는 `docker compose --profile sample-db down`을 실행합니다(그냥 `docker compose down`은 샘플 DB를 남겨 둡니다). CLI와 Docker 없이 실행하는 방법까지 담은 전체 안내는 [docs/getting-started.md](docs/getting-started.md)에 있어요.

## 화면 둘러보기

스크린샷은 GitHub 테마(라이트 또는 다크)에 맞춰 바뀌어요.

### Dashboard

`configs/mcp_servers.yaml`에 등록된 모든 서버의 연결 상태, 도구 수, p50 지연 시간과 스파크라인(모든 행이 같은 축을 쓰고 최근 가장 느린 점검에 맞춰 축이 늘어남), 최근 헬스 체크 기록을 한 화면에 보여 줍니다. stdio 서버는 CLI가 호출할 때마다 띄우므로 "on demand"로 표시돼요.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/dashboard-dark.png">
  <img alt="Dashboard: HTTP 연결 수, stdio 서버 수, 도구 수, p50 지연 시간 KPI 타일과 등록 서버 다섯 개의 상태, transport, 도구 수, 지연 스파크라인, Inspect 버튼이 있는 표, 최근 체크 로그" src="docs/assets/screenshots/dashboard-light.png">
</picture>

### Inspector

도구, 리소스(URI 템플릿 포함), 프롬프트를 스키마에서 만든 폼이나 JSON 편집기로 호출합니다. 결과는 content 블록별로 렌더링되고, `Server-Timing`을 바탕으로 한 Timing 화면도 있습니다. NL2SQL Mock 백엔드의 결과에는 `data_source: "mock_sample"`이 붙고, Inspector는 결과 위에 **Mock sample data** 알림을 띄웁니다. 아래쪽 독에는 원본 **JSON-RPC log**, 다시 실행하거나 시나리오 YAML로 내보낼 수 있는 **History**, **Server info**가 있습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-call-dark.png">
  <img alt="nl2sql-mcp-http의 Inspector: film 테이블을 조회하는 SELECT를 넣은 run_sql_query 도구, 차단 사례 예시 쿼리, Mock sample data 알림과 columns, rows가 담긴 OK 응답, 아래쪽 JSON-RPC 로그" src="docs/assets/screenshots/inspector-call-light.png">
</picture>

### Chat

하나 이상의 서버를 대상으로 LLM 도구 사용 루프를 돌립니다. Trace 패널은 LLM 요청과 도구 호출을 입력, 결과와 함께 타임라인에 보여 줍니다. 툴바에서 모델, 최대 반복 횟수(1~20), 승인 방식(**Auto**, 또는 호출마다 승인과 거부를 고르는 **Manual**)을 정하고, 제공자가 알려 준 토큰 사용량을 확인합니다. 대화는 브라우저의 IndexedDB에 저장돼요.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.png">
  <img alt="실행을 마친 Chat: payment 컬럼 표가 담긴 답변, LLM 요청 세 번과 도구 호출 두 번이 그려진 Trace 워터폴, 입력과 결과를 보여 주는 search_tables_schema 구간, 툴바의 토큰 수" src="docs/assets/screenshots/chat-light.png">
</picture>

### 그 밖의 화면

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-log-dark.png">
        <img alt="크게 펼친 Inspector JSON-RPC 로그: initialize, tools/list, resources/list, tools/call 메시지 목록과 JSON으로 펼친 tools/call 응답" src="docs/assets/screenshots/inspector-log-light.png">
      </picture>
      <br><b>JSON-RPC 로그.</b> 양방향 메시지를 시간, 크기와 함께 모두 남깁니다. 행을 펼치면 원본 JSON이 보입니다.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/inspector-resources-dark.png">
        <img alt="starter-mcp-http의 Inspector Resources 탭: starter://about 리소스를 읽어 markdown으로 렌더링한 화면" src="docs/assets/screenshots/inspector-resources-light.png">
      </picture>
      <br><b>리소스와 프롬프트.</b> <code>starter://about</code>을 markdown으로 읽고, URI 템플릿을 채우고, 프롬프트를 가져옵니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/add-server-dark.png">
        <img alt="Add runtime server 대화상자: Streamable HTTP URL, 이름, Browser direct와 Server proxy 연결 방식, 선택 헤더" src="docs/assets/screenshots/add-server-light.png">
      </picture>
      <br><b>런타임 서버.</b> Streamable HTTP 서버를 URL만으로 현재 탭에 연결합니다. 브라우저에서 직접 붙거나, 켜 두었을 때만 쓰는 서버 프록시를 거칩니다.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/client-config-dark.png">
        <img alt="starter-mcp-http의 Client config 대화상자: Claude Desktop, Cursor, VS Code, Claude Code 탭과 API 키를 자리표시자로 둔 claude_desktop_config.json 예시" src="docs/assets/screenshots/client-config-light.png">
      </picture>
      <br><b>클라이언트 설정 복사.</b> Claude Desktop, Cursor, VS Code, Claude Code용 설정을 바로 복사합니다. 비밀 값은 들어가지 않아요.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/settings-dark.png">
        <img alt="Settings 화면의 LLM 제공자와 모델 섹션: Anthropic 선택, 제공자별 모델 선택, 기본 최대 반복 횟수, 시스템 프롬프트 덮어쓰기" src="docs/assets/screenshots/settings-light.png">
      </picture>
      <br><b>Settings.</b> 제공자, 모델, API 키, 시스템 프롬프트 덮어쓰기, 화면 설정, 로컬 데이터 초기화를 다룹니다. 구역마다 배지가 변경 사항이 저장 시 적용되는지, 아직 저장되지 않았는지 알려 줍니다.
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/mobile-dashboard-dark.png">
        <img alt="휴대폰 크기 화면의 Dashboard: KPI 타일, 서버 카드, 하단 내비게이션 바" src="docs/assets/screenshots/mobile-dashboard-light.png" width="60%">
      </picture>
      <br><b>반응형.</b> 라이트와 다크 테마, 영어와 한국어 UI, 모바일 레이아웃을 지원해요.
    </td>
  </tr>
</table>

## 구성 요소

### MCP 서버

| 서버 | 레지스트리 이름 (transport, 포트) | 도구 | 이 서버로 배우는 것 |
|---|---|---|---|
| [`starter_mcp`](src/mcp-servers/starter_mcp/README.md) | `starter-mcp` (stdio), `starter-mcp-http` (HTTP :8001) | `echo`, `add`, `current_time`, `sample_content`, 리소스 4종과 프롬프트 2종 | 표준 구조와 `_common` 모듈 사용법. 회귀 기준선 역할도 합니다 |
| [`mock_repo_mcp`](src/mcp-servers/mock_repo_mcp/README.md) | `mock-repo-mcp` (HTTP :8002) | `list_repositories`, `get_file_content`, `search_code` | 교체 가능한 `BackendClient`(픽스처 또는 REST), 페이지네이션, 오류 처리 |
| [`nl2sql_mcp`](src/mcp-servers/nl2sql_mcp/README.md) | `nl2sql-mcp` (stdio), `nl2sql-mcp-http` (HTTP :8004) | `search_tables_schema`, `search_columns`, `get_table_schema`, `get_tables_schema`, `run_sql_query` | 가드레일 파이프라인 뒤의 스키마 탐색과 읽기 전용 SQL. PostgreSQL 기본, Oracle 선택 |

### CLI

`scripts/mcp_cli.py`는 같은 레지스트리를 읽습니다. stdio 서버는 직접 띄우고, HTTP 서버에는 URL로 붙습니다. CLI는 호스트에서 돌기 때문에 서버를 Docker로 띄웠더라도 [uv](https://docs.astral.sh/uv/)와 make가 필요합니다. stdio 호출은 먼저 stderr에 FastMCP 배너와 로그를 찍고, 마지막에 나오는 JSON이 결과입니다.

| 명령 | 하는 일 |
|---|---|
| `list-servers` | 레지스트리의 이름, transport, 엔드포인트 출력 |
| `list-tools`, `call` | 도구 목록 조회, JSON 인자로 도구 하나 호출 |
| `list-resources`, `read-resource`, `list-prompts`, `get-prompt` | 나머지 MCP 프리미티브 |
| `test <file\|dir>` | 시나리오 YAML 실행. `--tag`, `--id`, `--jobs`, `--junit report.xml` 지원 |

```bash
make init-dev                                   # uv sync and pre-commit hooks
uv run python scripts/mcp_cli.py call --server starter-mcp --tool add --params '{"a":2,"b":3}'
make test-scenarios-starter                     # 15 scenario cases over stdio
```

### Frontend

| 페이지 | 용도 |
|---|---|
| `/` Dashboard | 등록 서버와 런타임 서버의 상태, 지연 시간, 도구 수, 클라이언트 설정 복사, 시작하기 체크리스트 |
| `/inspector` | 도구, 리소스, 프롬프트, JSON-RPC 로그, 다시 실행과 시나리오 내보내기가 되는 History, 서버 정보 |
| `/chat` | LLM 도구 사용 루프, Trace 워터폴, 승인 방식, 토큰 사용량, 내보내기와 가져오기가 되는 대화 저장 |
| `/settings` | LLM 제공자, 모델, 키, 시스템 프롬프트, 화면 설정, 로컬 데이터 |

## 아키텍처

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/architecture-light.svg">
  <img alt="Architecture: Claude Code skills generate MCP servers on shared _common modules and add them to configs/mcp_servers.yaml. The CLI and the Next.js Frontend read the registry and call the servers. The Frontend proxies registered servers through /api/mcp/[server], runs Chat through /api/chat with LLM providers, and reaches runtime servers directly or through the opt-in /api/mcp-runtime." src="docs/assets/diagrams/architecture-light.svg">
</picture>

스킬이 공통 `_common` 패키지 위에 서버를 만들고, CLI와 Frontend가 함께 읽는 단일 레지스트리 `configs/mcp_servers.yaml`에 등록합니다. Frontend에서 브라우저는 같은 origin의 프록시 `/api/mcp/[server]`를 통해서만 등록 서버에 닿고, 이 프록시가 서버 쪽에서 `MCP_API_KEY`를 붙입니다. Chat의 도구 사용 루프는 `/api/chat`에서 돕니다. 요청 경로, Docker 구성, 보안 경계는 [docs/architecture.md](docs/architecture.md)에 정리되어 있습니다.

## 나만의 서버 추가하기

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/workflow-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/diagrams/workflow-light.svg">
  <img alt="Workflow: 1 spec with /mcp-spec-writer, 2 implement with /mcp-server-builder, 3 test with make test-NAME and mcp_cli.py test, 4 call one tool with mcp_cli.py call, 5 check in Inspector and Chat. Inspector History exports scenario YAML for mcp_cli.py test." src="docs/assets/diagrams/workflow-light.svg">
</picture>

스킬 두 개가 서버를 작성하고 구현하며, CLI와 Frontend가 검증합니다. Inspector에서 해 본 호출은 History에서 시나리오 파일로 내보내 `mcp_cli.py test`로 다시 돌릴 수 있습니다. 손으로 한 확인이 그대로 회귀 테스트가 되는 셈이에요.

1. **정의서**: Claude Code에서 `/mcp-spec-writer`를 실행하고 연결할 시스템을 설명합니다. `docs/mcp-spec/<server-name>_v0.1.md`가 만들어집니다.
2. **구현**: 그 정의서로 `/mcp-server-builder`를 실행합니다. Mock 백엔드가 들어간 `src/mcp-servers/<snake_name>/`, `tests/<snake_name>/`, 시나리오 YAML, 레지스트리 항목, Makefile 타깃이 생성됩니다.
3. **테스트**: `make test-<server-name>`과 `make test-scenarios-<server-name>`.
4. **CLI 확인**: `uv run python scripts/mcp_cli.py call --server <server-name> --tool <tool> --params '<json>'`.
5. **화면 확인**: `/inspector`에서 도구를 호출하고, `/chat`에서 모델이 그 도구를 쓰게 합니다.

**Claude Code가 없다면?** 스킬은 선택 사항이에요. 스킬은 저장소에 이미 있는 패턴을 따르므로 `starter_mcp`(최소 구성)나 `nl2sql_mcp`(lifespan, `state.py`, `register_tools()`)를 손으로 옮겨도 됩니다. 두 경로 모두 [docs/writing-a-server.md](docs/writing-a-server.md)에 단계별로 나와 있습니다.

## 저장소 구조

```text
mcp-connectors/
├── src/mcp-servers/
│   ├── _common/            # auth, cors, env, errors, logging, masking, retry, trust
│   ├── starter_mcp/        # canonical starter (stdio, HTTP :8001)
│   ├── mock_repo_mcp/      # code repository with a fixture backend (HTTP :8002)
│   └── nl2sql_mcp/         # NL2SQL guardrail reference (stdio, HTTP :8004)
├── scripts/mcp_cli.py      # typer CLI
├── configs/
│   ├── mcp_servers.yaml    # server registry shared by the CLI and the Frontend
│   └── prompts/            # Chat system prompt
├── frontend/               # Next.js 16: Dashboard, Inspector, Chat, Settings
├── tests/                  # pytest suites and scenario YAML files
├── docker/postgres/        # NL2SQL sample DB (PostgreSQL 17 + Pagila)
├── docs/                   # guides, specs, diagrams, screenshots
└── .claude/skills/         # mcp-spec-writer, mcp-server-builder
```

## 문서

`docs/`의 안내 문서는 영문으로 되어 있어요.

| 문서 | 이럴 때 읽습니다 |
|---|---|
| [Getting started](docs/getting-started.md) | 스택을 띄우고 첫 Inspector 호출, Chat 실행, CLI까지 해 보고 싶을 때 |
| [Architecture](docs/architecture.md) | 구성 요소의 관계, 요청 경로, 보안 경계를 알고 싶을 때 |
| [Writing a server](docs/writing-a-server.md) | 스킬로, 또는 손으로 MCP 서버를 추가할 때 |
| [Guardrails](docs/guardrails.md) | NL2SQL 가드레일, `_common` 모듈, 오류 코드를 확인할 때 |
| [FAQ](docs/faq.md) | 키, CORS, 비용, Oracle, Windows, 운영 환경에 관한 실무 질문이 있을 때 |
| [docs/README.md](docs/README.md) | 정의서와 참고 자료까지 포함한 전체 목록이 필요할 때 |

<a id="기여"></a>

## 기여

이슈와 Pull Request를 환영합니다. 개발 환경, 컨벤션, 제출 전 점검, 커밋 형식은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다. [행동 강령](CODE_OF_CONDUCT.md)을 지켜 주세요. 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 기록합니다.

## 보안

취약점은 공개 이슈가 아니라 [SECURITY.md](SECURITY.md)에 적힌 비공개 경로로 알려 주세요. 이 프로젝트는 개발과 검증용 도구입니다. 인증이 기본으로 꺼져 있고 Docker 스택이 모든 인터페이스에 포트를 열기 때문에, 다른 사람이 접근할 수 있는 곳에 띄우기 전에 배포 안내를 먼저 읽어야 합니다.

## 라이선스

[Apache License 2.0](LICENSE)을 따릅니다. 서드파티 고지는 [NOTICE](NOTICE)에 있습니다. NL2SQL 샘플 DB는 빌드할 때 [Pagila](https://github.com/devrimgunduz/pagila)(PostgreSQL License)를 내려받으며, 이 저장소에는 Pagila가 들어 있지 않습니다.

## 감사의 말

- Python 서버 프레임워크 [FastMCP](https://github.com/jlowin/fastmcp)
- [Model Context Protocol](https://modelcontextprotocol.io)과 [Python](https://github.com/modelcontextprotocol/python-sdk), [TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) SDK
- NL2SQL 샘플 데이터를 제공하는 Devrim Gündüz의 [Pagila](https://github.com/devrimgunduz/pagila)
