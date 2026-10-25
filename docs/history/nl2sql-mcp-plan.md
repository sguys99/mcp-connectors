# NL2SQL MCP 서버 개발 계획 (MVP 당시 기록)

> 이 문서는 Oracle 전용으로 만들던 MVP 시기의 개발 계획입니다. 2026-10-22에 서버 이름을 `nl2sql_mcp`로 바꾸고 dialect 어댑터(PostgreSQL 기본, Oracle 선택)를 넣으면서 경로와 서버 이름만 새 이름으로 고쳤고, 본문의 Oracle 전제와 `ORACLE_*` 환경 변수는 당시 내용 그대로 둡니다. 현재 구조와 환경 변수는 [서버 README](../../src/mcp-servers/nl2sql_mcp/README.md)를 보세요.

> 스펙 원본: [docs/mcp-spec/nl2sql-mcp_v0.1.md](../mcp-spec/nl2sql-mcp_v0.1.md)
> 구현 대상: T-01, T-02, T-03, T-04, T-14 (우선 구현), T-05~T-13 (추후)
> 구현 경로: `src/mcp-servers/nl2sql_mcp/`

---

## 설계 결정 요약

| 항목 | 결정 |
|---|---|
| Oracle 연동 | Mock/실 Oracle 양방향 (`ORACLE_MOCK_MODE=true/false`) |
| 가드레일 구조 | 스펙 §7 정렬 패키지 (`guardrails/`, 가드레일별 독립 파일) |
| 가드레일 범위 | 전체 7.1~7.9 (optional 항목은 `enabled=True` 기본, config로 비활성 가능) |
| 프로젝트 컨벤션 | `_common/` 유틸 재사용, `--import-mode=importlib`, ruff |
| `/temp` 활용 | 5개 모듈 내부 로직 발췌 재사용 (하단 표 참조) |

---

## Phase 0: 사전 준비

- [x] `/temp` 폴더 핵심 모듈 분석 완료 (connector.py, sql_guard.py, sanitize.py, audit.py, circuit.py)
- [x] `/docs/nl2sql-mcp-plan.md` 파일 생성 (본 문서, 지금은 `docs/history/nl2sql-mcp-plan.md`)
- [x] `src/mcp-servers/nl2sql_mcp/` 디렉토리 스캐폴드 준비

---

## Phase 1: `/mcp-server-builder` 스킬로 기본 스캐폴드 생성

- [x] 스킬 호출: 서버명 `nl2sql_mcp`, 도구 5개(T-01, 02, 03, 04, 14), 스펙 경로 지정
- [x] 생성 결과 확인
  - [x] `server.py`: FastMCP 진입점
  - [x] `config.py`: pydantic-settings
  - [x] `models.py`: 응답 모델
  - [x] `tools/`: 도구 함수 플레이스홀더 5개
  - [x] `.env.example`
  - [x] `README.md`

> **스캐폴드 이후 수동 추가 대상**: `guardrails/` 패키지(9개 파일), `db/` 패키지(connector + mock)

---

## Phase 2: 디렉토리 구조 완성

목표 구조:
```
src/mcp-servers/nl2sql_mcp/
├── server.py
├── config.py
├── models.py
├── tools/
│   ├── __init__.py
│   ├── search_tables_schema.py    # T-01
│   ├── search_columns.py          # T-02
│   ├── get_table_schema.py        # T-03
│   ├── get_tables_schema.py       # T-04
│   └── run_sql_query.py           # T-14
├── guardrails/
│   ├── __init__.py                # apply_guardrails 파이프라인 실행기
│   ├── enforce_select_only.py     # 7.1
│   ├── enforce_date_range.py      # 7.2
│   ├── enforce_row_limit.py       # 7.3
│   ├── enforce_timeout.py         # 7.4
│   ├── block_forbidden_constructs.py  # 7.5 (optional)
│   ├── enforce_pii_control.py     # 7.6
│   ├── block_mass_scan.py         # 7.7
│   ├── audit_log.py               # 7.8
│   └── detect_risky_sql.py        # 7.9 (optional)
├── db/
│   ├── __init__.py                # get_backend() 팩토리
│   ├── connector.py               # OracleConnectionManager
│   └── mock_backend.py            # MockBackend (픽스처)
└── tests/
    ├── test_tools.py
    └── test_guardrails.py
```

- [x] `guardrails/` 패키지 생성 및 9개 파일 stub 작성
- [x] `db/` 패키지 생성 (`__init__.py`, `connector.py`, `mock_backend.py`)

---

## Phase 3: `db/` 레이어 구현

