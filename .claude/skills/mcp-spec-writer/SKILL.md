---
name: mcp-spec-writer
description: Writes a 10-section requirements spec for a new MCP server (Python + FastMCP) through a short section-by-section interview, in Korean or English. Use whenever the user wants to design or specify an MCP server that connects an AI agent to an enterprise or internal system (code repository, RDB, data warehouse, metadata catalog, internal API), e.g. "I want to build an MCP server", "write an MCP server spec", "design the tools for an MCP server over our DB", "MCP 서버 만들고 싶어", "MCP 스펙/명세 작성해줘", "요구사항 정의서", even if the words "spec" or "requirements" are not used but the intent is to decide a new MCP server's tools, interfaces, or behavior. The spec is precise enough for a developer or the mcp-server-builder skill to implement 1:1.
license: MIT
---

# MCP Server Spec Writer

## Overview

사용자의 MCP 서버 개발 요구사항을 **AskUserQuestion 기반 섹션별 인터뷰**로 구체화하여, [references/template_v2.md](references/template_v2.md) 구조를 100% 준수하는 요구사항 정의서를 생성한다.

생성된 정의서는 다음을 만족해야 한다:
- **Python + FastMCP**로 1:1 구현 가능한 정밀도 (Tool 시그니처, 입출력 JSON, 에러 코드 모두 정의)
- 모범 예시 [references/example_code_repo.md](references/example_code_repo.md)와 같은 톤과 디테일 수준
- **작성 언어는 한국어(기본) 또는 영어**. 영어판은 [references/template_v2.en.md](references/template_v2.en.md)를 쓰며 섹션 번호, 헤딩, 표 구조, `#### ▶ T-NN` 블록이 한국어판과 1:1로 같습니다
- 기본 저장 경로: `docs/mcp-spec/<server-name>_v0.1.md` (사용자 별도 지정 시 변경)

## When to Use

다음 중 어느 것에라도 해당되면 이 스킬을 사용한다:
- 새 MCP 서버를 설계하거나 개발해야 할 때 (요청이 영어여도 동일)
- 기업 내부 시스템(코드 저장소, RDB, DW, 메타정보, 내부 API 등)을 Agent에 연동하는 인터페이스를 정해야 할 때
- 사용자가 "MCP 스펙/명세/정의서/요구사항"을 언급할 때
- 기존 MCP 서버에 새로운 Tool을 추가하는데 명세 문서가 필요할 때
- 사용자가 "Agent가 X 시스템에서 Y를 조회/실행할 수 있게 해줘"라고 말하며 그 인터페이스가 MCP로 구현될 것이 자명할 때

---

## Operational Workflow

### Phase 0: 작성 언어 결정

1. 사용자가 언어를 명시했으면("in English", "영어로", "한국어로") 그대로 따릅니다.
2. 명시가 없으면 요청 문장의 언어를 따릅니다. 영어 요청이면 영어, 한국어 요청이면 한국어입니다.
3. 한국어 요청이지만 공개 저장소, 해외 팀 공유처럼 영어가 나을 단서가 있으면 첫 AskUserQuestion 묶음에 언어 질문을 하나 넣습니다 ([question_bank.md "시작 전"](references/question_bank.md)).

정한 언어로 인터뷰 질문, 요약, 정의서를 모두 씁니다. 언어와 관계없이 바뀌지 않는 것은 다음과 같습니다.

- 섹션 번호와 순서(§0~§10), 표 칼럼 구성, `#### ▶ T-NN \`tool_name\`` 블록 표기
- Tool 이름, 파라미터 이름, 에러 코드(`SCREAMING_SNAKE_CASE`), JSON 키
- 저장 경로 `docs/mcp-spec/<server-name>_v0.1.md`

### Phase 1: 사전 학습 (필수 1회)

스킬이 트리거되면 다음 3개 reference를 순서대로 Read하여 구조, 품질 기준, 구현 매핑을 학습한다. 이 단계는 사용자에게 보이지 않는 내부 준비이며, 사용자에게 "잠시 템플릿을 확인하겠습니다" 정도만 안내한다.

1. [references/template_v2.md](references/template_v2.md): 정의서의 정식 구조. 영어로 쓸 때도 섹션별 예시 디테일을 참고하려고 읽고, 출력 헤딩은 [template_v2.en.md](references/template_v2.en.md)를 그대로 따른다 (10개 섹션). 작성 가이드와 예시 블록은 **출력에서 제거**하고 헤더 구조와 표 형식만 유지.
2. [references/example_code_repo.md](references/example_code_repo.md): 모범 예시. 톤, 디테일 깊이, "확인 필요" 표기 방식, 에러 메시지 자연어 패턴, LLM Description의 4요소(무엇/언제 호출/언제 호출 안 함/예시)를 그대로 따른다.
3. [references/fastmcp_patterns.md](references/fastmcp_patterns.md): 정의서 각 항목이 FastMCP의 어떤 구성요소와 매핑되는지. **5장 Tool 명세를 작성할 때 반드시 이 매핑을 머릿속에 두고 작성한다.**

