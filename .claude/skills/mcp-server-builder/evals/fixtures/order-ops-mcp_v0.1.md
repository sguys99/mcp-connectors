# Order Ops MCP 서버 요구사항 정의서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 문서명 | Order Ops MCP 서버 요구사항 정의서 |
| 버전 | v0.1 |
| 작성일 | 2026-05-19 |
| 서버명 | order-ops-mcp |

---

## 1. 개요

### 1.1 서버명 / 한 줄 소개

- **서버명**: `order-ops-mcp`
- **한 줄 소개**: 주문 운영 시스템(Oracle 직결 + 운영 REST API) 통합 MCP 서버

### 1.2 목적 및 배경

- **목적**: Agent가 주문 접수/배송 메타 정보를 Oracle에서 직접 조회하고, 운영 알람을 REST API로 조회
- **배경**: 주문 운영 분석 Agent의 멀티소스 컨텍스트 자동 수집

---

## 2. 범위

### 2.1 포함 범위 (In-Scope)

- Oracle: 주문 메타 조회
- 운영 REST API: 시스템 알람 조회

### 2.2 제외 범위 (Out-of-Scope)

- 데이터 수정, 알람 생성/해제

---

## 3. 사용자 및 주요 시나리오

### 3.1 사용 Agent

- **호출 주체**: 주문 운영 분석 Agent
- **호출 빈도**: 1일 약 100회

### 3.2 주요 사용 시나리오

| ID | 시나리오 | 사용 Tool |
|---|---|---|
| UC-01 | 주문 ID로 주문 정보 조회 | `get_order_meta` |
| UC-02 | 최근 24시간 운영 알람 조회 | `list_recent_alerts` |

---

## 4. 시스템 구성

### 4.1 MCP 서버

| 항목 | 내용 |
|---|---|
| Transport | Streamable HTTP |
| 배포 환경 | 내부 K8s |
| MCP SDK | Python `fastmcp` |
| 사용 프리미티브 | Tools |

### 4.2 연동 백엔드 시스템

**백엔드 #1: 주문 운영 Oracle DB**

| 항목 | 내용 |
|---|---|
| 시스템명 | Order Ops Oracle |
| 종류 | Oracle 19c |
| 엔드포인트 | `order-ops-db.example.internal:1521/ORDEROPS` |
| 프로토콜 | Oracle TNS / oracledb (python) |
| 인증 방식 | DB user/password (env) |
| 권한 모델 | Read-only 계정 |
| 네트워크 | 내부망 |

**백엔드 #2: 운영 알람 API**

| 항목 | 내용 |
|---|---|
| 시스템명 | Order Ops Alert API |
| 종류 | REST API |
| 엔드포인트 | `https://order-ops-alerts.example.internal/v1` |
| 프로토콜 | HTTP/JSON |
| 인증 방식 | Bearer Token |
| 네트워크 | 내부망 |

---

## 5. 기능 요구사항 (Tools)

### 5.1 Tool 목록 (요약)

| Tool ID | Tool Name | 설명 | readOnly | destructive | idempotent |
|---|---|---|---|---|---|
| T-01 | `get_order_meta` | 주문 ID로 주문 메타 조회 (Oracle) | true | false | true |
| T-02 | `list_recent_alerts` | 최근 운영 알람 조회 (REST) | true | false | true |

### 5.2 Tool 상세 명세

#### ▶ T-01 `get_order_meta`

- **설명**: 주문 ID로 주문 메타 정보 조회 (Oracle 직결)

- **LLM Description**
  ```
  주문 ID로 주문 메타 정보(상품 코드, 주문 시각, 상태)를 조회한다.
  분석 컨텍스트로 주문 1건의 기본 정보가 필요할 때 사용.
  여러 주문을 한 번에 보거나 배송 이력은 별도 Tool 필요 (현재 미제공).
  호출 예: "주문 O2026000123456 정보" → get_order_meta(order_id="O2026000123456")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `order_id` | string | Y | 내부 주문 ID (고객에게 노출되는 주문번호 아님) |

- **출력 예시 (정상)**
  ```json
  {
    "order_id": "O2026000123456",
    "product_code": "SKU_STANDARD_01",
    "ordered_at": "2026-04-12T09:33:00+09:00",
    "status": "ACTIVE",
    "fulfillment_center": "anon_b21c"
  }
  ```

- **빈 결과**: 해당 없음 (id 없으면 NOT_FOUND)

- **응답 크기 제어**: 단일 응답 < 10KB

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `ORDER_NOT_FOUND` | "주문 'O2026000123456'을 찾을 수 없습니다. order_id 형식을 확인하세요." |
  | `BACKEND_UNAVAILABLE` | "Oracle DB에 연결할 수 없습니다. 잠시 후 다시 시도하세요." |
  | `ACCESS_DENIED` | "해당 주문 조회 권한이 없습니다." |

---

#### ▶ T-02 `list_recent_alerts`

- **설명**: 최근 운영 알람 목록 조회 (REST API)

- **LLM Description**
  ```
  Order Ops Alert API에서 최근 알람을 조회한다.
  현재 운영 이슈가 있는지 확인하거나 분석 시점의 시스템 상태를 파악할 때 사용.
  특정 알람의 상세는 별도 Tool 필요 (현재 미제공).
  호출 예: "지난 24시간 알람" → list_recent_alerts(hours=24, severity="warning")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | `hours` | int | N | 조회 기간 (시간 단위). 기본 24, 최대 168 |
  | `severity` | string | N | 'info'/'warning'/'critical' 필터 |

- **출력 예시 (정상)**
  ```json
  {
    "alerts": [
      {
        "id": "ALT-2026051901",
        "severity": "warning",
        "system": "order_intake",
        "message": "주문 접수 응답 지연 임계치 초과",
        "triggered_at": "2026-05-19T03:12:00+09:00"
      }
    ],
    "total_count": 4
  }
  ```

- **빈 결과**: `alerts: [], total_count: 0`

- **응답 크기 제어**: 단일 응답 < 100KB

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `INVALID_INPUT` | "hours는 1~168 범위여야 합니다." |
  | `BACKEND_UNAVAILABLE` | "Alert API에 연결할 수 없습니다." |
  | `ACCESS_DENIED` | "알람 조회 권한이 없습니다." |

---

## 6. 비기능 요구사항

### 6.1 성능 / 응답 크기

- 단일 호출 P95 < 2초
- Oracle 호출은 < 5초

### 6.2 보안

- MCP 인증: `X-MCP-API-Key`
- 백엔드 자격증명:
  - Oracle: `ORDER_OPS_MCP_ORACLE_USER`, `ORDER_OPS_MCP_ORACLE_PASSWORD`
  - REST API: `ORDER_OPS_MCP_ALERT_API_KEY`
- 민감정보 마스킹: 결제 카드번호, 계좌번호 패턴 자동 마스킹

### 6.3 로깅

- 백엔드별 호출 분리 로깅 (Oracle / Alert API)

---

## 7. 에러 처리

- Oracle timeout 5초
- REST timeout 5초
- 1회 재시도

---

## 8. 산출물

- [ ] 소스 저장소 URL
- [ ] 두 백엔드 연동 가이드
- [ ] 평가셋 10건 이상

---

## 9. 일정

| 단계 | 기한 |
|---|---|
| 요구사항 확정 | 2026-05-30 |
| 개발 완료 | 2026-06-30 |

---

## 10. 인수 기준

- [ ] 두 백엔드 모두 정상 동작
- [ ] 평가셋 통과율 ≥ 90%
