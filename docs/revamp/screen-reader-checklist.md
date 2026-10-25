# 스크린 리더 수동 점검 체크리스트 (P6-8)

기준일은 2026-10-23이고 대상은 브랜치 `revamp/phase-6-docs`의 프론트엔드(`frontend/`)입니다. Phase 4와 5에서 axe, Lighthouse 접근성 100점, 키보드 35항목은 자동으로 확인했지만 실제 스크린 리더로 들어 보는 점검은 사람이 해야 해서 이 문서로 넘겨요. 화면마다 무엇을 누르면 무엇이 들려야 하는지를 적었으니 위에서부터 차례로 따라 하면 돼요. 아래 "기대 발화"는 영어 UI 기준이고, 한국어 UI(상단 KO)에서는 같은 자리에 괄호 안의 한국어 문구가 나와야 합니다.

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
3. 브라우저 확대는 100%, 창 폭은 1280px 이상으로 둬요. 모바일 항목(6절)만 폭 390px(개발자 도구의 기기 모드)로 봐요.
4. 말한 내용 기록(캡션 패널, 음성 뷰어)을 켜 두면 결과표에 그대로 옮겨 적을 수 있어요.

판정은 세 가지입니다. "통과"는 기대 발화의 핵심어(이름, 역할, 상태)가 모두 들림, "부분"은 들리지만 순서가 어긋나거나 군더더기가 많음, "실패"는 들리지 않거나 틀린 정보가 들림입니다. 부분과 실패는 7절 결과표에 화면, 스크린 리더, 브라우저, 들린 문장을 적어 주세요.

## 2. 공통 셸 (모든 화면)

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| S1 | 페이지를 새로 열고 `Tab` 한 번 | "Skip to content, link"("본문으로 건너뛰기"). Enter를 누르면 본문(main)으로 이동해 다음 읽기가 화면 제목(h1)부터 시작합니다 |
| S2 | 랜드마크 목록 열기 | banner(타이틀바), navigation "Location"("현재 위치", 브레드크럼), navigation "Views"("화면", 활동 바), complementary "Server explorer"("서버 탐색기", Dashboard와 Inspector) 또는 "Sidebar"("사이드바", Chat), main, contentinfo "Status bar"("상태 표시줄"), region "Notifications alt+T"("알림 alt+T"). 같은 이름의 랜드마크가 두 번 나오지 않아야 합니다 |
| S3 | 활동 바에서 화면 링크로 이동 | 지금 화면의 링크는 "current page"(NVDA "현재 페이지", VoiceOver "현재")가 붙습니다 |
| S4 | 타이틀바의 검색 칸(명령 팔레트 버튼) | "Command palette, button"("명령 팔레트"). 단축키 안내(`⌘K`, `Ctrl+K`)가 함께 들리면 좋아요 |
| S5 | 서버 탐색기의 필터 칸 | "Filter servers, edit text"("서버 필터"). 서버 항목은 이름과 상태(Online, Offline, On demand)가 한 번에 들려야 합니다 |
| S6 | 상태 표시줄 읽기 | 마지막 호출 시간, p50, 모델 이름처럼 화면이 올린 값만 읽힙니다. 아이콘 이름("clock icon" 같은)은 들리지 않아야 합니다 |

### 명령 팔레트

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| P1 | `Cmd+K`(macOS) 또는 `Ctrl+K` | "Command palette, dialog"("명령 팔레트")와 설명 "Jump to a page, open a server or change preferences."가 들리고, 포커스는 콤보 상자 "Type a command or a server name"("명령이나 서버 이름을 입력하세요", expanded)에 있습니다 |
| P2 | 아래 화살표 두세 번 | 입력칸에 포커스를 둔 채 선택 항목이 바뀔 때마다 그 항목 이름이 들립니다(aria-activedescendant). 그룹 이름 "Go to"("이동")가 첫 항목과 함께 들리면 좋아요 |
| P3 | 없는 말 입력(예: `zzzz`) | "No commands match"("일치하는 명령이 없습니다")가 들립니다 |
| P4 | `Esc` | 대화상자가 닫히고 포커스가 열기 전 위치로 돌아갑니다. 팔레트 버튼으로 열었으면 그 버튼이고, 아무 데도 포커스가 없을 때 단축키로 열었으면 문서 처음(body)입니다 |
| P5 | 팔레트가 열린 채 `Tab`을 여러 번 | 포커스가 대화상자 밖으로 나가지 않습니다 |

