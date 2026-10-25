# 스크린 리더 점검 체크리스트 (P6-8, P7-6 자동 근사 반영)

처음 만든 날은 2026-10-23(P6-8)이고, 2026-10-25에 `main` 브랜치 기준으로 자동 근사 점검(P7-6) 결과를 항목마다 붙였습니다. Phase 4와 5에서 axe, Lighthouse 접근성 100점, 키보드 35항목은 자동으로 확인했지만 실제 스크린 리더로 들어 보는 점검은 사람이 해야 합니다. 화면마다 무엇을 누르면 무엇이 들려야 하는지를 적었으니 위에서부터 차례로 따라 하면 돼요. "기대 발화"는 영어 UI 기준이고, 한국어 UI(상단 KO)에서는 같은 자리에 괄호 안의 한국어 문구가 나와야 합니다.

표의 두 열은 이렇게 읽습니다.

- **자동 결과**: P7-6에서 Playwright(Chromium)로 접근성 트리, 포커스, 라이브 영역을 재서 얻은 판정입니다. "통과"는 읽힐 재료(이름, 역할, 상태, 라이브 문장)가 기대와 같음, "수정"은 결함을 찾아 이번에 고친 뒤 통과, "사람 확인"은 자동으로 잴 수 없어 실기 점검에 맡김입니다. 회귀 방지 테스트가 있는 항목은 `a11y` 표시를 붙였어요(`frontend/tests/e2e/a11y-screen-reader.spec.ts`).
- **사용자 실기 점검**: VoiceOver와 NVDA로 직접 들어야만 알 수 있는 것입니다. 발음, 읽는 순서의 자연스러움, 군더더기(같은 말 반복, 지나치게 긴 이름)가 여기에 들어갑니다.

## 1. 준비

| 항목 | macOS VoiceOver | Windows NVDA |
|---|---|---|
| 브라우저 | Safari 최신, Chrome 최신 둘 다 | Chrome 최신, Firefox 최신 둘 다 |
| 켜기와 끄기 | `Cmd+F5` | `Ctrl+Alt+N` (끄기는 `Insert+Q`) |
| 수정 키(아래 `VO`, `NVDA`) | `Ctrl+Option` | `Insert` (노트북은 `CapsLock` 설정 가능) |
| 랜드마크 목록 | `VO+U` 후 좌우 화살표로 "Landmarks" | `NVDA+F7` 후 "Landmarks" |
| 제목 목록 | `VO+U` 후 "Headings" | `NVDA+F7` 후 "Headings", 또는 `H`, `1`~`6` |
| 다음 폼 컨트롤 | `VO+Cmd+J` | `F` (브라우즈 모드) |
| 말한 내용 기록 | VoiceOver 유틸리티 > 상세 정보 > 캡션 패널 | NVDA 메뉴 > 도구 > 음성 뷰어 |

준비 순서입니다.

1. 저장소 루트에서 서버 3종을 띄웁니다: `make run-starter-mcp-http`, `make run-mock-repo-mcp`, `make run-nl2sql-mcp-http` (또는 `docker compose up -d --wait`).
2. Chat 점검용으로 가짜 LLM을 켠 프론트엔드를 띄웁니다: `cd frontend && CHAT_MOCK_LLM=1 npm run dev`. 실제 키로 해도 되지만 답변이 매번 달라 기대 발화를 맞추기 어려워요.
3. 브라우저 확대는 100%, 창 폭은 1280px 이상으로 둬요. 모바일 항목(7절)만 폭 390px(개발자 도구의 기기 모드)로 봐요.
4. 말한 내용 기록(캡션 패널, 음성 뷰어)을 켜 두면 결과표에 그대로 옮겨 적을 수 있어요.

판정은 세 가지입니다. "통과"는 기대 발화의 핵심어(이름, 역할, 상태)가 모두 들림, "부분"은 들리지만 순서가 어긋나거나 군더더기가 많음, "실패"는 들리지 않거나 틀린 정보가 들림입니다. 부분과 실패는 9절 결과표에 화면, 스크린 리더, 브라우저, 들린 문장을 적어 주세요.

