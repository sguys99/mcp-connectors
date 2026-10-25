# MCP Connectors Frontend

Next.js 16 (App Router), Tailwind CSS v4, shadcn/ui로 만든 MCP 서버 검증 화면입니다. Dashboard, Inspector, Chat, Settings 4개 화면이 있습니다.

## 실행

```bash
npm install
cp .env.example .env.local   # 필요한 값만 채웁니다 (아래 환경 변수 표)
npm run dev                  # http://localhost:3000
```

MCP 서버는 따로 띄웁니다 (저장소 루트에서 `make run-starter-mcp-http`, `make run-mock-repo-mcp`). Docker로 한 번에 띄우려면 루트에서 `docker compose up -d --build`를 쓰면 돼요.

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 (:3000) |
| `npm run build` | standalone 빌드 (`.next/standalone/server.js`) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest 단위 테스트 |
| `npm run test:e2e` | Playwright E2E (루트 `make test-e2e`가 chromium 설치와 mock-repo-mcp 기동까지 처리) |

## 구조

- `src/app/`: 페이지와 Route Handler
  - `page.tsx` (Dashboard), `inspector/`, `chat/`, `settings/`
  - `api/mcp/[server]/route.ts`: MCP Streamable HTTP 프록시
  - `api/registry/route.ts`: 브라우저용 레지스트리 API
  - `api/chat/route.ts`: LLM과 MCP를 잇는 tool-use 루프 (SSE). 서버를 여러 개 노출할 수 있고, 모든 이벤트에 서버 측 경과 시간(`t`)을 붙입니다
- `src/lib/mcp/`: `registry.ts` (yaml 로더, 서버 전용), `client.ts` (MCP 클라이언트), `types.ts`
- `src/lib/llm/`: provider 어댑터, 프롬프트 렌더러, 서버 측 LLM 키, 도구 이름 규칙(`tool-names.ts`), 가짜 LLM(`mock.ts`)
- `src/lib/chat/`: SSE 이벤트 타입(`events.ts`), 파서와 reducer, 이벤트를 trace 스팬으로 바꾸는 변환(`trace.ts`), 노출 서버 선택
- `src/components/trace/`: Inspector Timing 탭과 Chat Trace 열이 함께 쓰는 워터폴
- `src/lib/config/paths.ts`: `configs/` 파일 경로 탐색
- `src/styles/globals.css`: Tailwind v4와 shadcn 테마 토큰 (`tailwind.config.ts` 없음), `@tailwindcss/typography` 플러그인

## 레지스트리와 MCP 프록시

서버 목록의 정본은 저장소 루트의 `configs/mcp_servers.yaml` 하나입니다. Frontend는 이 파일을 서버에서 요청마다 읽기 때문에 yaml을 고치면 재빌드 없이 반영돼요.

브라우저는 MCP 서버에 직접 붙지 않습니다. 흐름은 다음과 같습니다.

1. 서버 컴포넌트(Dashboard, Inspector, Chat)와 `GET /api/registry`가 yaml을 읽어 브라우저용 항목만 내려줍니다. HTTP 항목의 `url`은 `/api/mcp/<name>`로 바뀌고 `internalUrl`과 `headers`는 빠집니다(클라이언트 설정 복사용으로 yaml의 `url`을 `externalUrl`로, stdio `command`는 그대로 내려요). `/api/registry`는 streamable_http 항목만 돌려줘요.
2. 브라우저의 MCP 클라이언트는 `/api/mcp/<name>`으로 요청합니다.
3. 프록시는 레지스트리에 있는 streamable_http 서버만 받아 실제 주소로 넘깁니다. 이때 `X-MCP-API-Key`를 서버 env에서 붙이므로 키가 브라우저에 내려가지 않습니다. POST, GET(SSE), DELETE와 `mcp-session-id` 헤더를 그대로 전달하고, 레지스트리 밖 이름은 404, stdio는 400, 다른 origin에서 온 요청은 403으로 막습니다.
4. Chat API는 프록시를 거치지 않고 서버에서 같은 규칙(실제 주소와 키)으로 MCP를 직접 호출합니다.

