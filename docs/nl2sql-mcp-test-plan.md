# NL2SQL MCP 검증 절차서

## 1. 개요

### 1.1 목적
`nl2sql_mcp` 서버가 요구사항 정의서(`docs/mcp-spec/nl2sql-mcp_v0.1.md`)와 구현 계획서(`docs/history/nl2sql-mcp-plan.md`) 기준으로 정상 구현되었는지 E2E로 검증합니다.

지금은 **Mock 모드**(`NL2SQL_DB_BACKEND=mock`, 기본값)와 **PostgreSQL dialect**(`NL2SQL_DB_DIALECT=postgres`, 기본값)로 실행합니다. 시나리오 SQL은 PostgreSQL 문법(`LIMIT`, `CURRENT_DATE - INTERVAL`, `pg_catalog` 등)으로, Mock 백엔드는 PostgreSQL Pagila 샘플 스키마(`public`)를 기준으로 작성되어 있어요. 실 DB(PostgreSQL + Pagila) 검증 절차는 Phase 2의 P2-4에서 이 문서에 추가할 예정입니다.

### 1.2 검증 범위

| 검증 항목 | 항목 수 | 케이스 수 | YAML 파일 |
|---|---|---|---|
| T-01 search_tables_schema | 1 | 20 | tools/T01_search_tables_schema.yaml |
| T-02 search_columns | 1 | 20 | tools/T02_search_columns.yaml |
| T-03 get_table_schema | 1 | 20 | tools/T03_get_table_schema.yaml |
| T-04 get_tables_schema | 1 | 20 | tools/T04_get_tables_schema.yaml |
| T-14 run_sql_query | 1 | 20 | tools/T14_run_sql_query.yaml |
| 가드레일 7.1 enforce_select_only | 1 | 20 | guardrails/G71_enforce_select_only.yaml |
| 가드레일 7.2 enforce_date_range | 1 | 20 | guardrails/G72_enforce_date_range.yaml |
| 가드레일 7.3 enforce_row_limit | 1 | 20 | guardrails/G73_enforce_row_limit.yaml |
| 가드레일 7.4 enforce_timeout | 1 | 20 | guardrails/G74_enforce_timeout.yaml |
| 가드레일 7.5 block_forbidden_constructs | 1 | 20 | guardrails/G75_block_forbidden_constructs.yaml |
| 가드레일 7.6 enforce_pii_control | 1 | 20 | guardrails/G76_enforce_pii_control.yaml |
| 가드레일 7.7 block_mass_scan | 1 | 20 | guardrails/G77_block_mass_scan.yaml |
| 가드레일 7.8 audit_log | 1 | 20 | guardrails/G78_audit_log.yaml |
| 가드레일 7.9 detect_risky_sql | 1 | 20 | guardrails/G79_detect_risky_sql.yaml |
| **합계** | **14** | **280** | |

### 1.3 검증 대상 스키마 (Pagila, Mock 카탈로그)

Mock 백엔드(`src/mcp-servers/nl2sql_mcp/db/mock_backend.py`)는 Pagila의 테이블 15개와 뷰 7개, 모두 22개를 카탈로그로 갖습니다. 스키마 owner는 `public`, 식별자는 소문자이며 조회는 대소문자를 구분하지 않습니다. 원본 카드 도메인 테이블과의 대응은 [nl2sql-pagila-mapping.md](revamp/nl2sql-pagila-mapping.md)에 정리했습니다.

**핵심 테이블**:
| 테이블 | 추정 행수 | 주요 컬럼 | 가드레일 활용 |
|---|---|---|---|
| customer | 599 | customer_id(PK), store_id, first_name, last_name, email, active, create_date | PII 차단(7.6) |
| address | 603 | address_id(PK), address, district, city_id, postal_code, phone | PII 차단(7.6) |
| rental | 16,044 | rental_id(PK), rental_date, inventory_id, customer_id, return_date(NULL 허용) | 날짜(7.2), 대량 거래 |
| payment | 14,596 | payment_id(PK), customer_id, staff_id, rental_id, amount, payment_date | 날짜(7.2), 대량 거래 |
| inventory | 4,581 | inventory_id(PK), film_id, store_id | 날짜 컬럼 없는 대형 테이블 |
| film | 1,000 | film_id(PK), title, rental_rate, rating, language_id | 상품 마스터 |
| category | 16 | category_id(PK), name | 소형 코드 마스터 |
| store | 2 | store_id(PK), manager_staff_id, address_id | 소형 엣지 케이스 |