### `db/connector.py`: 실 Oracle 연동
- [x] `/temp/guardrail/db/connector.py` 발췌, 적용
- [x] `OracleConnectionManager` (async oracledb pool, min=1, max=5)
- [x] `ALTER SESSION SET TRANSACTION READ ONLY` 강제 적용
- [x] Thin Mode 기본 / `ORACLE_CLIENT_LIB_DIR` 설정 시 Thick Mode 전환
- [x] `search_tables()`, `search_columns()`, `get_table_schema()`, `get_tables_schema()`, `execute_query()` 메서드

### `db/mock_backend.py`: Mock 백엔드
- [x] `MockBackend` 클래스 구현
- [x] 픽스처 테이블: Pagila(`public`) 테이블 15개와 뷰 7개 (Phase 1-C에서 카드 도메인 원본을 교체, 대응표는 [nl2sql-pagila-mapping.md](../revamp/nl2sql-pagila-mapping.md))
- [x] `search_tables()`, `search_columns()`, `get_table_schema()`, `get_tables_schema()`, `execute_query()` 메서드 구현
- [x] `ORACLE_MOCK_MODE=true` 환경변수 기본값

### `db/__init__.py`: 팩토리
- [x] `get_backend()`: `settings.oracle_mock_mode` 분기 (`MockBackend` / `OracleConnectionManager`)

---

## Phase 4: 가드레일 구현 (7.1~7.9)

> 스펙 §7 시그니처 준수. `/temp/` 코드를 내부 로직으로 발췌.

### 7.1 `enforce_select_only`: 차단형
- [x] allowlist(`SELECT`, `WITH`) + denylist 양방향 검사
- [x] sqlglot AST 파싱 (`/temp/guardrail/input/sql_guard.py` 발췌)
- [x] 위반 시 `WRITE_BLOCKED` (`_common/errors.py::AccessDeniedError`) raise

### 7.2 `enforce_date_range`: 변환형 (보정된 SQL 반환)
- [x] 기간 컬럼 감지 (`date_columns` 인자 또는 휴리스틱)
- [x] 기간 미지정 시 `default_months=3` 조건 자동 주입
- [x] `max_months=12` 초과 시 `DATE_RANGE_EXCEEDED` raise
- [x] 보정된 SQL 반환

### 7.3 `enforce_row_limit`: 변환형 (보정된 SQL 반환)
- [x] `FETCH FIRST N ROWS ONLY` 자동 주입 (Oracle 19 기준)
- [x] 사용자 지정 limit이 `max_limit=10000` 초과 시 상한 클램핑
- [x] 보정된 SQL 반환

### 7.4 `enforce_timeout`: 실행 래퍼
- [x] `asyncio.wait_for(coro, timeout=default_timeout_sec)` 래핑
- [x] 초과 시 `QUERY_TIMEOUT` raise
- [x] `/temp/guardrail/execution/circuit.py` 발췌

### 7.5 `block_forbidden_constructs`: 차단형, optional
- [x] `enabled=True` 기본값 (config `GUARDRAIL_FORBIDDEN_ENABLED` 로 제어)
- [x] DBLINK(`@`), 시스템 객체(`SYS.`, `DBMS_`), 동적 SQL, 위험 힌트, 다중 문장 검사
- [x] `FORBIDDEN_SQL_BLOCKED` raise

### 7.6 `enforce_pii_control`: 차단 + 변환형
- [x] **입력 단계**: SELECT 대상 컬럼이 `pii_catalog`에 있으면 `PII_COLUMN_BLOCKED` raise
- [x] **출력 단계**: 결과 값에 카드번호, 주민번호 패턴 마스킹 (`_common/masking.py::mask_pii` 재사용)
- [x] `pii_catalog` 기본값: `["EMAIL", "FIRST_NAME", "LAST_NAME", "PHONE", "ADDRESS", "PASSWORD"]` (Phase 1-C에서 Pagila 기준으로 변경)

### 7.7 `block_mass_scan`: 차단형
- [x] WHERE 절 없는 단일 테이블 SELECT 차단 (`require_where=True`)
- [x] `1=1`, `TRUE` 무력화 조건 탐지 (`block_tautology=True`)
- [x] ON/WHERE 미지정 다중 테이블 JOIN 탐지 (`block_cartesian=True`)
- [x] `MASS_SCAN_BLOCKED` raise

### 7.8 `audit_log`: 감사 로깅 (전 도구)
- [x] 구조화 JSON 로깅 (`_common/logging.py::setup_logger` 확장)
- [x] 저장소: SQLite (`audit.db`, `retention_days` 기반 자동 정리), stdlib sqlite3 + asyncio.to_thread
- [x] 기록 항목: 호출시각, 세션ID, Tool명, SQL원문, 검증결과, 실행시간, 반환건수, 오류
- [x] PII 마스킹 후 저장 (`mask_pii=True`)
- [x] `async with audit_log(event):` 컨텍스트 매니저 형태 + `run_audit_log()` one-shot 함수

