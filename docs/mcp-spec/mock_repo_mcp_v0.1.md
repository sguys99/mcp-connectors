# mock-repo-mcp 요구사항 정의서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | mock-repo-mcp 요구사항 정의서 |
| 버전 | v0.1 |
| 작성자 | maintainer |
| 작성일 | 2026-05-23 |

---

## 1. 개요

### 1.1 서버명 / 한 줄 소개

- **서버명**: `mock-repo-mcp`
- **한 줄 소개**: 내부 코드 저장소 도메인을 모사한 reference MCP 서버. Agent가 in-memory fixture 기반 저장소, 파일, 코드를 조회할 수 있게 한다.

### 1.2 목적 및 배경

- **목적**: 신규 MCP 서버 추가 시 따라야 할 표준 패턴(`BackendClient` Protocol 분리, `wrap_untrusted` 신뢰 경계, 페이지네이션, 입력 검증, 한국어 에러 메시지)을 한 코드베이스 안에서 시증하기 위한 reference 서버를 정의한다.
- **배경**: 본 코드베이스(`mcp-connectors`)는 기업 내부 시스템(코드 저장소, RDB, DW, 메타정보, 내부 API 등) 다수를 동일 컨벤션으로 MCP 화하는 통합 저장소이다. 차기 개발자가 `/mcp-spec-writer` → `/mcp-server-builder` 워크플로우로 30분 내 신규 서버를 추가할 수 있어야 하며, 그를 위해 PRD §3.9.2 (Protocol 패턴), §3.9.3 (`_common/` 단방향 의존), §3.9.4 (신뢰 경계) 의 실증 코드가 baseline 으로 필요하다. `starter_mcp` 가 transport 레벨 최소 예시라면 본 서버는 그 위에 "백엔드 추상화 + 신뢰 경계 + 페이지네이션 + 검색" 까지 포함한 한 단계 더 풍부한 예시이다.
- **기대 효과**: (1) `BackendClient` Protocol + `MockBackendClient` 구현으로 내부 백엔드 미연동 상태에서도 e2e 시증 가능. (2) `get_file_content` 가 `wrap_untrusted` 를 통해 LLM 시스템 프롬프트와 외부 파일 본문을 분리하는 패턴을 코드로 보여줌. (3) Frontend `/inspector` 와 `/chat`, CLI 검증 흐름의 baseline 시증.

---

## 2. 범위

### 2.1 포함 범위 (In-Scope)

- 저장소 메타데이터 목록 조회 (이름 부분 일치 필터 + offset/limit 페이지네이션)
- 단일 파일 본문 조회 (`wrap_untrusted` 로 metadata 와 untrusted_content 분리)
- 단순 substring 코드 검색 (전체 저장소 또는 특정 저장소 범위)
- In-memory fixture 기반 결정론적 응답 (테스트 / 데모 / Inspector 시증용)
- 입력 검증(음수 limit/offset, 빈 query) 및 한국어/영문 혼용 에러 메시지

### 2.2 제외 범위 (Out-of-Scope)

- 실 백엔드(GitLab / Bitbucket / GitHub Enterprise / Gitea 등) 연동: `HttpBackendClient` 는 stub 만 제공 (PRD §8 PoC 범위 외)
- 쓰기 작업(커밋 생성, PR/CSR 작성, 권한 변경, 파일 업로드)
- 리비전/diff/changeset/blame/branch 조회: 본 서버는 단일 latest 본문만 다룸. 변경 이력 도메인은 별도 MCP 서버(`code-repo-mcp` 등) 의 책임 영역.
- 정규식 / glob 패턴 검색 (단순 substring 매치만)
- 다중 파일 일괄 본문 조회 (현재는 1회 호출당 1개 파일)

---

## 3. 사용자 및 주요 시나리오

### 3.1 사용 Agent