**PII 컬럼** (기본값은 `pii_catalog.py`, `PII_CATALOG_RAW`로 대체 가능): `(테이블, 컬럼)` 쌍으로 판정합니다. customer 이름과 이메일, staff 이메일과 비밀번호, address 주소와 전화번호는 차단하고, staff 이름과 username, 우편번호는 마스킹(`M***`)합니다. actor 이름은 PII가 아니에요. `SELECT *` 는 PII 컬럼이 있는 테이블에서만 차단되고, 조건절(WHERE, ORDER BY)에서 PII 컬럼을 쓰는 것은 허용합니다.

**날짜 컬럼 (7.2 가드레일 적용)**: `GUARDRAIL_DATE_COLUMNS`로 테이블마다 기간 검사 대상 컬럼을 고정합니다. 기본값은 rental.rental_date, payment.payment_date이고, 여러 테이블이 있으면 FROM/JOIN 순서상 첫 대상 테이블의 컬럼에 조건을 주입합니다.

**Mock 응답 특성**: `COUNT(*)` 단독 집계, `GROUP BY` 합성 행, 샘플 행이 있는 테이블의 일반 SELECT, 그 밖의 빈 결과 순으로 분기합니다. 세부 규칙은 대응표 6장을 참고하세요.

---

## 2. 검증 환경 설정

### 2.1 필수 사전 조건 (Mock 모드)

```bash
# 1. 의존성 설치
cd <저장소 루트>
make init-dev

# 2. 환경 변수: .env 없이 실행하면 NL2SQL_DB_DIALECT=postgres, NL2SQL_DB_BACKEND=mock(기본값)으로 동작합니다.
#    가드레일 임계치를 바꾸고 싶을 때만 src/mcp-servers/nl2sql_mcp/.env.example 을
#    같은 디렉터리의 .env 로 복사해 수정합니다(저장소 루트 .env 에 적어도 됩니다).

# 3. (chat 케이스, HTTP 확인용) HTTP 서버 기동
make run-nl2sql-mcp-http
# → 로그에서 Mock 백엔드로 기동했는지 확인
```

direct 케이스는 레지스트리의 stdio 항목(`nl2sql-mcp`)으로 실행되므로 HTTP 서버를 따로 띄우지 않아도 됩니다. 케이스마다 서버 프로세스가 새로 뜹니다.

> 실 DB(PostgreSQL + Pagila) 접속 절차와 `NL2SQL_DB_BACKEND=real` 설정은 P2-4에서 추가합니다. 시나리오는 PostgreSQL 문법이므로 `NL2SQL_DB_DIALECT=oracle` 로 돌리면 결과가 달라집니다.

### 2.2 연결 확인 체크리스트

```bash
# 도구 목록 확인 (stdio)
python scripts/mcp_cli.py list-tools --server nl2sql-mcp

# 카탈로그 확인 (customer 패턴 검색)
python scripts/mcp_cli.py call \
  --server nl2sql-mcp \
  --tool search_tables_schema \
  --params '{"pattern": "CUST%"}'
# → {"tables": [{"table_name": "customer", ...}, {"table_name": "customer_list", ...}], "match_count": 2, ...} 기대

# 감사 로그 DB 확인
ls -la audit.db  # 또는 설정된 AUDIT_LOG_PATH
```

### 2.3 환경변수 확인 항목