### 토스트

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| T1 | Dashboard 머리의 "Refresh all" 누르기 | 끝나면 "Checked 3 HTTP servers, 3 online"("HTTP 서버 3개를 확인했습니다. 온라인 3개")이 포커스를 옮기지 않고 한 번 읽힙니다 |
| T2 | 토스트 영역으로 이동 | 영역 이름 "Notifications alt+T"("알림 alt+T")가 들립니다. `Alt+T`로 토스트 영역에 갈 수 있어야 합니다 |

## 3. Dashboard `/`

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| D1 | 제목 목록 | 사이드바의 h2 "Servers"와 h3 "Registry", "Runtime" 뒤에 본문의 h1 "Servers"("서버"), h2 "Getting started"("시작하기", 숨기지 않았을 때)와 단계 h3, h2 "Recent checks"("최근 확인 기록"), h2 "Runtime servers"("런타임 서버")가 나옵니다. 수준을 건너뛰지 않습니다 |
| D2 | 시작하기 진행 막대 | "Getting started, progress bar, 1 of 4 done"처럼 값 글자(aria-valuetext)가 들립니다 |
| D3 | 시작하기 "Hide" 버튼 | 이름은 "Hide Getting started"("시작하기 숨기기")입니다. 누르면 포커스가 "Show getting started" 버튼으로 옮겨 가고, 다시 누르면 시작하기 제목으로 돌아옵니다 |
| D4 | 지표 영역(region "Dashboard", "대시보드") | "HTTP reachable 3 of 3" 같은 숫자와 설명이 한 묶음으로 읽힙니다 |
| D5 | 서버 표 "Registered servers" | 표 탐색(VO는 `VO+화살표`, NVDA는 `Ctrl+Alt+화살표`)으로 열 머리글(Status, Server, Transport, Tools, p50, Last check, Actions)이 셀과 함께 들립니다 |
| D6 | 지연 스파크라인 셀 | "starter-mcp-http, p50 140 ms over the last 3 checks, scale 0 to 200 ms, image". 눈금 값이 화면 아래 설명("Same scale for every row: 0 to 200 ms")과 같아야 합니다 |
| D7 | 오프라인 서버(서버 하나를 끈 뒤 Retry) | 행 아래 경고의 제목과 복구 명령이 들리고, Retry 결과가 토스트로 읽힙니다 |
| D8 | Recent checks 목록 | role log이지만 aria-live가 꺼져 있어 30초마다 새 줄이 생겨도 저절로 읽히지 않아야 합니다(소음 방지) |

## 4. Inspector `/inspector?server=starter-mcp-http`

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| I1 | 제목과 랜드마크 | h1 "Inspector"(EN은 화면에 숨김, KO는 "인스펙터"), 고른 도구 이름 h2. region "Tools"("도구"), "Request"("요청"), "Response"("응답"), "Inspector panel"("Inspector 패널", 도킹 패널), "JSON-RPC log"("JSON-RPC 로그") |
| I2 | 도구 목록에서 `echo` 고르기 | 선택한 항목이 "selected"로 들리고, 요청 영역 제목이 `echo`로 바뀝니다 |
| I3 | 인자 칸 | "text, required, edit text"처럼 이름과 필수 여부가 들리고, 설명 "Text to echo. Must not be empty."가 설명으로 읽힙니다(이중 역따옴표 같은 기호가 읽히지 않아야 합니다) |
| I4 | Run(`Cmd+Enter`) | 처음에는 상태 영역이 "Ready"("준비됨")입니다. 실행 중에는 1초에 한 번 "Running 1 s"("실행 중 1 s") 정도로만 바뀌고, 끝나면 "Finished in 12 ms"("12 ms에 끝남")가 한 번 읽힙니다. 0.1초마다 읽히면 실패입니다 |
| I5 | Reset 버튼 | 폭이 좁아 아이콘만 남아도 이름 "Reset"("초기화")이 들립니다 |
| I6 | 응답 탭(Content, Timing) | "tab, 1 of 2, selected". 화살표로 탭을 바꿔요 |
| I7 | NL2SQL Mock 응답(`nl2sql-mcp-http`의 `run_sql_query`) | 응답 위의 안내 "Mock sample data"와 서버 안내문이 읽힙니다 |
| I8 | 도킹 패널 크기 핸들 | "Resize panel, separator"("패널 높이 조절")와 현재 값이 들리고 위아래 화살표로 값이 바뀌어 읽힙니다 |
| I9 | JSON-RPC 로그 영역 | region 이름이 들리고, 새 줄이 생겨도 저절로 읽히지 않습니다 |

