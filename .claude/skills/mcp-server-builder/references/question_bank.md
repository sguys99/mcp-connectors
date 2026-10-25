# AskUserQuestion Bank

질문 문구는 사용자의 언어를 따릅니다 (영어로 요청했으면 아래 문구를 영어로 옮겨 묻습니다).

Phase 3에서 미정 항목을 묻는 표준 옵션 세트. AskUserQuestion 1회당 **최대 4개 항목** 배칭. 5개 이상이면 우선순위(Transport > 인증 > 프로토콜 > 엔드포인트 > 기타)로 상위 4개만 묻고 나머지는 TODO 마커.

옵션은 모두 `multiSelect: false` 권장 (단일 선택). 자유 입력은 "Other"로 사용자가 입력.

---

## 1. Transport 미지정

```json
{
  "question": "MCP 서버의 transport는 무엇으로 할까요?",
  "header": "Transport",
  "options": [
    {
      "label": "Streamable HTTP (Recommended)",
      "description": "--transport http 기본. Inspector, Chat, K8s 배포에 적합. stdio도 함께 지원."
    },
    {
      "label": "stdio (로컬 Claude Desktop/IDE 연동)",
      "description": "--transport stdio 기본. 별도 서버 없이 프로세스를 직접 띄움. HTTP도 함께 지원."
    },
    {
      "label": "SSE (레거시)",
      "description": "생성 코드는 Streamable HTTP로 대체하고 TODO 마커를 남김."
    }
  ]
}
```

---

## 2. 백엔드 프로토콜 미지정

```json
{
  "question": "백엔드 시스템 호출 방식은 무엇인가요?",
  "header": "Backend protocol",
  "options": [
    {
      "label": "REST API (HTTP/JSON) (Recommended)",
      "description": "httpx.AsyncClient 사용. 가장 흔한 케이스."
    },
    {
      "label": "CLI 명령 호출",
      "description": "asyncio.create_subprocess_exec로 명령 실행 후 stdout 파싱. 일부 레거시 코드 저장소의 CLI/Shell API가 이 케이스."
    },
    {
      "label": "DB 직접 연결 (JDBC/native)",
      "description": "Oracle: oracledb, PostgreSQL: asyncpg 등. 백엔드 §4.2에서 DB 종류 명시 필요."
    },
    {
      "label": "Java API (JNI 또는 사이드카 필요)",
      "description": "Python에서 직접 호출 어려움. 통상 Java HTTP 사이드카로 wrap 후 httpx 호출. TODO 마커 권장."
    }
  ]
}
```

---

## 3. 인증 방식 미지정

```json
{
  "question": "백엔드 인증 방식은?",
  "header": "Backend auth",
  "options": [
    {
      "label": "Bearer Token (Authorization 헤더) (Recommended)",
      "description": "Authorization: Bearer <token>. 환경 변수 <UPPER_NAME>_BACKEND_TOKEN으로 주입."
    },
    {
      "label": "API Key (커스텀 헤더, 예: X-API-Key)",
      "description": "헤더명을 별도 지정. 내부 API에 흔함."
    },
    {
      "label": "Basic Auth (id:password)",
      "description": "구형 내부 시스템. id/pw 두 env 키 필요."
    },
    {
      "label": "mTLS / 별도 (확인 필요)",
      "description": "클라이언트 인증서. # TODO 마커로 표시 후 보안팀 회신 대기."
    }
  ]
}
```

---

## 4. MCP Agent 인증 (X-MCP-API-Key)

```json
{
  "question": "MCP Agent 호출 시 인증을 적용할까요?",
  "header": "MCP auth",
  "options": [
    {
      "label": "활성화: X-MCP-API-Key 헤더 검증 (Recommended)",
      "description": "MCP_API_KEY와 비교. server.py HTTP 분기에서 build_http_middleware(settings.mcp_api_key)로 일괄 적용 (stdio는 영향 없음). test_auth_middleware.py 생성."
    },
    {
      "label": "비활성: 인증 없이 누구나 호출 가능",
      "description": "내부망/PoC 단계에서 단순화. 추후 활성화 가능."
    }
  ]
}
```

---

## 5. 엔드포인트 URL 미지정

자유 입력. AskUserQuestion보다는 단순 텍스트 질의가 더 편할 수 있다.

```
"백엔드 §4.2 엔드포인트가 미정입니다. 알고 계신 URL을 입력해 주세요 (모르면 'TODO'로 답변)."
```

응답이 "TODO" 또는 빈 값이면 `<UPPER_NAME>_BACKEND_URL`을 빈 값(Mock)으로 두고 `# TODO(스펙 미정: §4.2 엔드포인트)` 마커.