### Phase 2: 섹션별 인터뷰

[references/question_bank.md](references/question_bank.md)의 표준 질문 세트를 따른다. 한 번의 AskUserQuestion에는 최대 4개 질문, 옵션화 가능한 항목은 옵션으로, 그 외는 자유 입력. **각 섹션 종료마다 그 섹션의 markdown 단편을 누적 작성**하여 마지막에 한꺼번에 합친다.

요청에 이미 담긴 정보(백엔드 종류, 인증 방식, 배포 환경, Read-only 여부 등)는 다시 묻지 않고 확인만 한다. AskUserQuestion을 쓸 수 없는 비대화형 실행이면 아래 "백엔드 유형별 권장 기본 설정"과 각 섹션의 기본값으로 채우고, 사용자만 답할 수 있는 항목(엔드포인트, 담당 팀, 일정)은 `**확인 필요**`로 남긴다.

#### §0~1. 문서 정보 + 개요
- 작성일은 `currentDate`(시스템 컨텍스트)에서 자동.
- 버전은 `v0.1`로 고정 (저장 시 파일명에도 반영).
- 서버명은 kebab-case (`xxx-mcp` 접미사 권장).

#### §2. 범위
- In-Scope / Out-of-Scope를 분리.
- "쓰기 작업"은 PoC 단계에서 Out으로 제외하는 것을 권장 (보안). 사용자가 명시적으로 포함을 원하면 수용.

#### §3. 사용자 및 시나리오
- UC 2~4개 도출. **이 UC가 5장 Tool 목록의 근거**이므로 UC와 Tool 매핑 열을 채울 수 있는 수준까지 구체화.

#### §4. 시스템 구성
- 4.1 Transport는 별 언급 없으면 `Streamable HTTP` 기본값.
- 4.2 백엔드는 사용자가 답하기 어려운 항목(엔드포인트, 인증, 프로토콜)이 많다. 사용자가 "모르겠다/확인 필요"라고 답하면 예시 4.2처럼 **`**확인 필요 (X팀 회신 대기)**`** 패턴으로 적되, 가능한 후보를 함께 나열한다.

#### §5. Tool 명세 (핵심, 가장 시간을 들임)

**5-A. Tool 목록 도출**: UC를 보며 Tool 후보를 함께 정리하여 5.1 표를 먼저 채운다. PoC는 Tool 3~6개를 권장한다. 요청 범위를 덮는 데 그보다 많이 필요하면 핵심 Tool만 5장에 두고 나머지는 2.2 제외 범위(다음 단계)로 넘길지 사용자에게 확인한다 (비대화형이면 넘긴다). Tool 이름은 `snake_case`, 동사 형태 (`get_*`, `list_*`, `search_*`, `execute_*`).

**5-B. Tool별 상세 작성 (LOOP)**: 5.1 표의 Tool마다 다음 블록을 완성한다.

```
#### ▶ T-NN `tool_name`

- **설명**: (사람용 한 줄, README/문서용)

- **LLM Description** (Tool에 노출되는 본문, 3~7줄)
  ```
  (1) 이 Tool이 무엇을 하는가
  (2) 언제 호출해야 하는가
  (3) 언제 호출하지 말 것인가 (대체 Tool 안내)
  (4) 호출 예시 한 줄 ("자연어 → Tool 호출(파라미터)")
  ```

- **입력 파라미터**

  | 파라미터 | 타입 | 필수 | description (LLM 노출) |
  |---|---|---|---|
  | ... | ... | Y/N | ... |

- **출력 예시 (JSON)**
  ```json
  { ... 실제 값으로 채운 예시 1건 ... }
  ```

- **빈 결과**: (배열이 비어있는 경우 등 구체 정의)
- **응답 크기 제어**: limit 최대값, cursor 사용 여부, *_TOO_LARGE 트리거 조건

- **에러 응답**

  | 코드 | 메시지 예시 |
  |---|---|
  | `*_NOT_FOUND` | "...을 찾을 수 없습니다. ...로 확인하세요." |
  | `ACCESS_DENIED` | "..." |
  | `INVALID_INPUT` | "..." (해당 시) |
```

