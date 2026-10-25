# NL2SQL 시나리오 테스트 결과 (Phase 2, P2-7 러너 보강 후)

> 작업 계획서 [update-plan.md](../update-plan.md) Phase 2의 **P2-7 러너와 테스트 보강** 산출물입니다. 이전 기록은 [nl2sql-scenario-baseline.md](nl2sql-scenario-baseline.md)(0-6), [nl2sql-scenario-pagila.md](nl2sql-scenario-pagila.md)(1-C)에 있습니다.

## 요약

| 항목 | 값 |
|---|---|
| 실행일 | 2026-10-22 |
| 실행 경로 | `make test-scenarios` (stdio, 케이스마다 서버 프로세스와 감사 DB를 새로 만듦, 기본 4병렬) |
| 케이스 | 280건 (Mock 실행 263, SKIP 17 / 실 DB 실행 260, SKIP 20) |
| P2-6 종료 시점 공식 결과 | PASS 131, FAIL 132, 통과율 **49.8%**, 필수 케이스 공식 PASS 0/27 |
| 러너만 고친 직후 | PASS 244, FAIL 19, 통과율 **92.8%**, 필수 27/27 |
| 최종 (Mock) | PASS 263, FAIL 0, ERROR 0, 통과율 **100%**, 필수 **27/27** |
| 최종 (실 Pagila, `--backend real`) | PASS 260, FAIL 0, ERROR 0, SKIP 20, 통과율 **100%**, 필수 **27/27** |
| 수동 확인 항목 | 4건 (T14-014~017의 `op: note`, 판정에서 빼고 결과에 `manual`로 남김) |

"필수 PASS 25건"은 계획서의 표현이고, 실제 ID는 G71-001~008, G76-001~005, G77-001~008, T14-007~012의 27건입니다. 러너는 이 27건을 `MANDATORY_IDS`로 들고 있어서, 통과율이 95% 이상이어도 하나라도 실패하면 exit 1로 끝납니다.

이제 "공식"과 "보정" 통과율을 따로 셀 필요가 없습니다. 러너가 CLI 에러 형식을 직접 인식하므로 러너 숫자가 곧 공식 숫자예요.

## 러너 변경 (`scripts/run_mcp_tests.py`)

- **에러 인식**: `_is_error()`가 CLI의 `{"error": {"code", "message"}}` 응답을 에러로 봅니다(기존 `isError` 형식도 유지). 0-6에서 정상 차단 68건이 FAIL로 집계되던 원인입니다.
- **에러 코드**: 하드코딩 정규식(`RISKY_SQL_BLOCKED` 중복, `INVALID_SQL` 누락)을 지우고, 서버의 새 정본 [`nl2sql_mcp/error_codes.py`](../../src/mcp-servers/nl2sql_mcp/error_codes.py)의 `ERROR_CODES`를 import합니다. 구조화된 `error.code`를 먼저 보고, 없을 때만 메시지의 마지막 `[CODE]` 태그를 씁니다. YAML이 모르는 코드를 기대하면 ERROR로 알려요.
- **에러 케이스의 checks**: 예전에는 에러 코드만 맞으면 PASS였고 `error.message` 같은 checks를 보지 않았습니다. 이제 에러 케이스도 checks를 모두 평가합니다(더 엄격해짐).
- **연산자**: `length_eq`, `length_gte`, `length_lte`, `exists`, `contains`, `not_contains`, `contains_field`, `in`, `not_in`, `ne`를 더했습니다. 모르는 연산자는 FAIL이 아니라 ERROR입니다. `note`는 사람이 볼 항목이라 판정에서 뺍니다.
- **경로**: `a.b`, `a[0]`(음수 포함), `a[*].b`, `a[?k=='v'].b`, `a | length`를 지원합니다. 없는 경로는 `None`과 구분되는 `MISSING`이라 `exists`와 `is_null`이 정확해졌어요.
- **케이스 키**: `env`(서버 환경 변수), `input.repeat`, `input.setup_calls`, `requires: {backend, reason}`, `expected_by_backend`를 읽습니다. 형식은 [테스트 계획서 §3](../nl2sql-mcp-test-plan.md)에 적었습니다.
- **감사 검증 실행**: `audit_verification.command`를 실제로 돌리고 출력에 `expected`가 있는지 봅니다. 감사 DB는 케이스마다 새 임시 파일(`AUDIT_LOG_PATH`)이라 "가장 최근 기록"을 읽는 검증이 다른 케이스와 섞이지 않고, 저장소의 `var/` 감사 DB도 건드리지 않습니다.
- **기타**: `--backend mock|real`(OS 환경과 `.env`보다 우선), `--id`(glob), `--jobs`, `--no-save`, 필수 케이스 집계와 결과 JSON의 `backend`, `mandatory_*`, `manual_checks` 필드를 더했습니다.