---

## 6. 폴더 존재 시 분기

```json
{
  "question": "src/mcp-servers/<snake_name>/이 이미 존재합니다. 어떻게 진행할까요?",
  "header": "Existing folder",
  "options": [
    {
      "label": "전체 재생성 (기존 파일 덮어쓰기)",
      "description": "수동 수정한 코드가 있다면 손실. 새로 시작 시에만 선택."
    },
    {
      "label": "Tool만 추가 (server.py / client.py 등은 유지)",
      "description": "기존 구조 보존. 새 Tool만 tools, TOOLS 튜플, client.py 메서드, tests/, 시나리오 YAML에 추가."
    },
    {
      "label": "중단 (아무것도 안 함)",
      "description": "기존 상태 유지하고 스킬 종료."
    }
  ]
}
```

---

## 7. Tool 개수 분할 정책

자동 규칙(1~4개 단일, 5~10개 그룹, 11개 이상 개별)을 적용하지만, 사용자가 명시 원하면 묻기:

```json
{
  "question": "tools 파일 분할은?",
  "header": "Tools layout",
  "options": [
    {
      "label": "자동 (Tool 개수 기준) (Recommended)",
      "description": "1~4개는 tools.py, 5~10개는 tools/<group>.py, 11개 이상은 tools/<name>.py"
    },
    {
      "label": "항상 단일 tools.py",
      "description": "파일 수 최소화. 큰 파일 감수."
    },
    {
      "label": "항상 tools/<name>.py 1 파일 1 Tool",
      "description": "각 Tool 격리. 파일 수 많아짐."
    }
  ]
}
```

---

## 8. Mock 응답을 어디에 둘지 (선택)

기본은 `MockBackendClient` 메서드 본문에 dict literal. 사용자가 fixture 분리 원하면:

```json
{
  "question": "Mock 응답 데이터 위치는?",
  "header": "Mock data",
  "options": [
    {
      "label": "MockBackendClient 메서드 본문 (Recommended)",
      "description": "client.py 안에 모여 있어 한 눈에 파악. PoC에 충분."
    },
    {
      "label": "별도 fixture 파일 (src/mcp-servers/<snake_name>/fixtures/)",
      "description": "JSON 파일로 분리하고 MockBackendClient가 읽음 (mock_repo_mcp 방식). 응답 셋이 많을 때."
    }
  ]
}
```

---

## 9. 로깅 시스템 미지정 (낮은 우선순위)

대부분 PoC에서는 `_common.logging`의 stderr JSON 로깅으로 충분합니다. 사용자가 내부 통합 로그 시스템(Splunk/ELK 등)을 명시하지 않으면 묻지 않고 기본값을 적용합니다. 명시 필요 시:

```
"§6.3 수집 시스템이 미정입니다. 내부 로그 시스템명을 입력하거나 기본값(stderr JSON)으로 두려면 'TODO'로 답해 주세요."
```

---

## 10. 우선순위 가이드

여러 미정 항목이 있을 때 다음 순서로 상위 4개 선택:

1. **Transport** (서버 기동 자체에 필수)
2. **MCP Agent 인증** (보안 기본값 결정)
3. **백엔드 프로토콜** (client.py 구현 종류)
4. **백엔드 인증** (env 키 종류)
5. **엔드포인트 URL** (placeholder로 충분)
6. **폴더 분할** (자동 휴리스틱으로 충분)
7. **Mock 위치** (기본값으로 충분)
8. **로깅** (stderr JSON 기본값으로 충분)

5번 이하는 TODO 마커 + 기본값으로 처리하고 묻지 않는다.

---

## 11. 사용자 응답 처리

| 응답 형태 | 처리 |
|---|---|
| 옵션 선택 | 그대로 적용 |
| "Other"로 자유 입력 | 그대로 적용 (정규화는 코드에서) |
| "모르겠다" / "확인 필요" / "TODO" | `# TODO(스펙 미정: <항목명>)` 마커 + 기본값 |
| 무응답 (skip), 비대화형 실행 | 기본값 + `# TODO(스펙 미정: <항목명>)` 마커 (나중에 grep으로 찾을 수 있게) |

---

## 12. 한 번에 묻는 예시

5개 모두 미정인 스펙에 대해:

```python
AskUserQuestion(questions=[
    {질문 1: Transport},
    {질문 2: MCP Agent 인증},
    {질문 3: 백엔드 프로토콜},
    {질문 4: 백엔드 인증},
])
# 엔드포인트 URL은 TODO 마커로 처리, 5번 이하는 묻지 않음
```