## 2. 공통 셸 (모든 화면)

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| S1 | 페이지를 새로 열고 `Tab` 한 번 | "Skip to content, link"("본문으로 건너뛰기"). Enter를 누르면 본문(main)으로 이동해 다음 읽기가 화면 제목(h1)부터 시작합니다 | 통과 `a11y`. 첫 Tab이 건너뛰기 링크, Enter 뒤 포커스는 main | 가상 커서가 h1부터 다시 읽는지 |
| S2 | 랜드마크 목록 열기 | banner(타이틀바), navigation "Location"("현재 위치", 브레드크럼), navigation "Views"("화면", 활동 바), complementary "Server explorer"("서버 탐색기", Dashboard와 Inspector) 또는 "Sidebar"("사이드바", Chat), main, contentinfo "Status bar"("상태 표시줄"), region "Notifications alt+T"("알림 alt+T"). 같은 이름의 랜드마크가 두 번 나오지 않아야 합니다 | 통과 `a11y`. 네 화면 EN과 Dashboard KO에서 필수 랜드마크가 있고 역할과 이름이 겹치는 것 0개 | 목록 순서가 자연스러운지, "alt+T"를 어떻게 읽는지 |
| S3 | 활동 바에서 화면 링크로 이동 | 지금 화면의 링크는 "current page"(NVDA "현재 페이지", VoiceOver "현재")가 붙습니다 | 통과 `a11y`. 활동 바 링크에 `aria-current="page"` | "현재"가 실제로 붙어 읽히는지 |
| S4 | 타이틀바의 검색 칸(명령 팔레트 버튼) | "Search commands and servers ⌘K, button"("명령, 서버 검색 ⌘K"). 비 Apple 기기는 `Ctrl K`입니다 | 수정 `a11y`. 이름이 "Command palette"라 보이는 글자와 달랐습니다(WCAG 2.5.3) | `⌘K`를 "command K"로 읽는지, 이름이 길게 느껴지는지 |
| S5 | 서버 탐색기의 필터 칸 | "Filter servers, search field"("서버 필터"). 서버 항목은 상태와 이름, 도구 수가 한 번에 들립니다(예: "online starter-mcp-http 4 tools http") | 통과. searchbox 이름 있음, 항목 버튼 이름에 상태 포함 | 상태가 이름 앞에 오는 순서와 끝의 "http"가 군더더기로 들리는지 |
| S6 | 상태 표시줄 읽기 | 마지막 호출 시간, p50, 모델 이름처럼 화면이 올린 값만 읽힙니다. 아이콘 이름("clock icon" 같은)은 들리지 않아야 합니다 | 통과. contentinfo 글자가 "3/3 online p50 29 ms"뿐이고 아이콘은 `aria-hidden` | "3/3"과 "ms" 발음 |

### 명령 팔레트

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| P1 | `Cmd+K`(macOS) 또는 `Ctrl+K` | "Command palette, dialog"("명령 팔레트")와 설명 "Jump to a page, open a server or change preferences."가 들리고, 포커스는 콤보 상자(expanded)에 있습니다. 콤보 상자 이름은 "Command palette"이고 안내 "Type a command or a server name"("명령이나 서버 이름을 입력하세요")은 placeholder로 읽힙니다 | 통과 `a11y`. 대화상자 이름과 설명, 콤보 상자 포커스와 `aria-expanded` | placeholder 안내가 실제로 읽히는지, "Command palette"가 대화상자와 콤보 상자에서 두 번 들리는지 |
| P2 | 아래 화살표 두세 번 | 입력칸에 포커스를 둔 채 선택 항목이 바뀔 때마다 그 항목 이름이 들립니다(aria-activedescendant). 그룹 이름 "Go to"("이동")가 첫 항목과 함께 들리면 좋아요 | 통과 `a11y`. 화살표마다 `aria-activedescendant`가 바뀜 | VoiceOver와 Safari 조합에서 항목 이름이 읽히는지(activedescendant 지원 차이), 그룹 이름 |
| P3 | 없는 말 입력(예: `zzzz`) | "No commands match"("일치하는 명령이 없습니다")가 들립니다 | 사람 확인. 문구는 보이지만 라이브 영역이 아니라 저절로 읽힐지는 스크린 리더에 달렸습니다 | 입력 뒤 문구가 저절로 들리는지. 안 들리면 부분으로 적어 주세요 |
| P4 | `Esc` | 대화상자가 닫히고 포커스가 열기 전 위치로 돌아갑니다. 팔레트 버튼으로 열었으면 그 버튼이고, 아무 데도 포커스가 없을 때 단축키로 열었으면 문서 처음(body)입니다 | 통과 `a11y`. 버튼으로 열면 버튼, 단축키로 열면 body | body로 돌아갈 때 문서 처음부터 다시 읽는지 |
| P5 | 팔레트가 열린 채 `Tab`을 여러 번 | 포커스가 대화상자 밖으로 나가지 않습니다 | 통과 `a11y`. Base UI 포커스 가드가 다음 프레임에 안으로 되돌립니다(사람 속도의 Tab 기준) | 가상 커서(VO 화살표, NVDA 브라우즈 모드)로 밖에 나갈 수 있는지 |