## 실패 분류 (P2-6 종료 시점 132건)

| 분류 | 건수 | 내용 | 처리 |
|---|---|---|---|
| 러너 버그: 에러 형식 미인식 | 84 | 정상 차단이 "에러 기대했으나 성공 응답"으로 집계. 이 중 4건(T01-007/008, T02-007/017)은 러너를 고친 뒤 낡은 기대값으로 다시 FAIL | 러너 수정 |
| 러너 버그: 미지원 연산자와 경로 | 35 | `length_eq`, `tables \| length`, `columns[0]`, 필터 경로, `exists`, `not_contains`, `note` (T03 13건, T04 12건 등) | 러너 수정 |
| 러너 기능 부족: 서버 환경 변수 | 9 | 가드레일 끄기 6건(G75-014/015, G77-017/018, G79-014/015), 타임아웃 3건(G74-013/014, G78-017) | `env` 키 추가 |
| 낡은 기대값 | 4 | 정의서에 없는 응답 필드 3건(G78-003/004/020), P2-4 이후 카탈로그 수 변화 1건(T01-014) | YAML 수정 (아래 표) |
| 서버 버그 (Mock) | 0 | | |

러너를 고친 직후 남은 19건은 환경 변수 9건, 낡은 기대값 8건(위 4건과 에러 형식 줄의 4건), 그리고 감사 검증을 실제로 돌리면서 새로 드러난 2건(G78-014 10회 호출, G78-019 도구 5종 호출)입니다. 뒤의 2건은 `input.repeat`, `input.setup_calls`로 `execution.command`와 같은 동작을 재현해 해결했어요. Mock에서는 서버 버그가 하나도 남지 않았습니다.

## 실 DB에서 찾은 서버 버그

Mock으로 100%가 된 뒤 샘플 DB(`make sample-db-up`)로 돌린 첫 결과는 97.3%(256/263)였습니다. 실패 7건 중 3건은 서버 버그였고 고쳤습니다.

| 케이스 | 증상 | 수정 |
|---|---|---|
| T03-009 | `get_table_schema("pg_catalog.pg_class")`가 시스템 카탈로그 스키마를 돌려줌. 스키마를 직접 적으면 시스템 스키마 제외 조건이 빠짐 | Postgres `table_meta_with_owner`에 시스템 스키마, `pg_temp` 제외 추가. Oracle `table_meta`, `table_meta_with_owner`에도 시스템 owner 제외 추가 |
| T04-013 | 같은 테이블을 두 번 넣으면 실 DB만 2건을 돌려줌(Mock은 중복 제거) | 중복 제거를 백엔드에서 도구(`get_tables_schema`)로 옮김. 대소문자, 스키마 한정자만 다른 이름(`customer`, `public.customer`)도 한 번만 반환 |
| G75-014 | DB가 거부한 SQL(없는 함수 `dblink`)이 `[CODE]` 태그 없이 나가 CLI와 감사 로그에 `TOOL_ERROR`로 남음 | psycopg `ProgrammingError`, `DataError`를 `[INVALID_SQL]`로 바꿈. DB 메시지는 그대로 담아 LLM이 SQL을 고칠 수 있어요 (정의서 §5 "모든 에러는 `[CODE]`로 끝남") |

나머지 4건은 환경 차이라서 YAML에 백엔드별 기대값을 적었습니다.

- G74-013, G74-014, G78-017: 타임아웃을 Mock 지연(`NL2SQL_MOCK_DELAY_SEC=2`)으로 재현하는 케이스입니다. 실 Pagila는 1초 안에 끝나고 `GUARDRAIL_TIMEOUT_SEC`는 1초 미만을 줄 수 없어 `requires: {backend: mock}`로 실 DB에서는 SKIP합니다. DB 쪽 `statement_timeout`은 통합 테스트(`test_connector_statement_timeout`)가 따로 확인해요.
- G75-014(가드레일을 꺼도 샘플 DB에 dblink가 없어 `INVALID_SQL`), G79-015(가드레일을 꺼도 읽기 전용 계정에 `pg_read_file` 권한이 없어 `ACCESS_DENIED`): `expected_by_backend.real`로 실 DB의 두 번째 방어선을 검증합니다.

## YAML 변경 목록 (52케이스, 메타 1곳)