- **호출 주체**: Frontend `/chat` 의 LLM(Anthropic `claude-sonnet-4-6` 기본 / OpenAI / OpenRouter 선택 가능). 보조적으로 CLI(`scripts/mcp_cli.py`) 와 Frontend `/inspector` 의 도구 단건 호출.
- **호출 빈도**: 로컬 데모 / 회귀 테스트 / 인수 시증 용도. 정량 부하 목표 없음.
- **동시 세션**: 최대 3 (Inspector + Chat + CLI 동시 사용 시 상정).
- **호출 성격**: 읽기 100%.

### 3.2 주요 사용 시나리오 (Use Cases)

| ID | 시나리오 | 사용 Tool (5장과 매핑) |
|---|---|---|
| UC-01 | Agent가 어떤 저장소가 있는지 모를 때 카탈로그를 먼저 탐색한다 | `list_repositories` |
| UC-02 | 검색 결과 또는 사용자 발화의 path를 받아 해당 파일 본문을 조회한다 | `get_file_content` |
| UC-03 | 키워드(예: `"TODO"`, `"FIXME"`, 함수명) 가 사용된 위치를 전체 저장소에서 찾는다 | `search_code` (→ UC-02 로 연계) |
| UC-04 | 특정 저장소로 범위를 한정해 키워드를 검색한다 (다른 저장소 노이즈 제거) | `search_code(repository_id=...)` |

---

## 4. 시스템 구성

### 4.1 MCP 서버

| 항목 | 내용 |
|---|---|
| Transport | Streamable HTTP (기본) / stdio (개발용, `--transport stdio` 옵션) |
| 배포 환경 | 로컬 (Phase 6 까지 운영 환경 배포 없음. `docker-compose.yml` 로 로컬 스택 일괄 기동) |
| 엔드포인트 | `http://0.0.0.0:8002/mcp` (포트는 `MOCK_REPO_MCP_PORT` env, 기본 `8002`) |
| MCP SDK | FastMCP (Python 3.12, `pyproject.toml` 의 `mcp` / `fastmcp` 종속성) |
| 사용 프리미티브 | Tools 사용 / Resources, Prompts 미사용 |

### 4.2 연동 백엔드 시스템

| 항목 | 내용 |
|---|---|
| 시스템명 | In-memory fixture store (`MockBackendClient`) |
| 종류 | 로컬 파일시스템 기반 fixture (`fixtures/repos.json` + `fixtures/files/<repository_id>/<path>` 트리) |
| 엔드포인트 | N/A (모듈 로드 시 `MockBackendClient.__init__` 에서 메모리 적재, 이후 디스크 I/O 없음) |
| 프로토콜 | N/A (in-process) |
| 인증 방식 | N/A (fixture) |
| 권한 모델 | N/A (모든 fixture 데이터는 sample, 민감정보 없음) |
| 네트워크 | N/A |
| 데이터 모델 | 저장소 3종(`repo-alpha` / `repo-beta` / `repo-gamma`) + 저장소당 README + 1 코드 파일 |
| 향후 교체 | `HttpBackendClient` 가 동일 Protocol 을 구현하며 `MOCK_REPO_BACKEND_URL` 설정 시 `tools.py` 가 자동으로 선택. httpx 호출에 `_common/retry.with_backoff` (네트워크 오류, 5xx, 429 재시도) + `BackendUnavailableError` 변환 패턴을 적용했다. |

> ※ 본 서버는 reference / demo 목적이므로 §4.2 는 "확인 필요" 항목이 없다. 실제 내부 시스템 연동 MCP 서버(예: `code-repo-mcp`) 작성 시에는 백엔드 인터페이스가 확정될 때까지 해당 셀을 `**확인 필요 (XXX팀 회신 대기)**` 로 표기한다.

---

## 5. 기능 요구사항 (Tools)

### 5.1 Tool 목록 (요약)

Hint 칼럼(`readOnly` / `destructive` / `idempotent`)은 MCP 표준 annotation 이며, 클라이언트가 확인 다이얼로그 등 UX를 결정할 때 사용한다.

| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `list_repositories` | 저장소 메타데이터 목록 (이름 필터 + 페이지네이션) | true | false | true |
| T-02 | `get_file_content` | 단일 파일 본문 조회 (`wrap_untrusted` 적용) | true | false | true |
| T-03 | `search_code` | substring 코드 검색 (전체 또는 단일 저장소 범위) | true | false | true |