### 서버 추가 대화상자

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| A1 | 탐색기나 Dashboard의 "Add server" | 대화상자 "Add runtime server"("런타임 서버 추가")가 열리고 포커스는 "Streamable HTTP URL" 칸에 있습니다 | 통과 `a11y` | 대화상자 설명문이 이어서 읽히는지 |
| A2 | 빈 값으로 "Connect and add" | URL과 Name 칸이 invalid가 되고 오류 문구("Enter a URL.", "Enter a name.")가 각 칸의 설명으로 이어집니다 | 통과 `a11y`. `aria-invalid`와 `aria-describedby` 연결 | 제출 직후 오류가 저절로 들리는지(포커스가 URL 칸에 그대로 있어 다시 읽히지 않을 수 있음) |
| A3 | `Esc` | 닫히고 연 버튼으로 포커스가 돌아갑니다 | 통과 `a11y` | |
| A4 | 헤더 값 보기 버튼 | 이름이 "Show value of header 1"과 "Hide value of header 1"로 바뀌어 상태를 알립니다 | 수정. 이름이 바뀌면서 `aria-pressed`도 붙어 "Hide ..., pressed"로 겹쳐 읽혔습니다 | |

### 토스트

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| T1 | Dashboard 머리의 "Refresh all" 누르기 | 끝나면 "Checked 3 HTTP servers, 3 online"("HTTP 서버 3개를 확인했습니다. 온라인 3개")이 포커스를 옮기지 않고 한 번 읽힙니다 | 수정 `a11y`. 문장은 polite 영역에 들어왔지만, 실행 중 버튼이 disabled가 되며 포커스가 body로 빠졌습니다. 이제 포커스가 버튼에 남아요(탐색기의 새로고침 아이콘 버튼도 같음) | 실행 중 이름 "Checking"이 들리는지, 토스트가 한 번만 읽히는지 |
| T2 | 토스트 영역으로 이동 | 영역 이름 "Notifications alt+T"("알림 alt+T")가 들립니다. `Alt+T`로 토스트 영역에 갈 수 있어야 합니다 | 통과 `a11y`. 영역 이름과 `aria-live="polite"`(KO 이름도 확인) | `Alt+T`가 스크린 리더 단축키와 겹치지 않는지 |

## 3. Dashboard `/`

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| D1 | 제목 목록 | 사이드바의 h2 "Servers"와 h3 "Registry", "Runtime" 뒤에 본문의 h1 "Servers"("서버"), h2 "Getting started"("시작하기", 숨기지 않았을 때)와 단계 h3, h2 "Recent checks"("최근 확인 기록"), h2 "Runtime servers"("런타임 서버")가 나옵니다. 수준을 건너뛰지 않습니다 | 통과 `a11y`. main 안 h1 1개, 건너뜀 0건 | 사이드바 h2가 h1보다 먼저 나오는 순서가 어색한지 |
| D2 | 시작하기 진행 막대 | "Getting started, progress bar, 1 of 4 done"처럼 값 글자(aria-valuetext)가 들립니다 | 통과. `aria-valuetext="1 of 4 done"` | 값 글자 대신 백분율이 읽히지 않는지 |
| D3 | 시작하기 "Hide" 버튼 | 이름은 "Hide Getting started"("시작하기 숨기기")입니다. 누르면 포커스가 접힌 칩 버튼 "Getting started 1/4"로 옮겨 가고, 다시 누르면 시작하기 제목으로 돌아옵니다 | 통과 `a11y` | "1/4"를 어떻게 읽는지 |
| D4 | 지표 영역(region "Dashboard", "대시보드") | "HTTP reachable 3 of 3" 같은 숫자와 설명이 한 묶음으로 읽힙니다 | 통과. 용어와 정의(dl) 구조 | "3/ 3"의 사선과 공백 발음 |
| D5 | 서버 표 "Registered servers" | 표 탐색(VO는 `VO+화살표`, NVDA는 `Ctrl+Alt+화살표`)으로 열 머리글(Status, Server, Transport, Tools, p50, Last check, Actions)이 셀과 함께 들립니다 | 통과. table 이름과 columnheader 7개 | 셀 이동 때 머리글이 실제로 붙는지 |
| D6 | 지연 스파크라인 셀 | "starter-mcp-http, p50 140 ms over the last 3 checks, scale 0 to 200 ms, image". 눈금 값이 화면 아래 설명("Same scale for every row: 0 to 200 ms")과 같아야 합니다 | 통과. img 이름에 서버, p50, 표본 수, 눈금 | 이름 길이가 부담스러운지 |
| D7 | 오프라인 서버(서버 하나를 끈 뒤 Retry) | 행 아래 경고의 제목과 복구 명령이 들리고, Retry 결과가 토스트로 읽힙니다 | 사람 확인. 서버 하나를 끈 상태에서 axe 0건까지만 확인했습니다 | 경고와 복구 명령이 읽히는 순서 |
| D8 | Recent checks 목록 | role log이지만 aria-live가 꺼져 있어 30초마다 새 줄이 생겨도 저절로 읽히지 않아야 합니다(소음 방지) | 통과. `aria-live="off"` | 30초 주기 갱신 때 정말 조용한지 |

