# Sales DW MCP 서버 요구사항 정의서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Sales DW MCP 서버 요구사항 정의서 |
| 버전 | v0.1 |
| 작성자 | (테스트 fixture) |
| 작성일 | 2026-05-19 |
| 서버명 | sales-dw-mcp |

---

## 1. 개요

### 1.1 서버명 / 한 줄 소개

- **서버명**: `sales-dw-mcp`
- **한 줄 소개**: 내부 판매 데이터웨어하우스의 데이터셋 조회를 Agent에게 노출하는 MCP 서버

### 1.2 목적 및 배경

- **목적**: Agent가 내부 Sales DW의 데이터셋 메타정보와 샘플 행을 자동 조회
- **배경**: 판매 분석 Agent가 매번 사용자에게 데이터셋 ID를 물어보는 비효율 제거
- **기대 효과**: 분석 의도 자연어 → 적합한 데이터셋 자동 매칭

---

## 2. 범위

### 2.1 포함 범위 (In-Scope)

- 데이터셋 메타 조회 (list, describe)
- 행 샘플 조회 (sample_rows)

### 2.2 제외 범위 (Out-of-Scope)

- SQL 직접 실행 (run_query): Phase 2
- 데이터 변경 작업: 제외

---

## 3. 사용자 및 주요 시나리오

### 3.1 사용 Agent

- **호출 주체**: 판매 분석 Agent
- **호출 빈도**: 1일 약 200회
- **동시 세션**: 최대 5

### 3.2 주요 사용 시나리오

| ID | 시나리오 | 사용 Tool |
|---|---|---|
| UC-01 | "월별 매출 데이터" 자연어로 적절한 데이터셋 검색 | `list_datasets` |
| UC-02 | 특정 데이터셋의 컬럼/타입 확인 | `describe_dataset` |
| UC-03 | 데이터셋 샘플 10행 확인 | `sample_rows` |

---

## 4. 시스템 구성

### 4.1 MCP 서버

| 항목 | 내용 |
|---|---|
| Transport | stdio |
| 배포 환경 | 로컬 Agent 프로세스 |
| 엔드포인트 | (stdio라 N/A) |
| MCP SDK | Python `fastmcp` v1.0+ |
| 사용 프리미티브 | Tools |

### 4.2 연동 백엔드 시스템

| 항목 | 내용 |
|---|---|
| 시스템명 | Sales DW Catalog API |
| 종류 | REST API |
| 엔드포인트 | `https://sales-dw-catalog.example.internal/v1` |
| 프로토콜 | HTTP/JSON |
| 인증 방식 | Bearer Token |
| 권한 모델 | Read-only 계정 |
| 네트워크 | 내부망 |

---

## 5. 기능 요구사항 (Tools)

### 5.1 Tool 목록 (요약)

| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `list_datasets` | 데이터셋 목록 조회 | true | false | true |
| T-02 | `describe_dataset` | 데이터셋 스키마/메타 조회 | true | false | true |
| T-03 | `sample_rows` | 데이터셋 샘플 행 조회 | true | false | true |

### 5.2 Tool 상세 명세

#### ▶ T-01 `list_datasets`

- **설명**: 접근 가능한 데이터셋 목록 조회

- **LLM Description**
  ```
  Sales DW에 등록된 데이터셋 목록을 조회한다.
  Agent가 어떤 데이터셋이 있는지 모르거나 자연어 키워드로 후보를 좁힐 때 사용.
  특정 데이터셋의 컬럼 정보가 필요하면 describe_dataset을 추가 호출할 것.
  결과가 많을 수 있으므로 keyword로 좁혀 호출 권장.
  호출 예: "월별 매출 데이터" → list_datasets(keyword="monthly_sales")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `keyword` | string | N | 데이터셋명, 설명 부분 일치 필터 |
  | `limit` | int | N | 반환 최대 개수. 기본 20, 최대 100 |

- **출력 예시 (정상)**
  ```json
  {
    "datasets": [
      {
        "id": "ds_001",
        "name": "monthly_sales_summary",
        "description": "월별 주문 매출 집계",
        "row_count_approx": 1245000,
        "last_updated": "2026-05-18T03:00:00Z"
      }
    ],
    "total_count": 47
  }
  ```

- **빈 결과**: `datasets: [], total_count: 0`

- **응답 크기 제어**: limit 최대 100

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `ACCESS_DENIED` | "데이터셋 목록 조회 권한이 없습니다." |
  | `BACKEND_UNAVAILABLE` | "Sales DW Catalog API에 연결할 수 없습니다. 잠시 후 다시 시도하세요." |

---

#### ▶ T-02 `describe_dataset`

- **설명**: 데이터셋의 컬럼/타입/통계 조회

- **LLM Description**
  ```
  특정 데이터셋의 스키마(컬럼명/타입/설명)와 기본 통계를 조회한다.
  데이터셋 ID를 알고 있을 때 상세 정보 확인용. 샘플 데이터가 필요하면 sample_rows를 추가 호출.
  데이터셋 ID를 모르면 list_datasets로 먼저 검색.
  호출 예: "ds_001 컬럼 정보" → describe_dataset(dataset_id="ds_001")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `dataset_id` | string | Y | 데이터셋 ID (list_datasets로 조회 가능) |