### 5.2 Tool 상세 명세

#### ▶ T-01 `list_repositories`

- **설명**: 등록된 저장소의 메타데이터 목록을 이름 부분 일치 필터와 offset/limit 페이지네이션으로 조회

- **LLM Description**
  ```
  접근 가능한 코드 저장소의 메타데이터 목록을 조회한다.
  Agent 가 어떤 저장소가 존재하는지 모르거나 repository_id 를 찾아야 할 때 사용.
  이미 repository_id 를 알고 있다면 호출하지 말 것 (불필요한 호출).
  name_pattern 은 대소문자 무시 부분 일치이므로 키워드 한 단어만 넘겨도 충분.
  호출 예: "어떤 저장소가 있는지 보여줘" → list_repositories()
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `name_pattern` | string | N | 저장소 이름의 부분 일치 필터 (대소문자 무시). 미지정 시 전체 반환 |
  | `limit` | int | N | 반환 최대 개수. 기본 20. 음수 입력 시 `INVALID_INPUT` |
  | `offset` | int | N | 페이지 시작 오프셋. 기본 0. 음수 입력 시 `INVALID_INPUT` |

- **출력 예시 (정상)**
  ```json
  {
    "repositories": [
      {
        "id": "repo-alpha",
        "name": "alpha-service",
        "description": "결제 도메인 백엔드 서비스 (sample)",
        "default_branch": "main"
      },
      {
        "id": "repo-beta",
        "name": "beta-frontend",
        "description": "어드민 콘솔 프론트엔드 (sample)",
        "default_branch": "main"
      },
      {
        "id": "repo-gamma",
        "name": "gamma-utils",
        "description": "공용 유틸 라이브러리 (sample)",
        "default_branch": "develop"
      }
    ],
    "total_count": 3
  }
  ```

- **빈 결과**: `{"repositories": [], "total_count": 0}` (필터 조건에 부합하는 저장소 없음)

- **응답 크기 제어**: `limit` 기본 20, 권장 ≤ 100. fixture 규모상 상한 강제 없음 (실 백엔드 도입 시 상한 강제 도입 예정). `total_count` 는 페이지 적용 *이전* 의 전체 매칭 수이므로 Agent 가 추가 페이지 필요성을 판단할 수 있다.

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "limit must be >= 0, got -1": `limit` 또는 `offset` 이 음수일 때. 양의 정수로 다시 호출 |
  | `INVALID_INPUT` | "offset must be >= 0, got -1": `offset` 이 음수일 때 |

---

#### ▶ T-02 `get_file_content`

- **설명**: 단일 파일 본문을 `wrap_untrusted` 형태(metadata + untrusted_content)로 반환

- **LLM Description**
  ```
  특정 저장소의 단일 파일 본문을 신뢰 경계로 감싸 반환한다 (metadata + untrusted_content).
  검색(search_code) 결과 path 의 전체 본문이 필요할 때, 혹은 사용자가 정확한 경로를 지정했을 때 사용.
  키워드 위치만 알고 싶다면 search_code 를 먼저 호출할 것 (본 Tool 은 전체 본문 반환이라 응답이 클 수 있음).
  revision 은 현재 mock 구현에서 무시되며 항상 default branch 본문이 반환된다.
  호출 예: "repo-alpha 의 README 내용 보여줘" → get_file_content(repository_id="repo-alpha", path="README.md")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `repository_id` | string | Y | 저장소 식별자 (예: `"repo-alpha"`). `list_repositories` 로 사전 확인 가능 |
  | `path` | string | Y | 저장소 루트 기준 상대 경로 (예: `"README.md"`, `"src/main.py"`) |
  | `revision` | string | N | 리비전 식별자. Mock 구현은 무시. 미지정 시 default branch 로 간주 |