## 5. Chat `/chat?server=mock-repo-mcp`

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| C1 | 제목과 랜드마크 | 사이드바의 h2 "Conversations"("대화")와 "Tools exposed to the model"("모델에 공개할 도구"), 본문의 h1 "Chat"("채팅", 화면에는 숨김), h2 "Conversation"("대화 내용", 숨김), 빈 화면의 h2 "Ask about your data", h2 "Trace"("실행 추적"), 도구 카드 h3. region "Conversations", "Trace", "Span details"("스팬 상세") |
| C2 | 대화 목록이 빈 상태 | "No saved conversations yet. Your chats are saved here automatically." |
| C3 | 툴바 | Model(콤보 상자, 현재 모델 이름), Max iterations(숫자 칸, 1~20), Approval(라디오 그룹 "Auto, Manual", 화살표로 이동), Token usage(그룹, "in 0 out 0"), "Clear chat" 버튼 순서로 들립니다 |
| C4 | 입력칸에 `[[tool:list_repositories]] [[sleep:1500]]` 입력 후 Enter | 상태 영역이 "The model is working.", "Calling list_repositories.", "The model is working.", "Response complete."("모델이 작업 중입니다.", "list_repositories 도구를 호출하는 중입니다.", "응답이 끝났습니다.")를 차례로 한 번씩 읽고, 저장되면 "1 conversation"("대화 1개")이 이어집니다. 글자가 흘러나올 때마다 읽히면 실패입니다(대화 영역은 role log, aria-live off) |
| C5 | C4 실행 중 대화 목록 | 첫 실행 동안 목록 맨 위에 "Running, Saved when the run ends" 행이 현재 항목(aria-current)으로 읽히고, 끝나면 저장된 대화 행으로 바뀝니다 |
| C6 | 실행 중 `Esc` | 실행이 멈추고 "Response stopped."가 읽히며 포커스는 입력칸에 남아요 |
| C7 | 끝난 답변 읽기 | 도구 카드 그룹 "Tool call mock-repo-mcp / list_repositories"와 상태 "done", 답변 본문, 푸터(시간, 도구 호출 수)가 순서대로 읽힙니다 |
| C8 | Markdown 표가 있는 답변 | 표 앞의 region "Table, scrolls sideways when wider than the conversation"이 들리고, `Tab`으로 그 영역에 포커스가 가며 좌우 화살표로 가로 스크롤돼요 |
| C9 | Approval을 Manual로 바꾸고 다시 보내기 | 상태 영역이 "list_repositories is waiting for your approval."("list_repositories 도구가 승인을 기다리고 있습니다.")을 읽고, 승인 카드 그룹 "Waiting for your approval"("승인을 기다리는 중") 안의 Approve, Deny 버튼으로 바로 이동할 수 있습니다 |
| C10 | Approve | 실행이 이어지고 C4와 같은 순서로 읽힙니다. 거부하면 카드 상태가 "denied"로 바뀌어 읽힙니다 |
| C11 | 대화 행의 더보기 메뉴 | "Actions for <제목>, menu button". 메뉴 항목 Rename, Export, Delete가 들리고 `Esc`로 닫으면 버튼으로 돌아옵니다 |
| C12 | Rename 대화상자 | 대화상자 이름 "Rename conversation"과 입력칸 이름이 들리고, 저장 뒤 "Conversation renamed" 토스트가 읽힙니다 |
| C13 | Trace 패널 | region "Trace", 워터폴 목록(listbox "Turn 1: ...")의 항목이 이름과 시간으로 읽히고, 항목을 고르면 region "Span details"에 상세가 나옵니다 |