| 환경변수 | 검증 값 | 설명 |
|---|---|---|
| NL2SQL_DB_DIALECT | postgres (기본값) | 시나리오 SQL 문법과 같아야 함 |
| NL2SQL_DB_BACKEND | mock (기본값) | Mock 백엔드로 실행 |
| PII_CATALOG_RAW | `EMAIL,FIRST_NAME,LAST_NAME,PHONE,ADDRESS,PASSWORD` (기본값) | 7.6 PII 컬럼 목록 |
| GUARDRAIL_FORBIDDEN_ENABLED | true | 7.5 가드레일 활성화 |
| GUARDRAIL_RISKY_SQL_ENABLED | true | 7.9 가드레일 활성화 |
| GUARDRAIL_MAX_LIMIT | 10000 | 최대 행 제한 |
| GUARDRAIL_DEFAULT_MONTHS | 3 | 날짜 조건 자동 주입 기간 |
| GUARDRAIL_MAX_MONTHS | 12 | 최대 조회 기간 |
| GUARDRAIL_TIMEOUT_SEC | 30 | 쿼리 타임아웃(초) |

---

## 3. YAML 케이스 포맷

모든 테스트 데이터 파일은 다음 구조를 따른다:

```yaml
meta:
  target: <도구명 or 가드레일코드>
  db_mode: real
  total: 20
  mcp_server: nl2sql-mcp
  base_url: "http://localhost:8004/mcp"

tests:
  - id: <파일접두어>-NNN
    category: positive|negative|edge|chat|block|pass|transform
    call_type: direct|chat
    title: "케이스 제목"

    # direct 케이스
    input:
      tool: <도구명>
      params: {<파라미터>}
    expected:
      status: success|error
      checks:
        - {field: "필드경로", op: "연산자", value: <기대값>}
      error_code: "에러코드"  # status=error 시
    execution:
      command: |
        python scripts/mcp_cli.py call --server nl2sql-mcp \
          --tool <도구명> --params '<JSON파라미터>'

    # chat 케이스
    chat_prompt: "자연어 프롬프트"
    expected:
      tool_called: <도구명>
      status: success|error
      human_verify: "사람이 확인할 항목"
    execution:
      method: "Frontend /chat 또는 Claude AI 자동 실행 방법"
```

**op 연산자**:
| 연산자 | 설명 | 예시 |
|---|---|---|
| `eq` | 정확히 일치 | `{field: "truncated", op: "eq", value: false}` |
| `gte` / `lte` / `gt` / `lt` | 수치 비교 | `{field: "match_count", op: "gte", value: 1}` |
| `contains_any` | 배열에 하나 이상 포함 | `{field: "tables[*].table_name", op: "contains_any", value: ["customer"]}` |
| `not_empty` | 비어있지 않음 | `{field: "tables", op: "not_empty"}` |
| `is_null` / `not_null` | null 여부 | `{field: "error_code", op: "not_null"}` |
| `matches_regex` | 정규식 매칭 | `{field: "sql_text", op: "matches_regex", value: "INTERVAL"}` |
| `contains` / `not_contains` | 배열 원소 또는 문자열 부분 포함 여부 | `{field: "error.message", op: "contains", value: "20"}` |
| `contains_all` / `contains_field` | 모두 포함 / 객체 배열에 그 이름의 항목이 있음 | `{field: "tables[0].columns", op: "contains_field", value: "store_id"}` |
| `in` / `not_in` | 값이 목록 안에 있음 | `{field: "error.code", op: "in", value: ["TABLE_NOT_FOUND", "ACCESS_DENIED"]}` |
| `exists` | 필드가 있음(`value: false` 면 없음) | `{field: "explain.estimated_cost", op: "exists", value: true}` |
| `length_eq` / `length_gte` / `length_lte` | 배열, 문자열 길이 | `{field: "columns", op: "length_eq", value: 10}` |
| `note` | 사람이 확인할 항목. 판정에서 빼고 결과에 `manual` 로 남김 | `{field: "human_verify", op: "note", value: "..."}` |

**필드 경로**: `a.b` (중첩 키), `a[0].b` (인덱스, 음수 가능), `a[*].b` (배열 투영), `a[?k=='v'].b` (조건 필터, 하나만 맞으면 그 항목), `a | length` (길이). 에러 응답은 CLI 형식 `{"error": {"code", "message"}}` 이라 `error.code`, `error.message` 로 검사합니다.