### 7.9 `detect_risky_sql`: 차단형, optional
- [x] `enabled=True` 기본값 (config `GUARDRAIL_RISKY_SQL_ENABLED` 로 제어)
- [x] UNION 기반 injection, 주석 회피(`/**/`, `--`, `#`) 탐지
- [x] `UTL_*`, `DBMS_*` 시스템 함수 호출 탐지
- [x] `object_whitelist` 기반 허용 테이블 외 참조 차단
- [x] `RISKY_SQL_BLOCKED` raise

### `guardrails/__init__.py`: 파이프라인 실행기
- [x] `PIPELINE_T14`: 7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3 순서 정의
- [x] `PIPELINE_SCHEMA`: 7.9→7.6 순서 정의 (T-01~T-04용)

---

## Phase 5: Tools 구현 (T-01~T-04, T-14)

### T-01 `search_tables_schema`
- [x] 가드레일: 7.8(audit) → 7.9(whitelist) → 7.6(PII 컬럼 노출 통제)
- [x] 입력: `pattern` (필수), `limit` (기본 20, 최대 50)
- [x] 출력: `tables[]`, `match_count`, `truncated`
- [x] `TOO_MANY_TABLES` 에러 처리 (limit 초과 시)

### T-02 `search_columns`
- [x] 가드레일: 7.8 → 7.9 → 7.6
- [x] 입력: `column_pattern` (필수), `limit` (기본 50, 최대 200)
- [x] 출력: `columns[]`, `match_count`, `truncated`
- [x] `TOO_MANY_COLUMNS` 에러 처리

### T-03 `get_table_schema`
- [x] 가드레일: 7.8 → 7.9 → 7.6
- [x] 입력: `table_name` (스키마 한정 가능 `public.customer`)
- [x] 출력: `owner`, `table_name`, `comment`, `columns[]`, `primary_key`, `foreign_keys`
- [x] `TABLE_NOT_FOUND` 에러 처리
- [x] PL/SQL 소스 반환 시 `_common/trust.py::wrap_untrusted` 적용

### T-04 `get_tables_schema`
- [x] 가드레일: 7.8 → 7.9
- [x] 입력: `table_names` (최대 20개)
- [x] 출력: `tables[]`, `not_found[]`
- [x] `INVALID_INPUT` 에러 처리 (20개 초과)
- [x] 부분 누락 시 `not_found` 배열로 보고

### T-14 `run_sql_query`
- [x] 가드레일 전체 파이프라인: 7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3→7.4→7.6(결과마스킹)→7.8
- [x] 입력: `sql` (필수), `max_rows` (기본 1000, 최대 10000)
- [x] 출력: `columns`, `rows`, `row_count`, `truncated`, `masked_columns`, `explain`
- [x] `explain`: `estimated_cost`, `estimated_rows`, `full_scan_tables`

---

## Phase 6: `server.py` 완성

- [x] FastMCP 인스턴스 생성 (`nl2sql-mcp`)
- [x] `@asynccontextmanager` lifespan: DB 풀 초기화/종료, audit DB 연결 (`purge_old_audit_records` 추가)
- [x] 5개 도구 등록 (`@mcp.tool` 데코레이터 + import 방식)
- [x] `_common/cors.py::build_cors_middleware()` 적용
- [x] stdio/HTTP 양 transport 지원 (`--transport` CLI 인자)

---

## Phase 7: `config.py` 완성

- [x] `pydantic-settings` `Settings` 클래스
- [x] Oracle 접속 정보: `ORACLE_HOST`, `ORACLE_PORT`, `ORACLE_SERVICE`, `ORACLE_USER`, `ORACLE_PASSWORD`
- [x] Mock 전환: `ORACLE_MOCK_MODE=true` (기본값)
- [x] 가드레일 임계치 환경변수:
  - `GUARDRAIL_MAX_LIMIT=10000` (`GUARDRAIL_DEFAULT_LIMIT` 제거: dead config)
  - `GUARDRAIL_DEFAULT_MONTHS=3`
  - `GUARDRAIL_MAX_MONTHS=12`
  - `GUARDRAIL_TIMEOUT_SEC=30`
  - `GUARDRAIL_FORBIDDEN_ENABLED=true`
  - `GUARDRAIL_RISKY_SQL_ENABLED=true`
  - `AUDIT_RETENTION_DAYS=30`
  - `PII_CATALOG_RAW=RRN,...` (계획서의 `PII_CATALOG`와 다름: pydantic property 충돌 회피)