## 6. Settings `/settings`

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| E1 | 제목 목록 | h1 "Settings"("설정"), 섹션 h2 6개(LLM provider and model, API keys, Appearance and language, Onboarding, Local data, About). API keys 안의 경고 h3 "Keys are stored in this browser, in plain text"가 h2 아래에 옵니다 |
| E2 | 섹션 내비게이션 | navigation "Sections"("섹션"). 링크를 누르면 해당 섹션 제목으로 이동해요 |
| E3 | 섹션 머리의 상태 칩 | 저장이 필요한 섹션은 평소 "Applies on Save"("저장 시 적용"), 값을 바꾸면 그 섹션만 "Unsaved"("저장 안 함")로 읽힙니다. 아래 저장 막대의 "Unsaved changes"와 서로 맞아야 합니다 |
| E4 | API 키 칸 | "Anthropic API key, secure edit text". 보기 버튼은 "Show Anthropic API key"이고 누르면 "Hide ..."로 이름이 바뀝니다 |
| E5 | OpenRouter 모델 칸 | 설명에 예시 ID(`anthropic/claude-sonnet-4.6` 등)가 읽힙니다 |
| E6 | 저장(`Cmd+S`) | "Saved 20:31:05"("20:31:05에 저장됨") 토스트가 읽히고 저장 막대의 상태(role status)가 "No unsaved changes"가 됩니다 |
| E7 | "Reset settings" 확인 대화상자 | 대화상자 제목 "Reset settings?"와 설명이 열리자마자 읽히고, 포커스는 취소 쪽에 있습니다. `Esc`로 닫으면 누른 버튼으로 돌아갑니다 |

## 7. 모바일 폭(390px)

| # | 동작 | 기대 발화와 확인할 점 |
|---|---|---|
| M1 | 랜드마크 목록 | 하단 탭바 navigation "Views"가 들리고 활동 바는 없습니다 |
| M2 | 타이틀바 "Open menu" | 드로어 대화상자 "Menu"("메뉴")가 열리고 "Close menu" 버튼이 들립니다. 닫으면 메뉴 버튼으로 돌아갑니다 |
| M3 | Chat 하단 세그먼트(Thread, Trace) | 탭처럼 하나만 선택되어 읽히고 전환 뒤 해당 영역 제목이 들립니다 |
| M4 | Inspector 도킹 패널 | 기본으로 접혀 있고, 탭을 누르면 그 탭으로 펼쳐졌다는 상태(expanded)가 들립니다 |

## 8. 자동 사전 점검 결과

사람이 점검하기 전에 Playwright(Chromium)로 접근성 트리를 미리 훑었습니다. 대상은 개발 서버(`CHAT_MOCK_LLM=1`)의 네 화면을 1440px, EN과 KO로 연 상태이고, 스크립트는 화면마다 랜드마크와 이름, 제목 수준, 라이브 영역(`aria-live`, role status, log, alert)을 모으고 `ariaSnapshot()`을 남깁니다. 팔레트와 서버 추가 대화상자는 열어서 포커스 위치와 바깥 요소의 `aria-hidden`을 보고, Chat은 가짜 LLM 실행과 수동 승인 동안 라이브 영역에 들어온 문장을 MutationObserver로 기록했어요. 자동 점검은 "무엇이 읽힐 재료가 있는가"까지만 알려 주고 실제 발화 순서와 억양은 2~7절에서 사람이 확인해야 해요.