**러너 전용 키** (P2-7):
| 키 | 설명 |
|---|---|
| `env: {VAR: "값"}` | 이 케이스의 서버 프로세스에만 줄 환경 변수 (예: `GUARDRAIL_TIMEOUT_SEC: "1"`) |
| `input.repeat: N` | 같은 호출을 N 번 (판정은 마지막 응답) |
| `input.setup_calls: [{tool, params}]` | 본 호출 전에 부르는 도구 (판정 안 함) |
| `requires: {backend, reason}` | 그 백엔드에서만 실행, 다른 백엔드면 사유와 함께 SKIP |
| `expected_by_backend: {real: {...}}` | 그 백엔드에서 `expected` 대신 쓸 기대값 |
| `audit_verification: {command, expected}` | 셸 명령의 표준 출력에 `expected` 가 있어야 PASS. 감사 DB(`AUDIT_LOG_PATH`)는 케이스마다 새 임시 파일 |

---

## 4. 실행 방법

### 4.1 러너 일괄 실행

```bash
make test-scenarios                                             # 전체, Mock (약 1~2분)
make test-scenarios ARGS="--dir tools"                          # tools/ 만
uv run python scripts/run_mcp_tests.py --file 'docs/nl2sql-mcp-test-data/tools/T01_*.yaml'
uv run python scripts/run_mcp_tests.py --id G78-017 --id 'G74-01*'   # 케이스 ID (glob)
make test-scenarios-real                                        # 샘플 DB(실 Pagila)로 실행
```

결과는 `docs/nl2sql-mcp-test-data/results/` 에 저장되며 이 디렉터리는 `.gitignore` 대상입니다. 케이스는 기본 4개씩 병렬로 돌고(`--jobs`), 케이스마다 서버 프로세스와 감사 DB 가 따로라 서로 섞이지 않아요. 통과율 95% 이상이고 6.3 의 필수 케이스가 모두 PASS 면 exit 0 입니다. 최근 결과는 [revamp/nl2sql-scenario-phase2.md](revamp/nl2sql-scenario-phase2.md)에 있습니다.

### 4.2 Claude AI 자동 실행

Claude Code에서 다음과 같이 요청한다:

```
NL2SQL_DB_BACKEND=mock(기본값) 상태에서
docs/nl2sql-mcp-test-data/tools/T01_search_tables_schema.yaml 파일을 읽어
각 테스트 케이스를 실행.command 기준으로 순서대로 실행한 뒤
expected 조건과 비교하여 PASS/FAIL 결과를 표로 정리해줘.
```

**자동 실행 절차**:
1. YAML 파일 읽기 (Read 도구)
2. `meta.base_url`로 서버 접속 확인
3. 각 `direct` 케이스: `execution.command` 실행 → 결과를 `expected.checks`와 비교
4. 각 `chat` 케이스: `chat_prompt`를 Frontend /chat 또는 Claude AI에 입력 → `human_verify` 항목 체크
5. PASS/FAIL/SKIP 집계 및 리포트 출력

**전체 파일 일괄 실행 요청 예시**:
```
docs/nl2sql-mcp-test-data/ 아래 모든 YAML 파일을 순서대로 읽어
각 케이스를 실행하고 전체 결과를 요약해줘.
총 280 케이스 중 PASS/FAIL/SKIP 수와 실패 케이스 상세를 알려줘.
```

### 4.3 사람 수동 실행

**direct 케이스**:
1. YAML 파일에서 대상 케이스의 `execution.command` 복사
2. 터미널에서 실행 (서버 기동 상태 확인 필수)
3. 출력 결과를 `expected.checks` 항목과 수동 비교

```bash
# 예시: T01-001 실행
python scripts/mcp_cli.py call \
  --server nl2sql-mcp \
  --tool search_tables_schema \
  --params '{"pattern": "CUST%", "limit": 20}'
```

**chat 케이스**:
1. Frontend 기동: `make frontend-dev` (포트 3000)
2. `/chat` 페이지 접속 → 서버 선택: `nl2sql-mcp-http`
3. `chat_prompt` 내용 입력
4. AI 응답에서 `human_verify` 항목 확인

