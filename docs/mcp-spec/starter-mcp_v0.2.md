# starter-mcp 요구사항 정의서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | starter-mcp 요구사항 정의서 |
| 버전 | v0.2 (v0.1 의 Tools 3종에 Resources, Prompts, 혼합 content 도구를 추가) |
| 작성자 | maintainer |
| 작성일 | 2026-05-23 (v0.2 개정 2026-10-23) |

---

## 1. 개요

### 1.1 서버명 / 한 줄 소개

- **서버명**: `starter-mcp` (예제 서버 학습 순서는 starter, mock_repo, nl2sql 의 1단계)
- **한 줄 소개**: 기업 내부 시스템용 MCP 서버 코드베이스의 **캐노니컬 스타터**로, `_common`(logging, errors, trust, cors) 모듈의 전형적인 사용 패턴을 도구 함수 본문에 노출하여, 신규 기업 내부 시스템 연동 MCP 서버 작성 시 그대로 복사/변형하는 살아있는 템플릿 역할을 하는 학습용 MCP 서버

### 1.2 목적 및 배경

- **목적**: `/mcp-spec-writer` → `/mcp-server-builder` 워크플로우를 거치지 않더라도, *코드만 읽고* 신규 MCP 서버 작성법(폴더 구조, `_common` 호출 패턴, stdio/HTTP 양 transport 진입점)을 즉시 학습할 수 있는 레퍼런스 구현 제공
- **배경**: `src/mcp-servers/_common/` 모듈군(logging, masking, trust, retry, auth, errors, cors)은 코드로만 존재하여, 차기 개발자가 어떤 모듈을 어느 시점에 호출해야 하는지 진입장벽 존재. 또한 stdio(IDE 통합)와 Streamable HTTP(실배포 형태) 두 transport 가 한 서버에 공존하는 표준 진입점 패턴 부재
- **회귀 검사 표적 역할**: 외부 백엔드 의존이 0 이므로 FastMCP 버전 업, CORS 정책 변경, CLI 어댑터 수정 같은 인프라 변경의 부작용을 `make test-starter-mcp`, `make cli-call-starter`, `/inspector` 호출 결과만으로 즉시 탐지합니다. 백엔드 장애나 자격증명 만료에 막히지 않는 고정 기준점이며, PRD §9 의 인수 기준(`echo({"text":"hi"})` 호출에 `hi` 가 응답에 담김)이 이 서버에서 성립합니다.
- **기대 효과**: [CLAUDE.md](../../CLAUDE.md) 와 본 서버 한 쌍만으로 신규 기업 내부 시스템 MCP 서버 1 개를 **30 분 내 추가** 가능 (PRD §9 인수 기준 부합). `_common` 호출 누락에 따른 보안/관측성 회귀 방지

---

## 2. 범위

### 2.1 포함 범위 (In-Scope)

- 도구 4종으로 `_common` 모듈 4 종 사용 패턴 시연 (`sample_content` 는 text, image, resource 혼합 블록 시연)
  - `_common.trust.wrap_untrusted` → `echo`
  - `_common.logging.setup_logger` + `_common.logging.hash_params` → `add`
  - `_common.errors.InvalidInputError` → `current_time`
  - `_common.cors.build_cors_middleware` → `server.py` HTTP 모드 진입점
- Resources 4종 (`starter://about`, `starter://config`, `starter://greeting/{name}`, `starter://logo.png`)과 Prompts 2종 (`explain_tool`, `code_review_session`) 으로 세 프리미티브의 차이를 시연
- stdio (`python -m starter_mcp.server --transport stdio`) + Streamable HTTP (`--transport http`, 포트 8001) 양 transport 동시 지원
- in-memory `Client` fixture 기반 단위/contract 테스트 31 건 (`test_tools.py` 8 + `test_mcp_contract.py` 5 + `test_primitives.py` 18)
- CLI (`scripts/mcp_cli.py`) 및 Frontend (`/inspector`, `/chat`) 에서 호출 가능한 표준 인터페이스 제공

### 2.2 제외 범위 (Out-of-Scope)