## 4. Inspector `/inspector?server=starter-mcp-http`

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| I1 | 제목과 랜드마크 | h1 "Inspector"(EN은 화면에 숨김, KO는 "인스펙터"), 고른 도구 이름 h2. region "Tools"("도구"), "Request"("요청"), "Response"("응답"), "Inspector panel"("Inspector 패널", 도킹 패널), "JSON-RPC log"("JSON-RPC 로그") | 통과 `a11y` | |
| I2 | 도구 목록에서 `echo` 고르기 | 선택한 항목이 "selected"로 들리고, 요청 영역 제목이 `echo`로 바뀝니다 | 통과 `a11y`. `aria-selected="true"` | 항목 이름에 설명이 붙어 길게 들리는지 |
| I3 | 인자 칸 | "text, required, edit text"처럼 이름과 필수 여부가 들리고, 설명 "Text to echo. Must not be empty"가 설명으로 읽힙니다(이중 역따옴표 같은 기호가 읽히지 않아야 합니다) | 수정 `a11y`. 화면의 "required" 표시가 접근성 트리에 없었습니다. 이제 `aria-required`가 붙어요 | "required"가 이름 뒤에 한 번만 들리는지 |
| I4 | 빈 값으로 Run | 첫 오류 칸으로 포커스가 옮겨 "text, invalid, Required"가 들립니다 | 수정 `a11y`. 포커스가 Run 버튼에 남아 오류를 알 수 없었습니다. 폼, 리소스 템플릿, 프롬프트 인자 모두 같아요 | 오류 문구와 설명이 이어 읽히는 순서 |
| I5 | Run(`Cmd+Enter`) | 처음에는 상태 영역이 "Ready"("준비됨")입니다. 실행 중에는 1초에 한 번 "Running 1 s"("실행 중 1 s") 정도로만 바뀌고, 끝나면 "Finished in 12 ms"("12 ms에 끝남")가 한 번 읽힙니다. 0.1초마다 읽히면 실패입니다 | 통과 `a11y`. 짧은 호출에서 상태 변화 4번 이하 | 긴 호출에서 1초 간격이 시끄럽지 않은지 |
| I6 | 도구 오류(`add`에 문자열 인자) | 응답 영역에 alert "The tool returned isError: true"와 설명이 읽힙니다 | 통과 `a11y` | alert가 포커스를 뺏지 않고 한 번만 읽히는지 |
| I7 | Reset 버튼 | 폭이 좁아 아이콘만 남아도 이름 "Reset"("초기화")이 들립니다 | 통과 `a11y` | |
| I8 | 응답 탭(Content, Timing) | "tab, 1 of 2, selected". 화살표로 탭을 바꿔요 | 통과 `a11y`. tablist "Response" 안 선택 탭 | "1 of 2" 위치 정보가 들리는지 |
| I9 | NL2SQL Mock 응답(`nl2sql-mcp-http`의 `run_sql_query`) | 응답 위의 안내 "Mock sample data"와 서버 안내문이 읽힙니다 | 사람 확인. 이번 자동 점검 범위 밖 | 안내가 결과보다 먼저 읽히는지 |
| I10 | 도킹 패널 크기 핸들 | "Resize panel, separator"("패널 높이 조절")와 현재 값이 들리고 위아래 화살표로 값이 바뀌어 읽힙니다 | 통과. separator 3개 모두 이름과 `aria-valuenow` | 값 단위(px, %)가 의미 있게 들리는지 |
| I11 | JSON-RPC 로그 영역 | region 이름이 들리고, 새 줄이 생겨도 저절로 읽히지 않습니다 | 통과 `a11y`. polite 아님 | |