실제 주소와 헤더 규칙은 CLI(`scripts/mcp_cli.py`)와 같습니다.

- 주소: `MCP_USE_INTERNAL_URL=true`이고 항목에 `internalUrl`이 있으면 `internalUrl`(예: `http://starter-mcp:8001/mcp`), 아니면 `url`
- 헤더: 항목 `headers`의 `${VAR}`를 환경 변수로 치환하고 빈 값은 버립니다. `X-MCP-API-Key`가 없으면 `MCP_API_KEY`를 붙여요.

`lib/mcp/client.ts`는 절대 URL을 받으면 직접 연결합니다. 화면에서 추가하는 런타임 서버의 "브라우저 직결"이 이 경로를 씁니다.

### 런타임 서버 (Add server)

사이드바의 `+`, Dashboard 머리의 "Add server", ⌘K의 "Add server"로 이름, Streamable HTTP URL, 헤더, 연결 방식을 넣으면 yaml을 고치지 않고 외부 MCP 서버를 점검할 수 있습니다. 정보는 이 탭의 `sessionStorage`에만 있고 탭을 닫으면 사라지며, localStorage, 로그, 내보내기, URL에는 남지 않습니다.

- 브라우저 직결(기본): 브라우저가 URL에 직접 붙습니다. 대상 서버가 CORS로 이 앱의 origin을 허용하고 `mcp-session-id`를 노출해야 해요. 이 저장소의 서버는 `MCP_CORS_ORIGINS`에 앱 origin을 넣고 다시 시작하면 됩니다(`_common/cors.py`가 `mcp-session-id`, `mcp-protocol-version`을 이미 노출합니다). Chat에서는 쓸 수 없어요(Chat API가 MCP를 서버에서 호출하기 때문).
- 서버 프록시: `MCP_ALLOW_RUNTIME_PROXY=true`일 때만 고를 수 있습니다. 브라우저가 `/api/mcp-runtime`으로 보내면 서버가 대상 URL로 전달하며(`lib/mcp/proxy.ts`, 등록 서버 프록시와 같은 코어), CORS 없는 서버와 Chat에서도 쓸 수 있어요. 기본은 꺼짐이고, 켜면 이 서버가 사용자가 입력한 URL로 요청을 대신 보내므로 신뢰하는 환경에서만 켜세요.
  - 같은 origin 요청만 받고, 대상은 http/https만(userinfo 거부), 헤더는 사용자가 입력한 것만 전달합니다. 서버의 `MCP_API_KEY`는 런타임 대상에 붙이지 않아요.
  - 응답 시작 대기 60초(`MCP_RUNTIME_PROXY_TIMEOUT_MS`), 응답 본문 10MiB(`MCP_RUNTIME_PROXY_MAX_BYTES`), 요청 본문 2MiB 상한이 있고 리다이렉트는 따라가지 않습니다.
  - Chat은 프록시 방식 서버의 정의(URL, 헤더)를 요청에 실어 보내고, 서버가 같은 문과 검사로 받습니다(`lib/runtime/chat-servers.ts`).
- 켜졌는지는 `GET /api/registry`의 `runtimeProxy`로 알 수 있습니다.

### 클라이언트 설정 복사

서버 행의 `...` 메뉴, Inspector의 Server info 탭, ⌘K "Copy client config"가 Claude Desktop(`npx mcp-remote`), Cursor(`.cursor/mcp.json`), VS Code(`.vscode/mcp.json`), Claude Code(`claude mcp add`, `.mcp.json`) 형식의 설정을 만듭니다(`lib/client-config`, 공식 문서 주소는 코드 주석). API 키는 환경 변수 참조나 자리표시자로만 나가고 실제 값은 들어가지 않습니다.

## 환경 변수