- **출력 예시 (정상)**
  ```json
  {
    "metadata": {
      "path": "README.md",
      "revision": null,
      "size": 219
    },
    "untrusted_content": {
      "content": "# alpha-service\n\n결제 도메인 백엔드 서비스 (sample fixture).\n\n## 개요\n\n- 언어: Python 3.12\n- 프레임워크: FastAPI\n- 상태: TODO 항목 다수. 본 README 는 검색 데모용 샘플이다.\n\n## TODO\n\n- [ ] 결제 실패 재시도 로직\n- [ ] FIXME: 잔액 조회 캐싱 정책 재검토\n"
    }
  }
  ```

- **빈 결과**: `untrusted_content.content == ""` (실제로 빈 파일인 경우). `metadata.size` 도 0. (fixture 데이터에는 빈 파일 없음)

- **응답 크기 제어**: 현재 fixture 의 모든 파일이 1 KB 미만이라 별도 상한 없음. 실 백엔드 도입 시 단일 파일 ≤ 5 MB / ≤ 32 K tokens 한도와 `FILE_TOO_LARGE` 코드 도입 예정. 신뢰 경계상 본문은 항상 `untrusted_content.content` 필드에만 위치하며 `metadata` 에는 절대 섞이지 않는다.

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `FILE_NOT_FOUND` | "FILE_NOT_FOUND: repo-alpha:no-such-file.txt": `(repository_id, path)` 조합이 fixture 에 없을 때. `list_repositories` 로 저장소를 재확인하거나 `search_code` 로 path 를 다시 탐색 |

---

#### ▶ T-03 `search_code`

- **설명**: 모든 저장소(또는 지정한 저장소)에서 substring 을 라인 단위로 검색하여 매치 위치(`repository_id`, `path`, `line_number`, `preview`) 반환