- 외부 백엔드 시스템(코드 저장소, RDB, DW, 내부 API 등) 연동: 본 서버는 표준 라이브러리(`datetime`, `zoneinfo`)와 입력 가공만 수행
- MCP Agent 인증/인가 본격 구현: `MCP_API_KEY` env 미설정 시 인증 자동 비활성 (개발/테스트 모드)
- 민감정보 마스킹 본격 구현 (`_common.masking`): 본 서버는 외부 데이터를 받지 않아 마스킹 대상 없음
- 백엔드 재시도/Circuit Breaker (`_common.retry`): 호출할 백엔드 자체가 없음
- 쓰기 작업 일체
- 운영 모니터링 대시보드 / SLA 관제

---

## 3. 사용자 및 주요 시나리오

### 3.1 사용 Agent

- **호출 주체 (1차)**: 신규 MCP 서버 개발자 (사람). 본 폴더와 README의 "신규 서버 만드는 5 단계"를 참고하여 스캐폴드를 복사/변형
- **호출 주체 (2차)**: 통합 검증용 LLM Agent (Claude / GPT): Frontend `/inspector` 단건 호출 검증 또는 `/chat` 의 tool-use 루프 e2e 시증
- **호출 빈도**: 학습/검증 목적: 정량적 SLA 없음. 로컬 개발 환경에서만 기동
- **동시 세션**: 1~2 (개발자 1명 + frontend 1세션 가정)
- **호출 성격**: 읽기 100% (4 도구 모두 외부 상태 변경 없음)

### 3.2 주요 사용 시나리오 (Use Cases)

| ID | 시나리오 | 사용 Tool (5장과 매핑) |
|---|---|---|
| UC-01 | `_common.trust.wrap_untrusted` 사용 패턴 확인: 외부 입력 텍스트를 `untrusted_content` 키로 격리하여 LLM 신뢰 경계를 시연한다 | `echo` |
| UC-02 | `_common.logging.hash_params` 사용 패턴 확인: 호출 파라미터 원문 대신 SHA256 short hash 를 로깅하여 민감정보 누출 없이 호출 추적 가능함을 시연한다 | `add` |
| UC-03 | `_common.errors.InvalidInputError` 사용 패턴 확인: 도메인 입력 검증 실패를 자연어 에러 메시지와 함께 `isError: true` 응답으로 자동 변환됨을 시연한다 | `current_time` |
| UC-05 | `Asia/Seoul` 타임존으로 `current_time` 을 호출하여 ZoneInfo, ISO 8601 직렬화(`+09:00` offset), 인자 기본값 처리가 정상 동작하는지 확인한다 | `current_time` |
| UC-06 | Inspector 의 content 블록 렌더링 검증: `sample_content` 가 text, image(PNG), embedded resource 블록을 한 번에 반환한다 | `sample_content` |
| UC-07 | Resources 와 Prompts 목록, 읽기, 인자 처리 확인: 고정 리소스, URI template, 바이너리 blob, 필수와 선택 인자 프롬프트, 다중 메시지 프롬프트 | Resources, Prompts (5.3, 5.4) |
| UC-04 | stdio 와 Streamable HTTP 양 transport 동시 기동 검증: `make run-starter-mcp` (stdio) + `make run-starter-mcp-http` (HTTP 8001), CLI 단건 호출 + Frontend `/inspector` 폼 호출이 동일 도구로 동일 응답을 반환함을 확인 | `echo`, `add`, `current_time` |

---

## 4. 시스템 구성

### 4.1 MCP 서버