| 항목 | 결과 |
|---|---|
| 랜드마크 | Dashboard 14개, Inspector 15개, Chat 10개, Settings 15개. 이름 없는 region 0개, 같은 역할과 이름이 겹치는 랜드마크 0개 |
| 제목 | 네 화면 모두 수준 건너뜀 0건. 사이드바가 본문보다 앞에 있어 h2 "Servers"가 h1보다 먼저 나오는데, 셸 구조상 의도된 순서예요 |
| 라이브 영역 | Chat 실행: "The model is working.", "Calling list_repositories.", "The model is working.", "Response complete.", "1 conversation" 순서로 한 번씩 들어왔고 스트리밍 글자는 들어오지 않았습니다. 수동 승인: "list_repositories is waiting for your approval." KO도 같은 순서예요 |
| 승인 카드 | 그룹 "Tool call mock-repo-mcp / list_repositories"와 "Waiting for your approval"이 이름을 갖고, 안에 Approve와 Deny 버튼이 있습니다 |
| 명령 팔레트 | 대화상자 이름과 설명이 있고, 포커스는 콤보 상자(expanded, `aria-controls` 있음)이며 아래 화살표에 `aria-activedescendant`가 바뀝니다. 버튼으로 열고 `Esc`로 닫으면 버튼으로 돌아옵니다 |
| 서버 추가 대화상자 | 이름 "Add runtime server", 포커스는 URL 입력칸, 셸 영역은 `aria-hidden` 처리됩니다 |

사전 점검에서 찾아 이번 묶음에서 고친 것입니다.

| 찾은 것 | 고친 내용 |
|---|---|
| Chat 화면의 사이드바(complementary)가 대화 목록을 담는데도 "Server explorer"로 읽힘 | 탐색기가 아닌 사이드바는 "Sidebar"("사이드바")로 읽히게 바꿨습니다(모바일 드로어 설명도 같음) |
| 토스트 영역 이름이 KO에서도 "Notifications alt+T" | `containerAriaLabel`을 사전 값으로 넘겨 KO는 "알림 alt+T"가 됩니다 |
| Inspector 도킹 패널 region 이름이 "Panel"("패널")뿐이라 랜드마크 목록에서 무엇인지 알기 어려움 | "Inspector panel"("Inspector 패널")로 바꿨습니다 |
| Chat 첫 실행 동안 대화 목록이 "No saved conversations yet"을 읽음 | 실행 중인 대화가 "Running" 행(aria-current)으로 보이게 했습니다(C5) |
| Markdown 표가 넓으면 오른쪽이 잘려 키보드로 볼 방법이 불분명 | 표를 이름 있는 region(포커스 가능, 가로 스크롤)으로 감쌌습니다(C8) |

남은 관찰입니다. 사람이 들어 보고 판단해 주세요.

| 관찰 | 메모 |
|---|---|
| 대화상자에 `aria-modal`이 없음 | Base UI가 바깥 요소에 `aria-hidden`을 다는 방식이라 VoiceOver와 NVDA의 가상 커서도 대화상자 안에 머물러야 합니다. 서버 추가 대화상자를 연 동안 "Recent checks" 기록과 토스트 영역은 트리에 남아 있었는데(포커스를 돌려줄 다음 요소를 남기는 Base UI 동작), 가상 커서로 거기까지 나갈 수 있는지 확인이 필요합니다 |
| Chat에서 "Getting started: 2 of 4 done"이 실행 중에 함께 읽힘 | 시작하기 단계가 끝날 때 한 번만 나오는 의도된 알림이지만 Chat 상태 알림과 겹쳐 들릴 수 있습니다 |
| 저장 뒤 "1 conversation" | 대화 목록 개수 알림이 "Response complete." 바로 뒤에 붙습니다. 군더더기로 들리면 부분으로 적어 주세요 |
| 단축키로 팔레트를 열고 닫으면 포커스가 body | 열기 전 포커스가 없을 때의 정상 동작이지만, VoiceOver가 문서 처음부터 다시 읽는지 확인이 필요합니다 |

재현 스크립트는 저장소에 넣지 않았고, 같은 점검을 다시 하려면 `frontend/node_modules`의 Playwright로 위 항목(랜드마크, 제목, 라이브 영역, `ariaSnapshot()`)을 모으면 됩니다.

## 9. 결과 기록표

| 항목 | 스크린 리더와 브라우저 | 판정 | 들린 문장과 메모 |
|---|---|---|---|
| S1 | VoiceOver + Safari | | |
| S1 | NVDA + Chrome | | |
| (이어서) | | | |

부분과 실패 항목은 이슈 템플릿(`.github/ISSUE_TEMPLATE/bug_report.yml`)으로 올리고, 제목에 항목 번호(예: `[SR C4]`)를 붙여 주면 재현과 수정이 빨라집니다.