- **LLM Description**
  ```
  fixture 에 적재된 모든 파일에서 query 와 일치하는 substring 을 라인 단위로 검색한다.
  "이 키워드가 어디에 있는가", "이 TODO 항목이 어느 파일에 있는가" 등 위치 탐색에 사용.
  매치된 line_number 와 preview 만 반환하므로, 전체 본문이 필요하면 get_file_content 로 후속 호출할 것.
  매치가 많을 것으로 예상되면 repository_id 로 범위를 좁히는 것이 응답 크기 / 비용 절감에 유리.
  호출 예: "TODO 가 있는 위치 다 알려줘" → search_code(query="TODO")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `query` | string | Y | 검색할 substring. 빈 문자열 입력 시 `INVALID_INPUT`. 대소문자 구분(case-sensitive) |
  | `repository_id` | string | N | 검색 범위 제한. 미지정 시 모든 저장소 대상 |
  | `limit` | int | N | 매치 누적 상한. 기본 50. 음수 입력 시 `INVALID_INPUT`. 도달 시 즉시 반환(조기 종료) |

- **출력 예시 (정상)**
  ```json
  {
    "matches": [
      {
        "repository_id": "repo-alpha",
        "path": "README.md",
        "line_number": 9,
        "preview": "- 상태: TODO 항목 다수. 본 README 는 검색 데모용 샘플이다."
      },
      {
        "repository_id": "repo-alpha",
        "path": "README.md",
        "line_number": 11,
        "preview": "## TODO"
      },
      {
        "repository_id": "repo-alpha",
        "path": "src/main.py",
        "line_number": 10,
        "preview": "    # TODO: include downstream dependency check"
      },
      {
        "repository_id": "repo-gamma",
        "path": "src/strings.py",
        "line_number": 5,
        "preview": "    # TODO: unicode normalization 추가"
      }
    ]
  }
  ```

- **빈 결과**: `{"matches": []}` (검색어와 일치하는 라인 없음). 예: `query="ZZZ_NOT_PRESENT_XYZ"`.

- **응답 크기 제어**: `limit` 기본 50, 권장 ≤ 200. `preview` 는 매치된 라인 원문 1줄 그대로 반환되므로 매치 수 × 평균 라인 길이 가 응답 크기. line_number 는 1-base.

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "query must not be empty": `query` 가 빈 문자열일 때. 검색어를 1자 이상 지정하여 다시 호출 |
  | `INVALID_INPUT` | "limit must be >= 0, got -1": `limit` 이 음수일 때 |

---

## 6. 비기능 요구사항

### 6.1 성능 / 응답 크기

응답 크기는 바이트뿐 아니라 **토큰 관점**에서도 제약한다 (Agent 컨텍스트 윈도 보호). 본 서버는 in-memory fixture 기반이므로 외부 백엔드 지연이 없다.

- 단일 Tool 호출 P95 응답시간 < 200 ms (로컬, in-memory 기준)
- 동시 3 세션 처리 가능
- `search_code` 는 fixture 규모상 모든 라인을 순회하나 fixture 총 라인 수가 < 100 이라 O(N) 으로도 < 50 ms
- 리스트 반환 Tool(`list_repositories`, `search_code`) 은 `limit` / `offset` 또는 `limit` 단독으로 페이지 제어
- 실 백엔드 도입 시(향후): 단일 응답 ≤ 5 MB **및** ≤ 32 K tokens (`get_file_content` 기준), 그 외 Tool ≤ 1 MB **및** ≤ 8 K tokens 한도 적용

### 6.2 보안

본 서버는 fixture 기반이라 외부 자격증명을 다루지 않지만, 실 백엔드 도입 시 그대로 적용할 표준 보안 패턴을 baseline 으로 갖춘다.

- **MCP 인증**: `_common/auth.py` 의 ASGI 미들웨어가 HTTP 계층에서 `X-MCP-API-Key` 헤더를 검증 (불일치 시 401 + JSON-RPC 에러 본문). `MCP_API_KEY` env 미설정 시 자동 비활성 (MVP 기본값, 개발 편의). 운영 배포 시 env 설정 필수.
- **백엔드 자격증명**: 본 서버는 N/A. 실 백엔드 도입 시 토큰을 env 또는 시크릿 매니저에서만 주입, 코드/로그/응답에 평문 노출 금지.
- **인가 경계**: 본 서버는 fixture 전체가 sample 이므로 N/A. 실 백엔드 도입 시 Agent 단위 권한 매핑을 MCP 서버 단에서 추가 적용.
- **간접 prompt injection 방어**: `get_file_content` 응답은 `_common/trust.wrap_untrusted` 로 **metadata**(서버 신뢰 데이터: path / revision / size) 와 **untrusted_content**(외부 파일 본문 원문) 를 분리하여, LLM 시스템 프롬프트가 외부 텍스트를 명령으로 오인하지 않도록 한다.
- **민감정보**: fixture 에는 sample 데이터만 포함되어 민감정보 없음. 실 백엔드 도입 시 주민번호/카드번호/계좌번호 자동 마스킹 적용.
- **CORS**: `MCP_CORS_ORIGINS` env (콤마 구분, 기본 `http://localhost:3000`) 로 Frontend 직결 origin 제어. `_common/cors.build_cors_middleware()` 가 미들웨어를 빌드.

### 6.3 로깅

- **항목**: 호출 시각, Tool 명, **입력 파라미터의 SHA256 short hash** (`_common.logging.hash_params`), 로그 레벨 `info`. 응답 본문은 로깅하지 않음.
- **원문 비저장**: 검색어/파일 경로 등 입력 파라미터는 원문 대신 hash 만 저장하여 우발적 민감정보 유출을 차단.
- **보존 기간**: 로컬 시증 용도이므로 별도 보존 정책 없음. 운영 환경 배포 시(향후) 90일 보존, 내부 통합 로그 시스템 수집.

---

## 7. 에러 처리

MCP에서 에러는 **Agent 가 다음 행동을 결정할 수 있는 형태**여야 한다. 본 서버는 `_common/errors.py` 의 표준 예외 클래스를 raise 하며, FastMCP 가 자동으로 `isError: true` 응답으로 직렬화한다.

| 분류 | 처리 |
|---|---|
| 입력 오류 (`InvalidInputError`) | `isError: true` + 원인, 조치 자연어 메시지. Agent 가 입력을 수정하면 복구 가능 |
| 자원 없음 (`NotFoundError`, code: `FILE_NOT_FOUND`) | `isError: true` + 메시지에 `repository_id:path` 포함하여 Agent 가 잘못 추론한 경로를 인지하도록 함 |
| 백엔드 오류 | 본 서버는 fixture 기반이라 발생 케이스 없음. 실 백엔드 도입 시 `BackendUnavailableError` + tenacity 재시도, circuit breaker 추가 |