| 항목 | 내용 |
|---|---|
| Transport | Streamable HTTP **및** STDIO (양쪽 모두 지원, `--transport` 플래그로 분기) |
| 배포 환경 | 로컬 개발 환경 (`make` 타겟, Docker compose). 운영 배포 대상 아님 |
| 엔드포인트 | stdio: `python -m starter_mcp.server --transport stdio` (자식 프로세스 spawn), HTTP: `http://localhost:8001/mcp` |
| MCP SDK | FastMCP (Python): `FastMCP("starter-mcp")` |
| 사용 프리미티브 | Tools, Resources, Prompts 모두 사용. `initialize` 응답의 capabilities 에 세 가지가 모두 실리며 stdio 와 Streamable HTTP 가 같다 |
| 도구 등록 방식 | `tools.py` 의 plain async function 을 `server.py` 에서 `mcp.add_tool(<func>)` 로 명시 등록 (데코레이터 분리 패턴) |
| 리소스, 프롬프트 등록 방식 | `primitives.py` 의 plain function 을 `server.py` 에서 `mcp.resource(uri, mime_type=...)(<func>)`, `mcp.prompt(name=...)(<func>)` 로 명시 등록. 설명 문자열(영어)은 `server.py` 가 정본 |

### 4.2 연동 백엔드 시스템

| 항목 | 내용 |
|---|---|
| 시스템명 | **없음 (의도적)** |
| 종류 | N/A: 본 서버는 `_common` 사용 패턴 시연 + 코드베이스 스타터가 목적. 모든 응답은 Python 표준 라이브러리(`datetime`, `zoneinfo`) 또는 입력 가공으로 생성 |
| 엔드포인트 | N/A |
| 프로토콜 | N/A |
| 인증 방식 | N/A |
| 네트워크 | 로컬 only: 외부 네트워크 호출 없음 |
| 참고 문서 | [src/mcp-servers/starter_mcp/README.md](../../src/mcp-servers/starter_mcp/README.md), [src/mcp-servers/_common/](../../src/mcp-servers/_common) |

> ℹ️ 신규 기업 내부 시스템 MCP 서버 작성 시 본 절을 실제 백엔드(코드 저장소 / RDB / DW / 메타 카탈로그 / 내부 API 등) 정보로 채워넣어야 한다.

---

## 5. 기능 요구사항 (Tools)

### 5.1 Tool 목록 (요약)

Hint 칼럼(`readOnly` / `destructive` / `idempotent`)은 MCP 표준 annotation 이며, 클라이언트가 확인 다이얼로그 등 UX 를 결정할 때 사용한다.

| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `echo` | 입력 텍스트를 trust 격리 응답(`untrusted_content`)으로 감싸 반환 | true | false | true |
| T-02 | `add` | 두 정수의 합 반환 + 파라미터 SHA256 short hash 로깅 | true | false | true |
| T-03 | `current_time` | IANA 타임존 기준 현재 시각을 ISO 8601 문자열로 반환 | true | false | **false** |
| T-04 | `sample_content` | text, image(PNG), embedded resource 블록을 한 번에 반환 (content 블록 렌더링 검증용) | true | false | true |

> `current_time` 은 호출 시각이 매번 다르므로 `idempotent=false`. 그 외 두 도구는 동일 입력에 동일 출력이라 `idempotent=true`.

### 5.2 Tool 상세 명세

#### ▶ T-01 `echo`

- **설명**: 입력 텍스트를 `_common.trust.wrap_untrusted` 로 감싸 `metadata` / `untrusted_content` 두 키로 분리 반환