## 5. Chat `/chat?server=mock-repo-mcp`

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| C1 | 제목과 랜드마크 | 사이드바의 h2 "Conversations"("대화")와 "Tools exposed to the model"("모델에 공개할 도구"), 본문의 h1 "Chat"("채팅", 화면에는 숨김), h2 "Conversation"("대화 내용", 숨김), 빈 화면의 h2 "Ask about your data", h2 "Trace"("실행 추적"), 도구 카드 h3. region "Conversations", "Trace", "Span details"("스팬 상세") | 통과 `a11y` | |
| C2 | 대화 목록이 빈 상태 | "No saved conversations yet. Your chats are saved here automatically." | 통과 | |
| C3 | 툴바 | Model(콤보 상자, 현재 모델 이름), Max iterations(숫자 칸, 1~20), Approval(라디오 그룹 "Auto, Manual", 화살표로 이동), Token usage(그룹, "in 0 out 0"), "Clear chat" 버튼 순서로 들립니다 | 통과 `a11y`. combobox, spinbutton, radiogroup, group 모두 이름 있음 | Max iterations 설명(1~20)이 읽히는지 |
| C4 | 입력칸에 `[[tool:list_repositories]] [[sleep:1500]]` 입력 후 Enter | 상태 영역이 "The model is working.", "Calling list_repositories.", "The model is working.", "Response complete."("모델이 작업 중입니다.", "list_repositories 도구를 호출하는 중입니다.", "응답이 끝났습니다.")를 차례로 한 번씩 읽고, 저장되면 "1 conversation"("대화 1개")이 이어집니다. 글자가 흘러나올 때마다 읽히면 실패입니다(대화 영역은 role log, aria-live off) | 통과 `a11y`. 순서대로 들어오고 답변 본문은 라이브 영역에 들어오지 않음. KO도 같은 순서 | 같은 문장이 연달아 나올 때 두 번째가 생략되지 않는지 |
| C5 | C4 실행 중 대화 목록 | 첫 실행 동안 목록 맨 위에 "Running, Saved when the run ends" 행이 보이고, 끝나면 저장된 대화 행으로 바뀝니다 | 통과. 실행 중 행 표시 확인 | 행이 현재 항목으로 읽히는지 |
| C6 | 실행 중 `Esc` | 실행이 멈추고 "Response stopped."가 읽히며 포커스는 입력칸에 남아요 | 수정 `a11y`. 첫 응답 조각이 오기 전에 멈추면 남길 턴이 없어 상태 영역이 빈 채로 끝났습니다(아무 말도 없음). 이제 그때도 "Response stopped."가 나와요 | |
| C7 | 끝난 답변 읽기 | 도구 카드 그룹 "Tool call mock-repo-mcp / list_repositories"와 상태 "done", 답변 본문, 푸터(시간, 도구 호출 수)가 순서대로 읽힙니다 | 통과 `a11y`. 그룹 이름 | 카드 머리 버튼 이름(입력 JSON, 시간 포함)이 길게 들리는지 |
| C8 | Markdown 표가 있는 답변 | 표 앞의 region "Table, scrolls sideways when wider than the conversation"이 들리고, `Tab`으로 그 영역에 포커스가 가며 좌우 화살표로 가로 스크롤돼요 | 사람 확인. Phase 6 사전 점검 이후 바뀐 것 없음 | |
| C9 | Approval을 Manual로 바꾸고 다시 보내기 | 상태 영역이 "list_repositories is waiting for your approval."("list_repositories 도구가 승인을 기다리고 있습니다.")을 읽고, 승인 카드 그룹 "Waiting for your approval"("승인을 기다리는 중") 안의 Approve, Deny 버튼으로 바로 이동할 수 있습니다 | 통과 `a11y`. 포커스는 입력칸에 남고 안내문이 "Decide the pending tool call, or press Esc to stop"으로 바뀜 | 승인 카드까지 가는 길이 짧은지 |
| C10 | Approve | 실행이 이어지고 C4와 같은 순서로 읽힙니다. 거부하면 카드 상태가 "denied"로 바뀌어 읽힙니다 | 통과 `a11y`(승인). 거부는 `chat-run-controls.spec.ts`가 화면 상태로 확인 | "denied"가 들리는지 |
| C11 | 대화 행의 더보기 메뉴 | "Actions for <제목>, menu button". 메뉴 항목 Rename, Export, Delete가 들리고 `Esc`로 닫으면 버튼으로 돌아옵니다 | 통과 `a11y`. 메뉴 이름, 첫 항목 포커스, 돌아오기 | KO 이름이 "<제목> 작업"이라 제목이 먼저 들리는 순서 |
| C12 | Rename 대화상자 | 대화상자 이름 "Rename conversation"과 입력칸 이름이 들리고, 저장 뒤 "Conversation renamed" 토스트가 읽힙니다 | 통과 `a11y`. 입력칸 포커스, `Esc`로 행 버튼 복귀 | 오른쪽 위 X와 아래쪽 버튼이 모두 "Close"라 구별이 어려운지 |
| C13 | Trace 패널 | region "Trace", 워터폴 목록(listbox "Turn 1: ...")의 항목이 이름과 시간으로 읽히고, 항목을 고르면 region "Span details"에 상세가 나옵니다 | 통과. 항목 이름 예: "LLM, LLM #1, 842 ms, OK" | |