**G78 audit_log 케이스**:
```bash
# 도구 호출 후 audit.db 직접 조회
python -c "
import sqlite3
conn = sqlite3.connect('audit.db')  # 또는 AUDIT_LOG_PATH
cur = conn.cursor()
cur.execute('SELECT * FROM audit_log ORDER BY call_time DESC LIMIT 10')
for row in cur.fetchall():
    print(row)
conn.close()
"
```

---

## 5. 검증 항목 상세

### 5.1 도구 검증 (T-01~T-04, T-14)

#### T-01 search_tables_schema
- **목적**: 이름 패턴으로 테이블 검색 + 스키마 반환
- **적용 가드레일**: 7.8(audit), 7.9(whitelist), 7.6(PII 컬럼 통제)
- **에러 코드**: TOO_MANY_TABLES, ACCESS_DENIED
- **케이스 파일**: `docs/nl2sql-mcp-test-data/tools/T01_search_tables_schema.yaml`
- **케이스 분포**: positive 6 / negative 5 / edge 6 / chat 3

#### T-02 search_columns
- **목적**: 컬럼명으로 해당 컬럼을 가진 테이블 역탐색
- **적용 가드레일**: 7.8(audit), 7.9(whitelist), 7.6(PII 컬럼 통제)
- **에러 코드**: TOO_MANY_COLUMNS, ACCESS_DENIED
- **케이스 파일**: `docs/nl2sql-mcp-test-data/tools/T02_search_columns.yaml`
- **케이스 분포**: positive 6 / negative 5 / edge 6 / chat 3

#### T-03 get_table_schema
- **목적**: 단일 테이블 상세 스키마(컬럼, 타입, 관계) 조회
- **적용 가드레일**: 7.8(audit), 7.9(whitelist), 7.6(PII 컬럼 통제)
- **에러 코드**: TABLE_NOT_FOUND, ACCESS_DENIED
- **케이스 파일**: `docs/nl2sql-mcp-test-data/tools/T03_get_table_schema.yaml`
- **케이스 분포**: positive 6 / negative 4 / edge 7 / chat 3

#### T-04 get_tables_schema
- **목적**: 복수 테이블 스키마 일괄 조회 (최대 20개)
- **적용 가드레일**: 7.8(audit), 7.9(whitelist)
- **에러 코드**: INVALID_INPUT (20개 초과 or 빈 목록)
- **케이스 파일**: `docs/nl2sql-mcp-test-data/tools/T04_get_tables_schema.yaml`
- **케이스 분포**: positive 6 / negative 4 / edge 7 / chat 3

#### T-14 run_sql_query
- **목적**: SELECT 전용 쿼리 실행 + 전체 가드레일 파이프라인 적용
- **가드레일 순서**: 7.1→7.5→7.9→7.6(입력)→7.7→7.2→7.3→7.4→7.6(출력)→7.8
- **에러 코드**: WRITE_BLOCKED, FORBIDDEN_SQL_BLOCKED, RISKY_SQL_BLOCKED, PII_COLUMN_BLOCKED, MASS_SCAN_BLOCKED, DATE_RANGE_EXCEEDED, QUERY_TIMEOUT
- **케이스 파일**: `docs/nl2sql-mcp-test-data/tools/T14_run_sql_query.yaml`
- **케이스 분포**: positive 6 / negative 6 / edge 5 / chat 3

### 5.2 가드레일 검증 (7.1~7.9)

| 가드레일 | 타입 | 에러 코드 | 케이스 파일 |
|---|---|---|---|
| 7.1 enforce_select_only | 차단형 | WRITE_BLOCKED | G71_enforce_select_only.yaml |
| 7.2 enforce_date_range | 변환형 | DATE_RANGE_EXCEEDED | G72_enforce_date_range.yaml |
| 7.3 enforce_row_limit | 변환형 | (없음, 자동 주입) | G73_enforce_row_limit.yaml |
| 7.4 enforce_timeout | 래퍼형 | QUERY_TIMEOUT | G74_enforce_timeout.yaml |
| 7.5 block_forbidden_constructs | 차단형(optional) | FORBIDDEN_SQL_BLOCKED | G75_block_forbidden_constructs.yaml |
| 7.6 enforce_pii_control | 차단+변환형 | PII_COLUMN_BLOCKED | G76_enforce_pii_control.yaml |
| 7.7 block_mass_scan | 차단형 | MASS_SCAN_BLOCKED | G77_block_mass_scan.yaml |
| 7.8 audit_log | 로깅형 | (없음) | G78_audit_log.yaml |
| 7.9 detect_risky_sql | 차단형(optional) | RISKY_SQL_BLOCKED | G79_detect_risky_sql.yaml |