- **LLM Description**
  ```
  입력 텍스트를 그대로 에코하되, 외부 입력임을 명시하기 위해 `untrusted_content` 키로 격리하여 반환한다.
  외부 텍스트 응답을 LLM 이 명령으로 오인하지 않도록 신뢰 경계를 분리하는 패턴을 시연할 때 사용.
  단순 산술/계산이 목적이면 add 를, 현재 시각이 목적이면 current_time 을 사용할 것.
  본 서버는 학습용 스타터이므로 운영 환경의 의미 있는 데이터 조회 용도로 호출하지 말 것.
  호출 예: "hello 를 그대로 돌려받기" → echo(text="hello")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `text` | string | Y | 에코할 텍스트. 외부 입력으로 간주되어 응답의 `untrusted_content.content` 로 격리됨 |

- **출력 예시 (정상)**
  ```json
  {
    "metadata": {
      "length": 5
    },
    "untrusted_content": {
      "content": "hello"
    }
  }
  ```

- **빈 결과**: 정의되지 않음. `text=""` 는 에러로 처리합니다 (아래 에러 응답 참조)

- **응답 크기 제어**: 입력 길이에 비례. 단일 응답 ≤ 64KB 권장 (본 서버는 길이 제한 미강제: 신규 서버에서 외부 데이터를 다룰 경우 `wrap_untrusted` 호출 전 길이 검증 필요)

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "text is required" (`text == ""` 일 때 `InvalidInputError` raise, FastMCP 가 `isError: true` 응답으로 변환) |
  | `INVALID_INPUT` | "필수 파라미터 `text` 가 누락되었습니다." (MCP framework 단에서 inputSchema 검증 시 자동 발생) |

---

#### ▶ T-02 `add`

- **설명**: 두 정수의 합을 반환하고, 호출 파라미터의 SHA256 short hash 를 `params_hash` extra 필드로 로깅

- **LLM Description**
  ```
  두 정수 a, b 의 합을 반환한다.
  호출 시 파라미터 원문 대신 `_common.logging.hash_params` 로 생성한 16 자 hex SHA256 short hash 를 로그에 기록하여, 민감정보 누출 없이 호출 추적이 가능함을 시연한다.
  단순 산술 호출 경로를 검증하거나 hash_params 로깅 패턴을 확인할 때 사용.
  실수/부동소수/큰 정수가 필요한 경우에는 사용하지 말 것 (도메인이 정수 한정).
  호출 예: "1 + 2 계산" → add(a=1, b=2)
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `a` | int | Y | 첫 번째 정수 |
  | `b` | int | Y | 두 번째 정수 |

- **출력 예시 (정상)**
  ```json
  3
  ```

  (응답은 단일 정수 스칼라. FastMCP 가 `content` 의 text 항목으로 직렬화)

- **빈 결과**: 해당 없음 (정수 합은 항상 단일 값 반환)

- **응답 크기 제어**: 응답이 단일 정수이므로 크기 제어 불필요

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "파라미터 `a` 또는 `b` 가 정수가 아닙니다." (MCP framework 단에서 inputSchema 검증 시 자동 발생) |

---

#### ▶ T-03 `current_time`

- **설명**: 주어진 IANA 타임존의 현재 시각을 ISO 8601 문자열로 반환 (`_common.errors.InvalidInputError` 패턴 시연)

- **LLM Description**
  ```
  주어진 IANA 타임존의 현재 시각을 ISO 8601 포맷 문자열로 반환한다.
  현재 시각이 필요하거나, 도메인 입력 검증 실패가 `_common.errors.InvalidInputError` → `isError: true` 응답으로 자동 변환되는 패턴을 확인할 때 사용.
  과거/미래 시각 계산이나 다른 포맷(epoch 초 등)이 필요하면 사용하지 말 것 (현재 시각 ISO 8601 한정).
  `tz` 생략 시 UTC 기본값. `zoneinfo.available_timezones()` 에 없는 값이면 INVALID_INPUT.
  호출 예: "서울 현재 시각" → current_time(tz="Asia/Seoul")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `tz` | string | N | IANA 타임존 이름 (예: `UTC`, `Asia/Seoul`). 기본값 `UTC`. `zoneinfo.available_timezones()` 에 등록된 값만 허용 |

- **출력 예시 (정상)**
  ```json
  "2026-05-23T12:34:56.789012+00:00"
  ```

  (응답은 단일 문자열 스칼라. `datetime.now(ZoneInfo(tz)).isoformat()` 결과)

- **빈 결과**: 해당 없음 (현재 시각은 항상 존재)

- **응답 크기 제어**: 응답이 고정 길이 ISO 8601 문자열이므로 크기 제어 불필요

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "알 수 없는 타임존: Asia/Foo": IANA 타임존 이름을 확인하세요 (예: `UTC`, `Asia/Seoul`). `_common.errors.InvalidInputError` → FastMCP 가 `isError: true` 응답으로 자동 변환 |

#### ▶ T-04 `sample_content`

- **설명**: 클라이언트(Inspector 등)가 MCP content 블록 3종을 모두 렌더링하는지 확인하기 위한 도구. `message` 는 외부 입력이므로 `wrap_untrusted` 로 격리한 JSON 을 text 블록에 담는다

- **LLM Description**
  ```
  Return one text block, one image block and one embedded resource block.
  Exists so clients can verify rendering of every MCP content block type.
  The `message` input is external text, so it is isolated with wrap_untrusted.
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `message` | string | N | text 블록에 넣을 문장. 기본값 `Hello from starter-mcp`. 응답에서는 `untrusted_content.content` 로 격리됨 |