- **백엔드 호출 Timeout**: N/A (in-memory). 실 백엔드 도입 시 5초 + 1회 지수 백오프 재시도 권장
- **재시도**: 본 서버 N/A. 실 백엔드 도입 시 5xx 발생 시 1회 재시도 (Exponential Backoff)
- **Circuit Breaker**: 본 서버 N/A. 실 백엔드 도입 시 10초 내 5회 실패 → 30초 차단 권장

---

## 8. 산출물

- [x] 소스 코드: `src/mcp-servers/mock_repo_mcp/` (`server.py`, `tools.py`, `client.py`, `config.py`, `models.py`, `__init__.py`)
- [x] Fixtures: `src/mcp-servers/mock_repo_mcp/fixtures/repos.json` + `fixtures/files/{repo-alpha, repo-beta, repo-gamma}/` 트리
- [x] 환경 설정 템플릿: `.env.example`
- [x] 실행 가이드: `README.md` + Makefile target (`run-mock-repo-mcp`, `run-mock-repo-mcp` HTTP 모드)
- [x] 단위/통합 테스트: `tests/mock_repo_mcp/` (`test_mcp_contract.py` 5건 + `test_tools.py` 11건, 총 16건 통과)
- [x] CLI 검증 가이드: `scripts/mcp_cli.py` 의 `list-servers` / `list-tools` / `call` 명령
- [ ] **LLM Tool-calling 평가셋** (사용자 발화 → 기대 호출 시퀀스, UC-01~UC-04 기반 10건 이상) 및 통과율 결과서: v0.2 산출물
- [x] 본 요구사항 정의서 (`docs/mcp-spec/mock_repo_mcp_v0.1.md`)

---

## 9. 일정

| 단계 | 기한 |
|---|---|
| v0.1 정의서 작성 (본 문서) | 2026-05-23 |
| 구현 코드 + 테스트 완료 | 완료 (이전 phase) |
| LLM Tool-calling 평가셋 10건 작성 + 통과율 측정 (v0.2) | 미정 |
| `HttpBackendClient` 실 구현 + 실 백엔드 시증 (v1.0) | 미정 |

> ※ 본 서버는 reference / demo 목적이므로 운영 배포 일정은 별도로 잡지 않는다. 운영 환경 배포가 필요한 신규 MCP 서버 작성 시에는 본 표를 `.claude/skills/mcp-spec-writer/references/example_code_repo.md` 예시 수준으로 채워야 한다.

---

## 10. 인수 기준 (Acceptance Criteria)

- [x] 5장에 정의된 3개 Tool 이 명세대로 동작 (입력/출력/에러 케이스 포함)
- [x] `make test-mock-repo-mcp` 16건 전부 통과 (MCP contract 5건 + 성공/빈 결과/페이지네이션/입력 검증/`FILE_NOT_FOUND` 케이스 11건)
- [x] `make cli-list-tools-mock-repo` 가 3개 Tool(`list_repositories`, `get_file_content`, `search_code`) 반환
- [x] CLI 호출(`python scripts/mcp_cli.py call --server mock-repo-mcp --tool list_repositories --params '{}'`) 시 3개 저장소(`repo-alpha` / `repo-beta` / `repo-gamma`) 반환
- [x] Frontend `/inspector` 에서 `mock-repo-mcp` 서버 선택 후 3개 Tool 모두 호출 성공
- [x] `get_file_content` 응답이 `wrap_untrusted` 구조(metadata + untrusted_content) 로 분리되어 LLM 신뢰 경계가 응답 스키마 수준에서 가시화됨
- [x] 6.1 응답 크기 제어(limit/offset) 동작 확인 (테스트 `test_list_repositories_paginates`)
- [ ] **LLM Tool-calling 평가셋 통과율 ≥ 90%**: UC-01~UC-04 포함 10건 이상 (v0.2 인수 기준)