## 6. Settings `/settings`

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| E1 | 제목 목록 | h1 "Settings"("설정"), 섹션 h2 6개(LLM provider and model, API keys, Appearance and language, Onboarding, Local data, About). API keys 안의 경고 h3 "Keys are stored in this browser, in plain text"가 h2 아래에 옵니다 | 통과 `a11y` | |
| E2 | 섹션 내비게이션 | navigation "Sections"("섹션"). 링크를 누르면 해당 섹션 제목으로 이동해요 | 통과 `a11y` | 이동 뒤 제목부터 읽히는지 |
| E3 | 섹션 머리의 상태 칩 | 저장이 필요한 섹션은 평소 "Applies on Save"("저장 시 적용"), 값을 바꾸면 그 섹션만 "Unsaved"("저장 안 함")로 읽힙니다. 아래 저장 막대의 "Unsaved changes"와 서로 맞아야 합니다 | 통과 `a11y`. 키를 넣으면 API keys만 Unsaved, 저장 막대 status가 "Unsaved changes" | 저장 막대 status가 입력할 때마다 읽혀 시끄럽지 않은지 |
| E4 | API 키 칸 | "Anthropic API key, secure edit text". 보기 버튼은 "Show Anthropic API key"이고 누르면 "Hide ..."로 이름이 바뀝니다 | 수정 `a11y`. 이름이 바뀌면서 `aria-pressed`도 붙어 "Hide ..., toggle button, pressed"로 겹쳐 읽혔습니다 | 이름이 바뀐 것이 바로 들리는지 |
| E5 | OpenRouter 모델 칸 | 설명에 예시 ID(`anthropic/claude-sonnet-4.6` 등)가 읽힙니다 | 통과. 설명 연결 확인 | 사선과 점이 섞인 ID 발음 |
| E6 | 저장(`Cmd+S`) | "Saved 20:31:05"("20:31:05에 저장됨") 토스트가 읽히고 저장 막대의 상태(role status)가 "No unsaved changes"가 됩니다 | 통과 `a11y` | 토스트와 status가 겹쳐 두 번 들리는지 |
| E7 | "Reset settings" 확인 대화상자 | 대화상자 제목 "Reset settings?"와 설명이 열리자마자 읽히고, 포커스는 취소 쪽에 있습니다. `Esc`로 닫으면 누른 버튼으로 돌아갑니다 | 통과 `a11y`. alertdialog, 설명 연결, Cancel 포커스, 돌아오기 | |

## 7. 모바일 폭(390px)

| # | 동작 | 기대 발화와 확인할 점 | 자동 결과 | 사용자 실기 점검 |
|---|---|---|---|---|
| M1 | 랜드마크 목록 | 하단 탭바 navigation "Views"가 들리고 활동 바는 없습니다 | 통과 `a11y`. "Views" 1개 | |
| M2 | 타이틀바 "Open menu" | 드로어 대화상자 "Menu"("메뉴")가 열리고 "Close menu" 버튼이 들립니다. 닫으면 메뉴 버튼으로 돌아갑니다 | 통과 `a11y` | iOS VoiceOver 스와이프로 드로어 밖에 나갈 수 있는지 |
| M3 | Chat 하단 세그먼트(Thread, Trace) | 탭처럼 하나만 선택되어 읽히고 전환 뒤 해당 영역 제목이 들립니다 | 통과. role tab, 하나만 selected | 전환 뒤 제목이 읽히는지 |
| M4 | Inspector 도킹 패널 | 기본으로 접혀 있고, "Toggle panel (⌘J)"을 누르면 펼쳐졌다는 상태(expanded)가 들립니다 | 통과. `aria-expanded="false"`로 시작 | 이름 속 "(⌘J)" 발음 |