- **출력 예시 (정상)**
  ```json
  {
    "id": "ds_001",
    "name": "monthly_sales_summary",
    "columns": [
      {"name": "year_month", "type": "STRING", "description": "YYYYMM 형식"},
      {"name": "total_amount", "type": "DECIMAL", "description": "월 매출 합계 (원)"},
      {"name": "order_count", "type": "INTEGER", "description": "월 주문 건수"}
    ],
    "row_count_approx": 1245000,
    "last_updated": "2026-05-18T03:00:00Z"
  }
  ```

- **빈 결과**: 해당 없음 (id가 유효하면 항상 응답)

- **응답 크기 제어**: 단일 응답 1MB 이하

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `DATASET_NOT_FOUND` | "데이터셋 'ds_001'을 찾을 수 없습니다. list_datasets로 ID를 확인하세요." |
  | `ACCESS_DENIED` | "해당 데이터셋 조회 권한이 없습니다." |

---

#### ▶ T-03 `sample_rows`

- **설명**: 데이터셋 샘플 행 조회 (최대 100행)

- **LLM Description**
  ```
  특정 데이터셋에서 샘플 행을 조회한다.
  실제 값을 보고 형식을 확인하거나 분석 방향을 정할 때 사용.
  전체 조회가 아닌 표본이므로 통계 분석 용도로는 부적합.
  컬럼 정보만 필요하면 describe_dataset을 사용할 것.
  호출 예: "ds_001 10행 샘플" → sample_rows(dataset_id="ds_001", limit=10)
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `dataset_id` | string | Y | 데이터셋 ID |
  | `limit` | int | N | 반환 행 수. 기본 10, 최대 100 |

- **출력 예시 (정상)**
  ```json
  {
    "dataset_id": "ds_001",
    "rows": [
      {"year_month": "202604", "total_amount": 5230000000, "order_count": 1234567},
      {"year_month": "202603", "total_amount": 4980000000, "order_count": 1221345}
    ],
    "row_count": 2,
    "truncated": false
  }
  ```

- **빈 결과**: `rows: [], row_count: 0` (데이터셋이 비어있는 경우)

- **응답 크기 제어**: limit 최대 100, 응답 1MB 이하

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `DATASET_NOT_FOUND` | "데이터셋 'ds_001'을 찾을 수 없습니다." |
  | `INVALID_INPUT` | "limit는 1~100 범위여야 합니다." |
  | `ACCESS_DENIED` | "해당 데이터셋 조회 권한이 없습니다." |

---

## 6. 비기능 요구사항

### 6.1 성능 / 응답 크기

- 단일 호출 P95 < 2초
- 단일 응답 ≤ 1MB

### 6.2 보안

- MCP 인증: `X-MCP-API-Key`
- 백엔드 자격증명: 환경변수 `SALES_DW_MCP_BACKEND_API_KEY`
- 민감정보 마스킹: 결제 카드번호, 계좌번호 패턴 자동 마스킹

### 6.3 로깅

- 호출 시각, Agent ID, Tool명, 파라미터 해시, 응답 시간, 결과 코드
- 보존 90일

---

## 7. 에러 처리

- 백엔드 호출 timeout 5초
- 1회 재시도 (1s exponential backoff)

---

## 8. 산출물

- [ ] 소스 저장소 URL
- [ ] Tool 명세서
- [ ] 설치/실행 가이드
- [ ] LLM Tool-calling 평가셋 10건 이상

---

## 9. 일정

| 단계 | 기한 |
|---|---|
| 요구사항 확정 | 2026-05-30 |
| 개발 완료 | 2026-06-15 |

---

## 10. 인수 기준

- [ ] 5장 모든 Tool 정상 동작
- [ ] 평가셋 통과율 ≥ 90%