**5-B 작성 시 핵심 체크리스트** ([fastmcp_patterns.md §10 참조](references/fastmcp_patterns.md)):
- LLM Description은 **반드시 4요소 모두 포함**. "무엇을 하는지"만 적으면 Agent가 잘못 호출함.
- 모든 입력 파라미터에 description 필수 (Agent에 노출됨, Tool 신뢰성의 핵심).
- 출력 JSON은 **실제 값으로 채운 예시** (`"value"`, `"<placeholder>"` 같은 가짜 텍스트 금지). 예시 문서의 저장소/파일/검색 응답 패턴 참조.
- 에러는 최소 `*_NOT_FOUND` + `ACCESS_DENIED` + (입력 검증이 있는 경우) `INVALID_INPUT` 세 종류. 백엔드 호출이 있으면 `BACKEND_UNAVAILABLE` 또는 `*_TIMEOUT` 추가.
- 메시지에는 **원인과 조치(다음에 무엇을 해야 하는지)를 한 문장에** 함께 적음.

**5-C. Tool 추가 루프**:
1건 완료 후 사용자에게 "추가할 Tool이 더 있나요?"라고 묻는다. Yes면 5-B로 돌아가고, No면 5장을 마친다.

**5-D. Resources / Prompts (선택)**: 4.1에서 Resources나 Prompts를 쓴다고 정했을 때만 5.3 표(종류, URI 또는 이름, MIME type 또는 인자, LLM 노출 설명)를 채운다. 쓰지 않으면 5.3은 넣지 않는다.

#### §6. 비기능 요구사항
- 응답 크기는 **MB와 토큰** 양측 한도 모두 명시 (LLM 컨텍스트 보호).
- 보안 항목 중 "인가 경계", "간접 prompt injection 방어", "민감정보 마스킹"은 기업 내부 시스템 연동의 표준 항목이므로 사용자가 명시 안 해도 기본 포함.

#### §7. 에러 처리
- Timeout / 재시도 / Circuit Breaker는 표준 패턴이 있으므로 기본값을 제안하고 사용자가 조정.

#### §8~10. 산출물 / 일정 / 인수 기준
- 산출물에 "LLM Tool-calling 평가셋 (10건 이상) 및 통과율 결과서"는 기본 포함 (예시 8장 참조).
- 인수 기준에 "평가셋 통과율 ≥ 90%"는 기본 포함.

### Phase 3: 검토 및 저장

1. **요약 제시**: 작성한 정의서를 섹션별 한 줄로 요약하여 사용자에게 제시.
2. **수정 요청 수렴**: 사용자가 특정 섹션 번호를 지목하면 그 섹션만 다시 인터뷰.
3. **저장**:
   - 기본 경로: `docs/mcp-spec/<server-name>_v0.1.md` (server-name은 §1.1에서 받은 값)
   - 사용자가 다른 경로 지정 시 그 경로 사용
   - 파일이 이미 존재하면 사용자에게 덮어쓰기 여부 확인

---

## 출력 작성 규칙 (반드시 준수)

### 헤더 구조
- 템플릿의 **모든 10개 섹션**을 빠짐없이 포함 (§0~§10).
- 헤더 텍스트는 템플릿과 동일 (`## 0. 문서 정보`, `### 5.2 Tool 상세 명세` 등).
- **작성 가이드(📝 ... )와 💡 예시 블록은 모두 제거**. 헤더와 표 구조만 유지.

### 톤 / 스타일

**한국어 정의서** (아래 규칙은 한국어 출력에만 적용):
- 기술 용어는 영어 그대로 (Transport, Annotations, cursor 등).
- 문어체. "~한다", "~참조"체 사용 (예시 문서 톤).
- Em dash(U+2014)를 쓰지 않는다. 쉼표, 콜론, 괄호로 바꾼다.
- 가운뎃점(U+00B7)으로 항목을 나열하지 않는다. 쉼표, "와/과", 슬래시(/)를 쓴다.

**영어 정의서**:
- [template_v2.en.md](references/template_v2.en.md)의 헤딩을 글자 그대로 쓴다 (빌더 파싱 계약).
- 짧은 평서문, 현재 시제. LLM Description은 명령형 동사로 시작해도 된다 ("Return ...", "Use it when ...").
- 미확정 표기는 `**TBD (waiting for <team>)**`, 후보는 "Candidates: A, B, C".

**공통**:
- 표 셀의 값은 간결하게 (긴 설명은 별도 단락으로 빼고 표는 1~2줄).