- **출력 (정상)**: 블록 3개. 순서는 고정입니다.

  | 순서 | type | 내용 |
  |---|---|---|
  | 1 | `text` | `wrap_untrusted` 형태 JSON 문자열 (`metadata.length`, `untrusted_content.content`) |
  | 2 | `image` | 16x16 그라데이션 PNG (`mimeType: image/png`, base64) |
  | 3 | `resource` | `starter://about` 를 내장한 `TextResourceContents` (`text/markdown`) |

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "message must not be empty" (`message == ""` 일 때 `InvalidInputError`) |

---

### 5.3 Resources

리소스는 모델이 호출하는 동작이 아니라 애플리케이션이 읽는 데이터입니다. URI 에 `{param}` 이 있으면 resource template 이 됩니다.

| URI | 종류 | mimeType | 설명 |
|---|---|---|---|
| `starter://about` | 고정 텍스트 | `text/markdown` | 서버가 제공하는 프리미티브 개요 |
| `starter://config` | 고정 JSON | `application/json` | 포트, 인증 on/off, 프리미티브 이름. **시크릿은 싣지 않으며** `MCP_API_KEY` 는 설정 여부(bool)만 `auth_enabled` 로 노출 |
| `starter://greeting/{name}` | template | `application/json` | `name` 을 `wrap_untrusted` 로 격리해 반환. 빈 값이나 50자 초과는 `InvalidInputError` |
| `starter://logo.png` | 바이너리 | `image/png` | 코드로 생성한 16x16 PNG. base64 `blob` 으로 직렬화 |

### 5.4 Prompts

프롬프트는 사용자가 고르는 메시지 템플릿입니다. 인자를 받아 대화 메시지 목록을 만듭니다.

| 이름 | 인자 | 반환 |
|---|---|---|
| `explain_tool` | `tool_name` (필수), `audience` (선택, `beginner` 또는 `expert`, 기본 `beginner`) | user 메시지 1개. `audience` 값이 잘못되면 `InvalidInputError` |
| `code_review_session` | `language` (필수), `focus` (선택, 기본 `correctness`) | user, assistant, user 3개 메시지 |

필수 인자가 빠지면 FastMCP 가 `Missing required arguments` 에러를 돌려줍니다.

---

## 6. 비기능 요구사항

### 6.1 성능 / 응답 크기

본 서버는 외부 백엔드 호출이 없어 응답 시간은 표준 라이브러리 호출 + 직렬화 비용만 발생한다.

- 단일 Tool 호출 P95 응답시간 < 100ms (로컬 측정 기준)
- 동시 5 건 처리 가능 (FastMCP 기본 asyncio 처리)
- 단일 응답 ≤ 64KB 권장: 본 서버 자체는 모든 응답이 짧으나(정수 / 문자열 / 짧은 dict), 신규 서버 작성 시 외부 데이터 응답은 5MB **및** 32K tokens 가드 (PRD §6.1 기준) 적용 필요
- 리스트 반환 도구 없음 (리소스 목록은 고정 4건). 신규 서버에 리스트 반환 도구를 추가할 때는 `limit` / `offset` 또는 `cursor` 파라미터 필수

### 6.2 보안

`_common` 모듈의 보안 패턴을 시연 수준으로 적용한다. 실제 보안 요건은 신규 서버에서 백엔드 특성에 따라 확장.