| 케이스 | 변경 | 이유 |
|---|---|---|
| G75-014, G75-015, G79-014, G79-015 | `env` 추가 (`GUARDRAIL_FORBIDDEN_ENABLED`, `GUARDRAIL_RISKY_SQL_ENABLED` = false) | 설명에만 있던 서버 설정을 러너가 넘기도록 |
| G77-017, G77-018 | `env` 추가, 변수 이름을 `GUARDRAIL_MASS_SCAN_REQUIRE_WHERE` → `GUARDRAIL_REQUIRE_WHERE`, `..._BLOCK_TAUTOLOGY` → `GUARDRAIL_BLOCK_TAUTOLOGY` | 낡은 이름. 정의서 7.7 구현 현황과 `.env.example`의 이름이 정본 |
| G74-013, G74-014, G78-017 | `env` 추가 (`GUARDRAIL_TIMEOUT_SEC=1`, `NL2SQL_MOCK_DELAY_SEC=2`), `requires: {backend: mock}` | P2-5에서 만든 Mock 지연으로 타임아웃을 재현 |
| G75-014, G79-015 | `expected_by_backend.real` 추가 | 위 절 참고 |
| G78-003, G78-020 | `column_count` → `columns \| length` | T-03 응답(정의서 §5.2)에 `column_count`가 없음 |
| G78-004 | `table_count` → `tables \| length` | T-04 응답에 `table_count`가 없음 |
| G78-014 | `input.repeat: 10` | `execution.command`의 10회 호출을 러너가 재현 |
| G78-019 | `input.setup_calls` (도구 4종) | `execution.command`의 도구 5종 호출을 러너가 재현 |
| T01-007, T01-008 | `error.match_count >= 23` → `error.message`에 `(23개)` | 에러 응답은 `code`, `message`만 있음(정의서 §5 에러 응답). 개수는 메시지로 확인 |
| T02-007 | `error.match_count == 131` → `error.message`에 `(131개)` | 같은 이유 |
| T02-017 | `error.match_count >= 2` → `error.message`가 `(2개 이상)` 정규식과 일치 | 같은 이유 |
| T01-014 | `%A%` 매칭 13 → 14 | P2-4에서 구체화 뷰 `rental_by_category`가 카탈로그에 추가됨(22개에서 23개). 실 DB도 14 |
| 날짜 31케이스 (G72 3, G73 4, G74 10, G75 4, G76 3, G77 3, G79 4) | 하한만 있는 `x_date >= DATE '2026-01-01'`(또는 `'2026-03-01'`, `'2026-04-01'`)를 `CURRENT_DATE - INTERVAL '6 months'`(뒤의 둘은 `'3 months'`)로 | 하한만 있는 조건은 오늘까지의 기간으로 검사하므로(P2-6) 2027년 1월부터 `DATE_RANGE_EXCEEDED`로 바뀌어 썩음. 의도("12개월 안의 최근 기간")는 그대로 |
| G72-018 | `TO_DATE('2026-01-01', ...)` 하한만 → `TO_DATE('2026-01-01') ~ TO_DATE('2026-07-01')` 범위 | `TO_DATE` 형식을 검증하는 케이스라 상대식 대신 양쪽 경계를 줌 |
| G72-007, G72-020, G72 메타 | 설명의 "기준일 2026-06-18" 표현 정리 | 실행일 기준으로 계산함을 명시 |

양쪽 경계가 모두 있는 날짜 범위(예: `>= DATE '2025-01-01' AND < DATE '2026-01-01'`)는 실행일과 무관하므로 그대로 두었습니다. 서버 버그를 가리려고 기대값을 약하게 바꾼 케이스는 없어요.

## 남은 SKIP

| 케이스 | 건수 | 사유 |
|---|---|---|
| T01-018~020, T02-018~020, T03-018~020, T04-018~020, T14-019~020, G76-019~020, G77-020 | 17 | `call_type: chat`. LLM이 도구를 고르는지 보는 케이스라 Frontend `/chat`에서 수동 실행 |
| G74-013, G74-014, G78-017 | 3 (실 DB만) | Mock 지연 전용. 실 DB 타임아웃은 통합 테스트가 확인 |

수동 확인 항목 4건(T14-014~017)은 자동 checks가 모두 통과한 상태에서 "주입된 LIMIT, 기간 조건을 눈으로 확인"하라는 메모입니다. 응답에 실행된 SQL이 없어서 자동화하지 않았습니다.

## 재현 방법

```bash
make test-scenarios                         # Mock, 약 1~2분
make test-scenarios-real                    # 샘플 DB를 띄우고 실 Pagila로 실행
uv run python scripts/run_mcp_tests.py --id 'G78-*' --no-save
docker compose --profile sample-db down -v  # 샘플 DB 정리
```

가드레일을 꺼서 러너가 실패를 잡는지도 확인했습니다. `GUARDRAIL_RISKY_SQL_ENABLED=false`로 G79를 돌리면 차단 케이스 9건이 FAIL(55.0%)로 나와요.