### Tool 명세 품질
- LLM Description의 4요소 누락 시 정의서 미완성으로 간주. 사용자가 잘 모르면 예시 문서를 참고하여 후보 문장을 제안.
- 출력 JSON 예시의 값은 그럴듯한 실제 값 (날짜는 `currentDate` 근처, ID는 도메인에 맞게).
- 에러 메시지는 정의서 언어로 쓰고 끝에 마침표 또는 안내 문구를 포함. 원인과 다음 조치를 한 문장에 담는다.
- **LLM Description, 파라미터 description, 에러 메시지는 정의서 언어로 쓴다.** 한국어 정의서면 한국어로 쓰고(검토자가 읽는 문서이므로), 구현 시 `mcp-server-builder`가 의미를 유지해 영어로 옮긴다. 영어 정의서는 그대로 복사되므로 처음부터 최종 문구로 쓴다. 한국어 정의서에 영어 LLM Description을 섞지 않는다.

### 미확정 항목 표기
- 사용자가 "모르겠다/확인 필요/미정"이라고 답하면 `**확인 필요 (X팀 회신 대기)**` 또는 `**확인 필요**`로 표기 (영어 정의서는 `**TBD (waiting for X team)**`).
- 예시 [§4.2](references/example_code_repo.md#42-연동-백엔드-시스템) 참조. 미확정이라도 "후보: A, B, C" 형태로 가능한 옵션을 함께 적어 검증을 돕는다.

### 파일 끝
- 마지막 섹션 뒤에 추가 메모/서명 등은 넣지 않는다. §10 종료로 마무리.

---

## 백엔드 유형별 권장 기본 설정

새 정의서를 시작할 때, 사용자가 명시한 백엔드 유형에 따라 다음을 **기본값으로 제안**(사용자가 변경 가능):

| 백엔드 유형 | 권장 Tool 예시 | 기본 Annotations | 응답 크기 한도 |
|---|---|---|---|
| 코드 저장소 (Git, GitLab, Gitea 등) | `list_repositories`, `get_file_content`, `get_diff`, `get_changeset`, `search_code` | 모두 read-only | 단일 파일 5MB / changeset 5MB |
| RDB (Oracle, MySQL, PostgreSQL) | `list_tables`, `describe_table`, `sample_rows`, `execute_query` (Read-only) | 모두 read-only | 행 200건 / 1MB |
| DW (Snowflake, BigQuery, Redshift) | `list_datasets`, `list_tables`, `describe_table`, `column_stats`, `run_query` | 모두 read-only | 행 1000건 / 5MB |
| 메타정보 / 카탈로그 | `search_entity`, `get_entity_detail`, `list_lineage` | 모두 read-only | 100건 / 1MB |
| 내부 API (티켓, 워크플로우) | `list_*`, `get_*` (PoC), `create_*` (Phase 2) | PoC는 read-only | 1MB |

"모두 read-only"는 `readOnly: true, destructive: false`를 뜻합니다. `idempotent`는 [fastmcp_patterns.md §2](references/fastmcp_patterns.md) 표를 따르며, 정렬이 비결정적인 검색 Tool은 `idempotent: false`로 둡니다.

---

## 예시 (인용)

좋은 LLM Description의 예 (예시 문서 T-03 `search_code`):

```
저장소 내 코드에서 query와 일치하는 문자열을 라인 단위로 검색한다.
"이 함수를 어디서 호출하는가", "이 TODO가 어느 파일에 있는가" 같은 위치 탐색에 사용.
매치된 line_number와 preview만 반환하므로 전체 본문이 필요하면 get_file_content로 후속 호출할 것.
매치가 많을 것으로 예상되면 repository_id로 범위를 좁힐 것 (응답 크기와 비용 절감).
호출 예: "TODO가 있는 위치 다 알려줘" → search_code(query="TODO")
```

이 예에서 4요소가 모두 보인다:
1. **무엇**: "query와 일치하는 문자열을 라인 단위로 검색"
2. **언제**: "함수 호출 위치, TODO 위치 같은 위치 탐색"
3. **호출하지 말 것/주의**: "전체 본문이 필요하면 get_file_content", "매치가 많으면 repository_id로 범위 축소"
4. **호출 예**: 자연어 → Tool 호출

새 Tool의 LLM Description을 작성할 때 이 구조를 따르도록 사용자에게 안내한다.

---

## 마무리 안내

작성 완료 후 사용자에게 다음을 안내:
1. 저장 경로 안내 (`docs/mcp-spec/<server-name>_v0.1.md`)
2. 다음 단계 제안:
   - 정의서를 백엔드 담당팀(또는 외부 벤더)에 공유하여 §4.2 미확정 항목 회신 요청
   - `/mcp-server-builder`로 정의서를 코드로 변환 (Mock 백엔드, 테스트, 시나리오 YAML, 레지스트리 등록까지 생성)
   - LLM Tool-calling 평가셋 작성 (인수 기준 충족용, 10건 이상). 도구 호출 회귀는 `scripts/mcp_cli.py test`의 시나리오 YAML(`docs/scenario-format.md`)로 이어서 관리 가능