- [x] settings → `enforce_date_range` 파라미터 주입 (`default_months`, `max_months`)

---

## Phase 8: 테스트 작성

### `tests/test_guardrails.py`

| # | 테스트 케이스 | 가드레일 | 기대 결과 |
|---|---|---|---|
| 1 | `DELETE FROM ...` 입력 | 7.1 | `WRITE_BLOCKED` |
| 2 | 유효한 `SELECT` | 7.1 | 통과 |
| 3 | 13개월 기간 조건 | 7.2 | `DATE_RANGE_EXCEEDED` |
| 4 | 기간 미지정 SELECT | 7.2 | 3개월 자동 주입된 SQL |
| 5 | LIMIT 없는 SELECT | 7.3 | `FETCH FIRST 1000 ROWS ONLY` 주입 |
| 6 | timeout 초과 | 7.4 | `QUERY_TIMEOUT` |
| 7 | DBLINK 포함 SQL | 7.5 | `FORBIDDEN_SQL_BLOCKED` |
| 8 | `enabled=False` 상태의 DBLINK | 7.5 | 통과 |
| 9 | PII 컬럼 직접 SELECT | 7.6 | `PII_COLUMN_BLOCKED` |
| 10 | 결과에 카드번호 패턴 | 7.6 | 마스킹 반환 |
| 11 | WHERE 없는 전체 조회 | 7.7 | `MASS_SCAN_BLOCKED` |
| 12 | `WHERE 1=1` 무력화 조건 | 7.7 | `MASS_SCAN_BLOCKED` |
| 13 | 카티시안 조인 | 7.7 | `MASS_SCAN_BLOCKED` |
| 14 | UNION injection | 7.9 | `RISKY_SQL_BLOCKED` |
| 15 | `enabled=False` + injection | 7.9 | 통과 |

- [x] 위 15개 테스트 케이스 구현

### `tests/test_tools.py`

| # | 테스트 케이스 | 도구 | 기대 결과 |
|---|---|---|---|
| 1 | `pattern="CUST%"` | T-01 | `customer` 포함 반환 |
| 2 | 결과 limit 초과 패턴 | T-01 | `TOO_MANY_TABLES` |
| 3 | `column_pattern="AMOUNT"` | T-02 | 매칭 컬럼 반환 |
| 4 | `table_name="PAYMENT"` | T-03 | 컬럼, PK, FK 반환 |
| 5 | 없는 테이블명 | T-03 | `TABLE_NOT_FOUND` |
| 6 | 21개 테이블 목록 | T-04 | `INVALID_INPUT` |
| 7 | 일부 없는 테이블 포함 목록 | T-04 | `not_found` 배열 포함 |
| 8 | 유효한 SELECT (Mock) | T-14 | rows 반환 |
| 9 | `DELETE` SQL | T-14 | `WRITE_BLOCKED` |
| 10 | WHERE 없는 SELECT | T-14 | `MASS_SCAN_BLOCKED` |

- [x] 위 10개 테스트 케이스 구현

---

## Phase 9: Makefile & 레지스트리 등록

### 9-1. Makefile 타겟 ✅ (이미 완료)

현재 `Makefile` line 99–106에 이미 반영되어 있음.

| 타겟 | transport | 포트 |
|---|---|---|
| `run-nl2sql-mcp` | stdio | - |
| `run-nl2sql-mcp-http` | Streamable HTTP | 8004 |
| `test-nl2sql-mcp` | pytest (25 cases) | - |

---

### 9-2. `configs/mcp_servers.yaml`: 2개 항목 추가

기존 3개 항목(`starter-mcp`, `starter-mcp-http`, `mock-repo-mcp`) 뒤에 추가:

```yaml
  - name: nl2sql-mcp
    transport: stdio
    command: ["uv", "run", "python", "-m", "nl2sql_mcp.server"]
    description: "Oracle NL2SQL MCP, stdio (IDE 통합용)"

  - name: nl2sql-mcp-http
    transport: streamable_http
    url: http://localhost:8004/mcp
    description: "Oracle NL2SQL MCP, Streamable HTTP (Inspector / Chat 시연용)"
```

- [x] `configs/mcp_servers.yaml`에 위 2개 항목 추가

---

### 9-3. `.env.example` (루트): Oracle 섹션 추가

루트 `.env.example`은 전 프로젝트 공용 최소 참조. 가드레일 임계치는 서버 내부 `.env.example`에 보관하고 핵심 접속 변수만 추가:

