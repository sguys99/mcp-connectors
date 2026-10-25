# Meta MCP 서버 요구사항 정의서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Meta MCP 서버 요구사항 정의서 |
| 버전 | v0.1 |
| 작성일 | 2026-05-19 |
| 서버명 | partial-meta-mcp |

---

## 1. 개요

### 1.1 서버명 / 한 줄 소개

- **서버명**: `partial-meta-mcp`
- **한 줄 소개**: 내부 메타정보 카탈로그 조회 MCP 서버 (정보 부족 fixture)

### 1.2 목적 및 배경

- **목적**: 카탈로그 엔티티(테이블, 컬럼, 지표) 검색 Agent 연동
- **배경**: 데이터 거버넌스 팀의 내부 메타 카탈로그 활용

---

## 2. 범위

### 2.1 포함 범위 (In-Scope)

- 엔티티 검색
- 엔티티 상세 조회

### 2.2 제외 범위 (Out-of-Scope)

- 메타정보 등록/수정

---

## 3. 사용자 및 주요 시나리오

### 3.1 사용 Agent

- **호출 주체**: 데이터 디스커버리 Agent
- **호출 빈도**: 1일 약 50회

### 3.2 주요 사용 시나리오

| ID | 시나리오 | 사용 Tool |
|---|---|---|
| UC-01 | 키워드로 엔티티 검색 | `search_entity` |
| UC-02 | 엔티티 ID로 상세 조회 | `get_entity` |

---

## 4. 시스템 구성

### 4.1 MCP 서버

| 항목 | 내용 |
|---|---|
| Transport | **확인 필요** |
| 배포 환경 | **확인 필요** |
| MCP SDK | Python `fastmcp` |
| 사용 프리미티브 | Tools |

### 4.2 연동 백엔드 시스템

| 항목 | 내용 |
|---|---|
| 시스템명 | 내부 Meta Catalog |
| 종류 | **확인 필요 (데이터 거버넌스팀 회신 대기)** |
| 엔드포인트 | **확인 필요** |
| 프로토콜 | **확인 필요**, 후보: REST API, GraphQL, gRPC |
| 인증 방식 | **확인 필요** |
| 권한 모델 | Read-only |
| 네트워크 | 내부망 |

> ⚠ 인터페이스 확정 후 v1.0에서 갱신.

---

## 5. 기능 요구사항 (Tools)

### 5.1 Tool 목록 (요약)

| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `search_entity` | 키워드로 엔티티 검색 | true | false | true |
| T-02 | `get_entity` | 엔티티 ID로 상세 조회 | true | false | true |

### 5.2 Tool 상세 명세

#### ▶ T-01 `search_entity`

- **설명**: 키워드로 메타 엔티티 검색

- **LLM Description**
  ```
  메타 카탈로그에서 엔티티(테이블/컬럼/지표)를 키워드로 검색한다.
  엔티티 ID를 모를 때 자연어 키워드로 후보를 찾는 용도.
  ID를 안다면 get_entity로 직접 조회할 것.
  호출 예: "고객 등급 관련 컬럼 찾기" → search_entity(keyword="customer_grade")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `keyword` | string | Y | 검색 키워드 |
  | `entity_type` | string | N | 'table' / 'column' / 'metric' 필터 |
  | `limit` | int | N | 반환 최대 개수. 기본 20, 최대 100 |

- **출력 예시 (정상)**
  ```json
  {
    "entities": [
      {
        "id": "tbl_cust_001",
        "type": "table",
        "name": "customer_grade_history",
        "description": "고객 등급 변경 이력"
      }
    ],
    "total_count": 3
  }
  ```

- **빈 결과**: `entities: [], total_count: 0`

- **응답 크기 제어**: limit 최대 100

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "keyword는 1자 이상이어야 합니다." |
  | `ACCESS_DENIED` | "검색 권한이 없습니다." |

---

#### ▶ T-02 `get_entity`

- **설명**: 엔티티 ID로 상세 정보 조회

- **LLM Description**
  ```
  특정 엔티티의 상세 정보(설명, 소유자, 관련 엔티티)를 조회한다.
  엔티티 ID를 알고 있을 때 사용. ID를 모르면 search_entity 먼저.
  호출 예: "tbl_cust_001 정보" → get_entity(entity_id="tbl_cust_001")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `entity_id` | string | Y | 엔티티 ID |

- **출력 예시 (정상)**
  ```json
  {
    "id": "tbl_cust_001",
    "type": "table",
    "name": "customer_grade_history",
    "description": "고객 등급 변경 이력",
    "owner": "anon_a83f",
    "related_entities": ["tbl_cust_002", "metric_cust_010"]
  }
  ```

- **빈 결과**: 해당 없음 (id 유효하면 항상 반환)

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `ENTITY_NOT_FOUND` | "엔티티 'tbl_cust_001'을 찾을 수 없습니다." |
  | `ACCESS_DENIED` | "엔티티 조회 권한이 없습니다." |

---

## 6. 비기능 요구사항

### 6.1 성능 / 응답 크기

- 단일 호출 P95 < 2초
- 단일 응답 ≤ 1MB

### 6.2 보안

- MCP 인증: **확인 필요**
- 백엔드 자격증명: **확인 필요**
- 민감정보 마스킹: 기본 적용

### 6.3 로깅

- 호출 시각, Tool명, 파라미터 해시, 결과 코드

---

## 7. 에러 처리

- timeout 5초
- 1회 재시도

---

## 8. 산출물

- [ ] Tool 명세서
- [ ] 실행 가이드

---

## 9. 일정

| 단계 | 기한 |
|---|---|
| 요구사항 확정 | 2026-06-15 |

---

## 10. 인수 기준

- [ ] 5장 Tool 정상 동작