- **MCP 인증**: `MCP_API_KEY` 환경변수가 설정된 경우만 HTTP 헤더 `X-MCP-API-Key` 검증, 미설정 시 자동 비활성 (MVP / 개발-테스트 모드 기본값). HTTP 모드 진입점에서 `_common.auth.build_http_middleware(settings.mcp_api_key)` 가 CORS 와 인증 미들웨어를 함께 건다 (stdio 영향 없음)
- **CORS**: `MCP_CORS_ORIGINS` 환경변수 (콤마 구분, 기본 `http://localhost:3000`) 로 브라우저 직결 허용 origin 지정. HTTP 모드 진입점에서 `_common.cors.build_cors_middleware()` 가 미들웨어 빌드
- **백엔드 자격증명**: 본 서버는 외부 백엔드 없음: 해당 항목 N/A
- **인가 경계**: 본 서버는 호출자별 데이터 분리 대상 자체가 없음: 신규 서버에서 외부 백엔드를 호출할 때는 공용 백엔드 계정 권한을 그대로 노출하지 말고 Agent 단위 인가 매핑 적용 필요
- **간접 prompt injection 방어**: `echo` 도구가 `_common.trust.wrap_untrusted` 로 외부 입력을 `untrusted_content` 키에 격리: 이 키 이름 자체로 LLM 이 신뢰 경계 인식. 신규 서버에서 외부 텍스트(파일 본문/커밋 메시지/검색 결과 등)를 반환할 때 동일 패턴 적용 필수
- **민감정보 마스킹**: 본 서버는 외부 데이터를 받지 않아 마스킹 대상 없음: 신규 서버에서는 `_common.masking` 모듈로 주민번호/카드번호/사번 패턴 자동 마스킹 적용

### 6.3 로깅

- **항목**: `_common.logging.setup_logger("starter-mcp")` 로 표준 로거 초기화. `add` 도구에서 `logger.info("add called", extra={"params_hash": hash_params({"a": a, "b": b})})` 패턴으로 호출 추적
- **민감정보 처리**: 입력 파라미터 원문은 로그에 남기지 않고 `_common.logging.hash_params` 로 16 자 SHA256 short hash 만 기록
- **출력 대상**: 로컬 stderr (운영 수집 시스템 연동 대상 아님: 학습용)
- **보존 기간**: N/A (로컬 개발 환경)

---

## 7. 에러 처리

MCP 에서 에러는 **Agent 가 다음 행동을 결정할 수 있는 형태**여야 한다. 코드만 반환하지 않고 자연어 원인 + 조치를 함께 포함한다.

| 분류 | 처리 |
|---|---|
| 입력/도메인 오류 (`INVALID_INPUT`) | `_common.errors.InvalidInputError` raise → FastMCP 가 `isError: true` 응답으로 자동 변환. `current_time` 의 알 수 없는 타임존 입력 시 시연 |
| inputSchema 검증 오류 | FastMCP framework 단에서 자동 처리 (필수 파라미터 누락, 타입 불일치 등) |
| 백엔드/시스템 오류 | 본 서버는 외부 호출 없음: `BACKEND_UNAVAILABLE` / `*_TIMEOUT` 등 해당 없음 |

- **백엔드 호출 Timeout**: N/A (외부 호출 없음)
- **재시도 정책**: N/A: 신규 서버에서 외부 호출이 발생할 때는 `_common.retry` 모듈 사용 (Exponential Backoff, 5xx 시 1회 재시도 권장)
- **Circuit Breaker**: N/A: 신규 서버에서 도입 시 동일 백엔드 10초 내 5회 실패 → 30초 차단 권장 (PRD §3 패턴)
- **메시지 정책**: 원인과 조치를 한 문장에 포함. 예: `"알 수 없는 타임존: Asia/Foo"` → 신규 서버에서는 `"알 수 없는 타임존: Asia/Foo. IANA 타임존 이름을 확인하세요 (예: UTC, Asia/Seoul)."` 형태로 조치 안내 추가 권장

---

## 8. 산출물

- [x] **소스 (기 구현)**: `src/mcp-servers/starter_mcp/`
  - `__init__.py`, `server.py`, `tools.py`, `primitives.py`, `config.py`, `models.py`, `.env.example`, `README.md`