```dotenv
# ── Oracle NL2SQL MCP ────────────────────────────────────────────────────────
NL2SQL_MCP_PORT=8004
ORACLE_MOCK_MODE=true               # false 시 아래 Oracle 접속 정보 필요
ORACLE_HOST=localhost
ORACLE_PORT=1521
ORACLE_SERVICE=ORCL
ORACLE_USER=nl2sql_ro
ORACLE_PASSWORD=
```

- [x] 루트 `.env.example` 끝에 위 섹션 추가

---

### 9-4. `frontend/src/lib/mcp/registry.ts`: 수동 미러 업데이트

`registry.ts`는 `configs/mcp_servers.yaml`의 수동 미러 (`// 변경 시 반드시 본 상수도 함께 수정할 것`). yaml 변경 후 동기화 필수.

`SERVERS` 배열 끝에 추가:

```typescript
  {
    name: "nl2sql-mcp",
    transport: "stdio",
    command: ["uv", "run", "python", "-m", "nl2sql_mcp.server"],
    description: "Oracle NL2SQL MCP, stdio (IDE 통합용)",
  },
  {
    name: "nl2sql-mcp-http",
    transport: "streamable_http",
    url: "http://localhost:8004/mcp",
    description: "Oracle NL2SQL MCP, Streamable HTTP (Inspector / Chat 시연용)",
  },
```

- [x] `frontend/src/lib/mcp/registry.ts` SERVERS 배열에 위 2개 항목 추가

---

### 검증

- [x] `make cli-list-servers`: nl2sql-mcp 노출 확인
- [x] `make run-nl2sql-mcp-http`: ORACLE_MOCK_MODE=true 기동 확인
- [ ] Frontend `/inspector` 서버 선택 드롭다운에 nl2sql-mcp-http 노출 확인

---

## Phase 10: 검증

- [x] `make test-nl2sql-mcp`: 전체 테스트 통과 (38개 케이스)
- [x] `make run-nl2sql-mcp-http` → `ORACLE_MOCK_MODE=true` 상태로 기동 확인
- [x] CLI 검증:
  ```bash
  python scripts/mcp_cli.py call --server nl2sql-mcp \
    --tool search_tables_schema --params '{"pattern":"CUST%"}'
  ```
- [ ] Frontend `/inspector`에서 5개 도구 단건 호출 시증
- [ ] Frontend `/chat`에서 자연어 → T-14 실행 루프 시증

---

## `/temp` 발췌 재사용 대상

| `/temp` 원본 파일 | 재사용 위치 | 활용 내용 |
|---|---|---|
| `guardrail/db/connector.py` | `db/connector.py` | async pool, READ ONLY 세션 강제 |
| `guardrail/input/sql_guard.py` | `guardrails/enforce_select_only.py`, `detect_risky_sql.py` | sqlglot AST 파싱 로직 |
| `guardrail/execution/circuit.py` | `guardrails/enforce_timeout.py`, `enforce_row_limit.py` | timeout, FETCH FIRST 주입 |
| `guardrail/output/sanitize.py` | `guardrails/enforce_pii_control.py` | PII 마스킹 regex 패턴 |
| `guardrail/observability/audit.py` | `guardrails/audit_log.py` | structlog JSONL 감사 로그 패턴 |

## `/temp` 충돌 해결 방침

| 충돌 항목 | 해결 방침 |
|---|---|
| 에러 응답 형식 | 프로젝트 컨벤션 채택: `_common/errors.py` `ToolError` raise |
| 응답 래핑 | `_common/trust.py::wrap_untrusted()` (dict 기반) 사용 |
| 설정 방식 | pydantic-settings 유지 (YAML ACL 미사용) |
| 인증 | `_common/auth.py` 단일 키 방식 (MVP) |

---

## 추후 구현 대상 (T-05~T-13)

| Tool ID | Tool Name | 설명 |
|---|---|---|
| T-05 | `get_related_tables` | FK 기준 연관 테이블 조회 |
| T-06 | `get_table_constraints` | PK/FK/Unique/Check 제약 조회 |
| T-07 | `get_table_indexes` | 인덱스 조회 |
| T-08 | `get_dependent_objects` | 의존 객체 조회 |
| T-09 | `get_pl_sql_objects` | PL/SQL 객체 목록 조회 |
| T-10 | `get_object_source` | PL/SQL 소스 조회 |
| T-11 | `get_user_defined_types` | 사용자 정의 타입 조회 |
| T-12 | `get_database_vendor_info` | DB 버전, 메타 정보 |
| T-13 | `rebuild_schema_cache` | 스키마 캐시 재빌드 |