## 8. 자동 근사 점검 결과

### 8.1 방법 (P7-6)

다른 작업과 포트가 겹치지 않게 프로덕션 빌드를 `next start -p 3100`(`CHAT_MOCK_LLM=1`)으로 띄우고, 서버 3종은 8101, 8102, 8104 포트에 따로 띄운 뒤 `MCP_REGISTRY_PATH`로 그 주소를 가리키는 임시 레지스트리를 줬습니다. 폭 1440px와 390px, EN과 KO(쿠키 `mcpc-lang=ko`)에서 다음을 쟀어요.

- 랜드마크와 이름, 제목 수준, 라이브 영역(`aria-live`, role status, log, alert) 목록, `ariaSnapshot()`
- axe-core 4.14(`@axe-core/playwright` 4.14, wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice). 진행 중인 CSS 전환이 끝난 뒤에 잽니다
- Tab 순서(역할과 이름), 대화상자와 메뉴의 첫 포커스, 포커스 가두기, 닫은 뒤 돌아오는 곳
- MutationObserver로 라이브 영역에 들어온 문장 순서(Dashboard 새로고침, Inspector 실행, Chat 실행과 중지와 수동 승인, Settings 저장)
- 이름 없는 컨트롤(버튼, 링크, 입력, 탭, 메뉴 항목, 구분선) 탐색

결과는 이름 없는 컨트롤 0개, 같은 역할과 이름의 랜드마크 0개, 제목 건너뜀 0건이고, axe는 아래 2.5.3 결함을 고친 뒤 네 화면 EN과 KO 모두 0건입니다(서버 하나가 꺼진 상태에서도 0건). 자동 점검은 "무엇이 읽힐 재료가 있는가"까지만 알려 주고, 실제 발화 순서와 억양은 사람이 확인해야 해요.

### 8.2 이번에 고친 결함

| 찾은 것 | 고친 내용 | 항목 |
|---|---|---|
| 팔레트 버튼 이름 "Command palette"가 보이는 글자 "Search commands and servers ⌘K"와 다름(WCAG 2.5.3, axe `label-content-name-mismatch`) | 보이는 안내와 단축키를 그대로 이름으로 씁니다. 음성 입력으로 보이는 말을 해도 눌려요 | S4 |
| 언어 토글 이름 "English", "한국어"가 보이는 "EN", "KO"와 다름(같은 규칙) | 이름을 "EN (English)", "KO (한국어)"로 바꿨습니다 | S4 |
| "Refresh all"을 누르면 실행 중 disabled가 되어 포커스가 body로 빠짐(탐색기 아이콘 버튼도 같음) | Base UI `focusableWhenDisabled`로 `aria-disabled`만 걸어 포커스를 버튼에 남깁니다 | T1 |
| API 키와 헤더 값의 보기 버튼이 이름(Show/Hide)과 `aria-pressed`를 함께 바꿔 상태를 두 번 알림 | `aria-pressed`를 뺐습니다 | E4, A4 |
| Inspector 인자 칸의 "required" 표시가 접근성 트리에 없음 | 모든 인자 컨트롤에 `aria-required`를 붙였습니다 | I3 |
| Inspector에서 빈 필수 인자로 Run을 누르면 포커스가 버튼에 남아 오류를 알 수 없음 | 첫 오류 칸으로 포커스를 옮겨 이름, invalid, 오류 문구가 함께 읽히게 했습니다(도구, 리소스 템플릿, 프롬프트) | I4 |
| Chat에서 첫 응답 조각이 오기 전에 `Esc`로 멈추면 상태 영역이 빈 채로 끝남 | 멈춘 시점의 턴 수를 기억해 그 뒤로 턴이 바뀌지 않은 동안 "Response stopped."를 냅니다 | C6 |

회귀 방지 테스트는 `frontend/tests/e2e/a11y-screen-reader.spec.ts`(17개)입니다. 랜드마크와 제목과 axe(네 화면), KO 이름, 건너뛰기 링크, 2.5.3 이름, 팔레트, 서버 추가 대화상자, 새로고침 포커스와 토스트, 시작하기 숨기기와 보이기, Inspector(필수 인자, 검증 포커스, 실행 상태, 도구 오류 alert), Chat(실행 상태 순서, 스트리밍 비공개, 중지, 수동 승인, 메뉴와 이름 바꾸기 포커스), Settings(보기 버튼, 저장 알림, 초기화 확인), 모바일 드로어를 확인합니다. 이미 떠 있는 앱으로 돌리려면 `E2E_BASE_URL=http://localhost:3100 npx playwright test tests/e2e/a11y-screen-reader.spec.ts`처럼 주면 됩니다(webServer와 global-setup을 건너뜀).