- [x] **테스트 코드 및 결과 (기 구현)**: `tests/starter_mcp/` 총 31 건
  - `conftest.py`: FastMCP in-memory `Client` fixture
  - `test_tools.py`: 도구별 happy path, 에러 케이스, `_common` 호출 흔적 검증 (8 케이스)
  - `test_mcp_contract.py`: `list_tools()` + `inputSchema` 표준 contract (5 케이스)
  - `test_primitives.py`: capabilities, Resources, Prompts, `sample_content` (18 케이스). HTTP capabilities 는 `tests/http_transport/` 에서 확인
- [x] **Makefile 타겟**: `make run-starter-mcp` (stdio), `make run-starter-mcp-http` (HTTP 8001), `make test-starter-mcp`, `make cli-list-tools-starter`, `make cli-call-starter`
- [x] **레지스트리 등록**: `configs/mcp_servers.yaml` 에 stdio + http 양 변형 등록
- [x] **README**: [`src/mcp-servers/starter_mcp/README.md`](../../src/mcp-servers/starter_mcp/README.md): 신규 서버 만드는 5 단계 절차 포함
- [ ] **LLM Tool-calling 평가셋** (사용자 발화 → 기대 호출 시퀀스 10건 이상) 및 통과율 결과서: **미구현** (Phase 5 LLM 통합 시점에 추가 예정)
- [ ] 운영 가이드 / 운영 모니터링 대시보드: N/A (학습용)

---

## 9. 일정

| 단계 | 기한 |
|---|---|
| 본 정의서 v0.1 (역추출) | 2026-05-23 |
| v0.2 (Resources, Prompts, `sample_content` 추가) | 2026-10-23 |
| 구현 완료 | **완료** (현재 main 브랜치 머지 상태) |
| 테스트 31건 통과 확인 | **완료** |
| LLM Tool-calling 평가셋 작성 | Phase 5 LLM 통합 시점 (미정) |
| 본 정의서 v1.0 승격 | 평가셋 통과 결과 첨부 후 |

> ℹ️ 본 정의서는 *역추출* 정의서이므로 구현이 정의서를 선행한 상태. v1.0 승격은 평가셋 인수 기준 충족 시점 기준.

---

## 10. 인수 기준 (Acceptance Criteria)

- [x] §5 에 정의된 4 개 Tool (`echo`, `add`, `current_time`, `sample_content`) 이 명세대로 동작 (입력/출력/에러 케이스 포함)
- [x] §5.3 Resources 4종과 §5.4 Prompts 2종이 명세대로 동작하고, stdio 와 Streamable HTTP 양쪽 `initialize` 의 capabilities 에 `resources`, `prompts` 가 포함
- [x] `make test-starter-mcp` 31 건 전체 통과
- [x] `make run-starter-mcp` (stdio) 및 `make run-starter-mcp-http` (HTTP 8001) 양 transport 정상 기동. 두 transport 에서 `list-tools` 결과가 일치
- [x] CLI 검증: `python scripts/mcp_cli.py call --server starter-mcp --tool echo --params '{"text":"hi"}'` 정상 응답 (PRD §9 인수 기준, 응답의 `untrusted_content.content` 가 `hi`). `make cli-call-starter` 로 동일하게 실행
- [x] CLI 검증: `python scripts/mcp_cli.py call --server starter-mcp --tool current_time --params '{"tz":"Asia/Seoul"}'` ISO 8601 문자열 반환
- [x] CLI 검증: 알 수 없는 타임존 입력 시 `INVALID_INPUT` 에러 자연어 메시지 반환
- [x] 빈 문자열 `echo` 호출 시 `text is required` 에러 반환
- [x] Frontend `/inspector` 페이지에서 4 개 Tool 모두 호출 성공 (HTTP 변형 등록)
- [x] §6.2 보안 패턴 시연 확인: `echo` 응답에 `untrusted_content` 키 존재, `add` 호출 시 stderr 로그에 `params_hash` 16 자 hex 출력
- [x] §8 의 기 구현 산출물 일체 제출 및 검수 완료
- [ ] **LLM Tool-calling 평가셋 통과율 ≥ 90%**: 평가셋 미구현으로 v1.0 승격 시 충족 필요