모두 서버 측에서만 읽습니다. 로컬에서는 `frontend/.env.local`에 적고, 아래 표의 키 4개(`MCP_API_KEY`와 LLM 키)는 비어 있으면 저장소 루트 `.env`에서도 읽습니다(`next.config.ts`, MCP 서버와 CLI가 같은 파일을 읽기 때문). Docker에서는 루트 `.env` 값이 `docker-compose.yaml`을 거쳐 들어와요.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_API_KEY` | (없음) | MCP 서버 인증 키. 비우면 헤더를 보내지 않습니다 |
| `MCP_REGISTRY_PATH` | 자동 탐색 | 레지스트리 yaml 경로. 비우면 `./configs/mcp_servers.yaml`, `../configs/mcp_servers.yaml` 순으로 찾습니다 |
| `CHAT_SYSTEM_PROMPT_PATH` | 자동 탐색 | Chat 시스템 프롬프트 템플릿. 비우면 `configs/prompts/chat_system.md`를 같은 규칙으로 찾습니다 |
| `MCP_USE_INTERNAL_URL` | (없음) | `true`면 서버 측 MCP 호출이 `internalUrl`을 씁니다. compose가 설정해요 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | (없음) | Chat LLM 키. Settings에 넣은 브라우저 키가 우선이고, 없을 때 `CHAT_ALLOW_SERVER_KEYS=true`인 경우에만 이 값을 씁니다 |
| `MCP_ALLOW_RUNTIME_PROXY` | (꺼짐) | `true`면 런타임 서버를 서버 프록시(`/api/mcp-runtime`)와 Chat에서 쓸 수 있습니다. 신뢰하는 환경에서만 켜세요 |
| `MCP_RUNTIME_PROXY_TIMEOUT_MS`, `MCP_RUNTIME_PROXY_MAX_BYTES` | 60000, 10485760 | 런타임 프록시의 응답 시작 대기 상한(ms)과 응답 본문 상한(바이트) |
| `CHAT_ALLOW_SERVER_KEYS` | `false` | 서버 측 LLM 키 대체 사용 허용. Frontend에 접속한 누구나 그 키로 LLM을 호출할 수 있으므로 로컬에서만 켜세요 |
| `CHAT_MOCK_LLM` | (꺼짐) | `1`이면 Chat이 실제 LLM 대신 가짜 LLM을 씁니다. e2e 전용이며 기본값으로 켜지지 않고, `NODE_ENV=production`에서는 `CHAT_MOCK_LLM_ALLOW_PRODUCTION=1`을 함께 줘야 켜집니다(Docker는 두 값을 전달하지 않음). 아래 "Chat e2e" 참고 |

LLM 키를 서버 env에 두면 이 Frontend에 접속하는 누구나 그 키로 Chat을 쓸 수 있습니다. 로컬 개발용으로만 쓰세요.

## Chat e2e (가짜 LLM)

Chat의 전체 흐름(SSE 스트리밍, 도구 호출 카드, trace 워터폴, 중지, 반복 한도)을 LLM 키 없이 확인하려면 개발 서버를 `CHAT_MOCK_LLM=1`로 띄웁니다. Playwright 설정(`playwright.config.ts`)은 자기가 띄우는 서버에 이 값을 넣어 줍니다. 이미 떠 있는 개발 서버를 재사용한다면 그 서버도 같은 값으로 시작해야 하고, 아니면 `tests/e2e/chat.spec.ts`가 건너뜁니다.

```bash
CHAT_MOCK_LLM=1 npm run dev
```

가짜 LLM은 모델 응답만 규칙으로 만들고, 도구 호출은 진짜 MCP 서버로 갑니다. 마지막 사용자 메시지에 지시문을 넣어 동작을 정해요.

| 지시문 | 동작 |
|---|---|
| `[[tool:NAME {"a":1}]]` | NAME 도구를 이 입력으로 부릅니다. 여러 개면 순서대로 부르고, 서버가 여러 개일 때 붙는 `server__` 접두는 생략해도 됩니다 |
| `[[sleep:MS]]` | 각 LLM 응답 전에 MS 밀리초 기다립니다. 중지 시험과 LLM 구간을 길게 보고 싶을 때 씁니다 |
| `[[loop]]` | 도구 호출을 최대 반복 횟수까지 되풀이합니다. 반복 한도 알림 시험용입니다 |
| `[[error:TEXT]]` | LLM 오류로 끝냅니다 |
| `[[usage:off]]` | 토큰 사용량을 알려 주지 않습니다 ("토큰 미보고" 시험) |
| `[[usage:cache]]` | 사용량에 캐시 읽기 300, 쓰기 100 토큰을 더합니다 |

토큰 사용량은 반복(턴 기준 0부터) k마다 입력 `1000*(k+1)`, 출력 `50*(k+1)`로 고정이라 e2e가 정확한 값을 확인합니다. 수동 승인 모드(툴바 Approval, Manual)에서는 도구를 부르려는 반복에서 승인 대기로 멈추고, 승인 뒤 요청은 다음 반복부터 이어서 돕니다. 이 흐름은 `tests/e2e/chat-run-controls.spec.ts`가 확인합니다.

지시문이 없으면 노출된 도구에 맞춰 기본 호출 하나(`run_sql_query`, `list_repositories`, `echo` 순)를 부르고 요약합니다. 운영 환경에서는 켜지 마세요. 켜면 키가 없어도 Chat이 동작합니다.

## Chat 실행 제어

Chat 툴바에서 모델, 최대 반복(1부터 20), 승인 방식을 바꿉니다. 이 값은 그 페이지의 대화에만 적용되고 Settings에는 저장하지 않으며, 시작값은 Settings의 제공자, 모델, "기본 최대 반복"입니다(승인은 항상 자동으로 시작). `/api/chat`은 범위 밖의 반복 횟수와 모르는 제공자를 400으로 거부합니다.

수동 승인 모드에서 서버는 상태를 갖지 않습니다. 모델이 도구를 부르려 하면 응답이 `approval_required`(대기 호출들과 서명 토큰)와 `done(awaiting_approval)`로 끝나고, 화면의 승인 카드에서 결정하면 대화 기록과 결정을 `resume`으로 다시 보냅니다. 서버는 토큰의 HMAC 서명으로 대기 호출의 id, 이름, 입력과 사용한 반복 수가 처음 보낸 그대로인지 확인하고, 승인한 호출만 직접 실행해 결과를 붙입니다(클라이언트가 보낸 도구 결과는 쓰지 않습니다). 토큰은 30분 뒤 만료됩니다. 서버를 여러 개 두거나 재시작 뒤에도 승인을 이어야 한다면 모든 인스턴스에 같은 `CHAT_APPROVAL_SECRET`(16자 이상)을 주세요. 없으면 프로세스마다 무작위 값을 씁니다.

토큰 사용량은 제공자가 응답에 담아 보낸 `usage` 실측값만 보여 주며 추정이나 비용 환산은 하지 않습니다.

## Docker

`frontend/Dockerfile`은 standalone 출력을 `node` 사용자(비root)로 실행하고, `/api/registry`로 healthcheck를 합니다. 빌드 컨텍스트는 `frontend/`이며, 루트 `configs/`는 추가 빌드 컨텍스트 `configs`로 받아 `/app/configs`에 복사합니다. compose는 이를 자동으로 넘기고, 직접 빌드할 때는 루트에서 다음처럼 실행합니다.

```bash
docker build --build-context configs=./configs -t mcp-connectors-frontend ./frontend
```

## 의존성 점검

`npm audit` 결과와 남은 항목(모두 개발 도구 의존성, `npm audit --omit=dev`는 0건)은 [docs/revamp/npm-audit.md](../docs/revamp/npm-audit.md)에 정리했습니다.