---

## 6. 합격/불합격 기준

### 6.1 케이스 단위 기준

| 판정 | 조건 |
|---|---|
| **PASS** | `expected.status`와 실제 응답 status 일치 AND 모든 `expected.checks` 통과 |
| **FAIL** | status 불일치 OR `expected.checks` 중 하나라도 실패 |
| **ERROR** | MCP 서버 접속 불가, 네트워크 오류, 예외 발생 |
| **SKIP** | 환경 조건 미충족 (timeout 케이스에서 서버 설정 변경 불가 등) |

**error 케이스 판정**: `expected.error_code`가 실제 응답의 에러 코드와 일치해야 PASS

### 6.2 전체 합격 기준

| 기준 | 값 |
|---|---|
| 최소 PASS 수 | 280케이스 중 **266개 이상** (≥ 95%) |
| 필수 PASS 항목 | 7.1 WRITE_BLOCKED, 7.6 PII_COLUMN_BLOCKED, 7.7 MASS_SCAN_BLOCKED는 100% 필수 |
| 허용 FAIL 범위 | optional 가드레일(7.5, 7.9) + 환경 의존 케이스(7.4 timeout) |

### 6.3 주요 필수 케이스

다음 케이스들은 **반드시 PASS**해야 한다:

| 케이스 ID | 내용 | 이유 |
|---|---|---|
| G71-001~008 | DML/DDL 전 유형 차단 | 보안 핵심 가드레일 |
| G76-001~005 | PII 컬럼 직접 SELECT 차단 | GLBA/PCI DSS 준수 |
| G77-001~008 | 풀스캔, 카티시안 차단 | DB 보호 핵심 |
| T14-007~012 | T-14 통합 가드레일 동작 | E2E 파이프라인 검증 |

---

## 7. 검증 리포트 형식

Claude AI 자동 실행 시 다음 형식으로 리포트 출력을 요청한다:

```
# NL2SQL MCP 검증 결과 리포트
실행 일시: YYYY-MM-DD HH:MM:SS
환경: NL2SQL_DB_DIALECT=postgres, NL2SQL_DB_BACKEND=mock (Pagila Mock), nl2sql-mcp (stdio)

## 요약
| 항목 | 전체 | PASS | FAIL | ERROR | SKIP |
|---|---|---|---|---|---|
| T-01 search_tables_schema | 20 | ? | ? | ? | ? |
| T-02 search_columns | 20 | ? | ? | ? | ? |
| ... | ... | | | | |
| **합계** | 280 | ? | ? | ? | ? |

합격 여부: PASS (FAIL=? 건, 95% 기준 충족)

## FAIL 케이스 상세
| 케이스 ID | 제목 | 기대 | 실제 | 비고 |
|---|---|---|---|---|
| T01-NNN | ... | ... | ... | ... |

## 특이사항
- ...
```

---

## 8. 참조

| 문서 | 경로 |
|---|---|
| 요구사항 정의서 | docs/mcp-spec/nl2sql-mcp_v0.1.md |
| 구현 계획서 | docs/history/nl2sql-mcp-plan.md |
| 에러 코드 정의 | src/mcp-servers/_common/errors.py |
| CLI 실행 도구 | scripts/mcp_cli.py |
| 서버 구현 | src/mcp-servers/nl2sql_mcp/ |
| 기존 단위 테스트 | tests/nl2sql_mcp/ |
| Pagila 대응표 | docs/revamp/nl2sql-pagila-mapping.md |
| Mock 기준선 (Pagila 교체 전) | docs/revamp/nl2sql-scenario-baseline.md |