### 8.3 Phase 6 사전 점검(P6-8)에서 고친 것

| 찾은 것 | 고친 내용 |
|---|---|
| Chat 화면의 사이드바(complementary)가 대화 목록을 담는데도 "Server explorer"로 읽힘 | 탐색기가 아닌 사이드바는 "Sidebar"("사이드바")로 읽히게 바꿨습니다(모바일 드로어 설명도 같음) |
| 토스트 영역 이름이 KO에서도 "Notifications alt+T" | `containerAriaLabel`을 사전 값으로 넘겨 KO는 "알림 alt+T"가 됩니다 |
| Inspector 도킹 패널 region 이름이 "Panel"("패널")뿐이라 랜드마크 목록에서 무엇인지 알기 어려움 | "Inspector panel"("Inspector 패널")로 바꿨습니다 |
| Chat 첫 실행 동안 대화 목록이 "No saved conversations yet"을 읽음 | 실행 중인 대화가 "Running" 행으로 보이게 했습니다(C5) |
| Markdown 표가 넓으면 오른쪽이 잘려 키보드로 볼 방법이 불분명 | 표를 이름 있는 region(포커스 가능, 가로 스크롤)으로 감쌌습니다(C8) |

### 8.4 사용자 실기 점검으로 넘기는 것

자동으로는 판정할 수 없어 VoiceOver와 NVDA로 들어 봐야 하는 것들입니다. 위 표의 "사용자 실기 점검" 열과 같은 내용을 모았어요.

| 관찰 | 메모 |
|---|---|
| 발음 | `⌘K`, `Ctrl K`, `(⌘J)`, "alt+T", "3/ 3", "p50", "ms", OpenRouter 모델 ID처럼 기호가 섞인 이름을 어떻게 읽는지(S4, T2, D4, E5, M4). EN 화면의 "KO (한국어)"를 영어 음성이 어떻게 읽는지도 봐 주세요 |
| 군더더기 | 탐색기 항목 "online starter-mcp-http 4 tools http"의 상태 위치와 끝의 "http"(S5), 도구 카드 머리 버튼의 긴 이름(C7), 대화상자와 콤보 상자에서 두 번 들리는 "Command palette"(P1), Rename 대화상자의 같은 이름 "Close" 두 개(C12) |
| 저절로 읽히는지 | 팔레트의 "No commands match"(P3), 서버 추가 대화상자 제출 뒤 오류(A2, 포커스가 이미 URL 칸에 있음), 저장 막대 status가 입력마다 읽히는지(E3), Chat 저장 뒤 "1 conversation"이 "Response complete." 바로 뒤에 붙는 것(C4), 실행 중 함께 나오는 "Getting started: 2 of 4 done"(시작하기 단계 완료 알림, Inspector와 Chat) |
| 가상 커서 | `aria-modal` 없이 Base UI가 바깥에 `aria-hidden`을 다는 방식이라 VO 화살표와 NVDA 브라우즈 모드로 대화상자 밖에 나갈 수 있는지(P5, M2). 서버 추가 대화상자를 연 동안 "Recent checks" 기록과 토스트 영역은 트리에 남아 있습니다 |
| 읽는 순서 | 사이드바 h2가 h1보다 먼저 나오는 셸 구조(D1), 단축키로 팔레트를 닫은 뒤 body로 돌아갔을 때 문서 처음부터 다시 읽는지(P4) |
| 자동 범위 밖 | 오프라인 서버 경고(D7), NL2SQL Mock 안내(I9), Markdown 표 region(C8), activedescendant 지원 차이(P2, VoiceOver와 Safari) |

## 9. 결과 기록표

| 항목 | 스크린 리더와 브라우저 | 판정 | 들린 문장과 메모 |
|---|---|---|---|
| S1 | VoiceOver + Safari | | |
| S1 | NVDA + Chrome | | |
| (이어서) | | | |

부분과 실패 항목은 이슈 템플릿(`.github/ISSUE_TEMPLATE/bug_report.yml`)으로 올리고, 제목에 항목 번호(예: `[SR C4]`)를 붙여 주면 재현과 수정이 빨라집니다.
