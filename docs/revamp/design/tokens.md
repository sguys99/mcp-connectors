# MCP Connectors 디자인 토큰 (Phase 3 초안)

> 상태: 3-1 공통 디자인 토큰 초안 (2026-10-22). 시안 A/B/C가 이 토큰을 공유하고, 시안 확정 후 Phase 4에서 `frontend/src/styles/globals.css`로 옮깁니다.

| 파일 | 역할 |
|---|---|
| [tokens.css](tokens.css) | 정본. 시안 HTML의 `<style>`에 그대로 인라인합니다 |
| [tokens.html](tokens.html) | 미리보기 페이지. 시안 탭, 테마 토글, 스와치와 실시간 대비비 |
| [scripts/check_contrast.py](scripts/check_contrast.py) | tokens.css를 직접 읽어 WCAG 대비를 검사합니다(표준 라이브러리만 사용) |
| [scripts/inline_tokens.py](scripts/inline_tokens.py) | tokens.css를 HTML의 `@tokens` 표식 사이에 다시 넣습니다 |

## 1. 원칙

1. **구조는 공통, 성격은 소수 토큰으로.** 간격, 라운드 비율, 그림자, 타입 스케일, 모션, z-index, 의미 색, 구문 강조 색, 중립색 명도 단계는 세 시안이 같습니다. 시안마다 바뀌는 것은 브랜드 색, 중립색 색조(`--neutral-hue`), 서체 3종, 기본 라운드(`--radius`)뿐입니다. 그래서 "B의 대시보드에 A의 색"처럼 섞는 일이 블록 복사 수준으로 끝나요.
2. **단계 이름과 역할 이름을 나눕니다.** `--n-0`부터 `--n-1000`까지는 단계(원료)이고, 컴포넌트는 `--bg`, `--surface`, `--fg-muted`, `--line-strong` 같은 역할 이름만 씁니다. 테마 전환은 역할 이름이 가리키는 단계를 바꾸는 일입니다.
3. **브랜드와 상태 색을 섞지 않습니다.** 브랜드는 `--brand-*`, 상태는 `--success-*`, `--warning-*`, `--danger-*`, `--info-*`입니다. 브랜드와 색조가 가까운 상태 색은 시안별로 색조를 옮깁니다(B의 info, C의 warning).
4. **shadcn 이름과 충돌하지 않게 짓습니다.** shadcn의 `--accent`는 hover 면을 뜻하므로 브랜드를 `--accent`라고 부르지 않습니다. 같은 이유로 구분선은 `--line`, 입력 경계는 `--line-strong`, 포커스는 `--focus-ring`입니다. Phase 4에서 `--border: var(--line)`처럼 자기 참조 없이 대입할 수 있습니다.
5. **숫자는 모두 검증합니다.** 색은 oklch로 쓰고, 대비비는 스크립트가 tokens.css를 직접 파싱해 계산합니다. 손으로 옮긴 표가 아니라서 값을 바꾸면 결과도 그대로 따라옵니다.

## 2. 테마 구조와 시안 A의 다크 우선 처리

tokens.css는 Artifact 계약 그대로 라이트 우선 구조 하나만 가집니다.

```css
:root { /* 공통 구조 + 라이트 값 전부 */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* 다크 값 */ } }
:root[data-theme="dark"] { /* 같은 다크 값 */ }
:root[data-concept="a"] { /* 시안 A 라이트 브랜드, 서체, 라운드 */ }
@media (prefers-color-scheme: dark) { :root[data-concept="a"]:not([data-theme="light"]) { /* A 다크 브랜드 */ } }
:root[data-concept="a"][data-theme="dark"] { /* 같은 A 다크 브랜드 */ }
```

시안 A의 다크 우선은 CSS를 뒤집지 않고 **페이지 기본값**으로 처리합니다. A 시안 페이지는 맨 앞 인라인 스크립트에서 `data-concept="a"`를 넣고, 저장된 테마 선택이 없으면 `data-theme="dark"`도 함께 넣습니다. 뷰어가 Light나 System을 고르면 그 선택을 따릅니다.

이 방식을 고른 근거는 다음과 같습니다.

- **값이 한 곳에만 있습니다.** CSS를 시안 A만 거울 구조로 뒤집으면 라이트와 다크 블록이 각각 세 번씩 나와 같은 값을 여섯 군데에서 맞춰야 합니다. 지금 구조는 라이트 1회, 다크 2회(계약상 필수)입니다.
- **System의 의미가 유지됩니다.** CSS를 뒤집어도 `prefers-color-scheme`은 항상 light나 dark로 답하므로, OS가 라이트인 사용자에게는 결국 라이트가 나옵니다. 실제로 "처음 열면 다크"를 보장하는 수단은 기본 `data-theme`뿐입니다.
- **Phase 4로 그대로 옮겨집니다.** next-themes의 `defaultTheme="dark"`(A) 또는 `"system"`(B, C)과 1:1로 대응합니다.
- `data-concept` 자체도 스크립트로 넣기 때문에(Artifact에서는 `<html>` 태그를 직접 쓸 수 없음) 스크립트 의존이 새로 늘지 않습니다.

시안 HTML 맨 위 예시입니다.

```html
<title>MCP Connectors Console</title>
<meta name="claude:viewport-fit-sides" content="cover">
<script>
  document.documentElement.dataset.concept = "a";
  try { if (!localStorage.getItem("mcpc-theme")) document.documentElement.dataset.theme = "dark"; }
  catch (e) { document.documentElement.dataset.theme = "dark"; }
</script>
<link rel="stylesheet" href="(시안 A Google Fonts URL)">
<style>/* @tokens:start */ ... /* @tokens:end */ ...</style>
```

B와 C는 `data-theme`을 넣지 않고 시스템 설정을 따릅니다.

3-7 확정안(final.html)은 시안 A의 셸과 브랜드를 쓰지만 이 다크 강제를 없앴습니다. 저장된 선택이 없으면 `data-theme`을 붙이지 않고 시스템 설정을 따릅니다.

## 3. 공통 토큰

### 3.1 간격, 크기, 라운드

| 토큰 | 값 | 비고 |
|---|---|---|
| `--space-0-5` ~ `--space-16` | 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64px | 4px 격자, 이름은 Tailwind 단위(`--space-4` = 16px) |
| `--control-h-sm/md/lg` | 28 / 32 / 40px | 버튼, 입력 높이 |
| `--touch-min` | 44px | 모바일 터치 대상 최소 크기 |
| `--header-h`, `--sidebar-w`, `--content-max` | 48px, 248px, 1280px | 레이아웃 기준 |
| `--radius-xs/sm/md/lg/xl` | `--radius`의 0.5, 0.75, 1, 1.5, 2배 | 시안이 `--radius`만 바꿉니다 |
| `--radius-full` | 9999px | 배지, 상태 점 |

### 3.2 타입 스케일

| 토큰 | 크기 / 행간 | 주 용도 |
|---|---|---|
| `--text-4xl` | 36 / 44px | 페이지 제목(드물게) |
| `--text-3xl` | 30 / 38px | 화면 제목 |
| `--text-2xl` | 24 / 32px | 섹션 제목 |
| `--text-xl` | 20 / 30px | 패널 제목 |
| `--text-lg` | 18 / 28px | 카드 제목 |
| `--text-md` | 16 / 26px | 채팅 본문, 설명 |
| `--text-base` | 14 / 22px | 기본 UI 본문 |
| `--text-sm` | 13 / 20px | 표, 코드, 보조 정보 |
| `--text-xs` | 12 / 18px | 레이블, 로그 |
| `--text-2xs` | 11 / 16px | 캡션, 단축키 |

굵기는 `--weight-regular/medium/semibold/bold`(400, 500, 600, 700), 자간은 `--tracking-tight`(-0.015em, 제목), `--tracking-caps`(0.06em, 대문자 레이블)입니다. 기본 본문이 14px인 이유는 하루 종일 켜 두는 개발 도구라서 정보 밀도를 우선했기 때문입니다. 한국어가 섞여도 행간이 1.5 이상이 되도록 행간 값을 잡았고, tokens.css 기본 블록이 `:lang(ko)`에 `word-break: keep-all`을 겁니다.

### 3.3 그림자, 모션, z-index

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--shadow-xs` | 1px 2px, 6% | 1px 2px, 30% | 세그먼트, 칩 |
| `--shadow-sm` | 1px 3px, 8% + 1px 2px, 4% | 36% + 24% | 카드 |
| `--shadow-md` | 4px 12px -2px, 10% | 45% | 드롭다운 |
| `--shadow-lg` | 12px 32px -8px, 16% | 55% | 팝오버, 시트 |
| `--shadow-xl` | 24px 64px -12px, 24% | 65% | 다이얼로그 |

라이트 그림자 색은 중립색 색조를 띤 `oklch(0.25 0.02 var(--neutral-hue))`, 다크는 검정입니다. 다크에서는 그림자가 잘 안 보이므로 면 단계(`--surface` < `--surface-raised`)로 높이를 표현합니다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--duration-instant/fast/base/slow` | 80 / 140 / 200 / 320ms | hover 색 / 누름, 토글 / 메뉴, 툴팁 / 시트, 패널 |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 일반 전환 |
| `--ease-enter`, `--ease-exit` | `(0, 0, 0.2, 1)`, `(0.4, 0, 1, 1)` | 등장, 퇴장 |
| `--ease-emphasized` | `(0.3, 0, 0, 1.15)` | 시트처럼 큰 움직임 |

`prefers-reduced-motion: reduce`이면 지속 시간 4개가 모두 0ms가 됩니다. 컴포넌트가 지속 시간을 토큰으로만 쓰면 따로 처리할 필요가 없어요.

z-index는 `--z-base` 0, `--z-raised` 10, `--z-sticky` 100, `--z-sidebar` 200, `--z-dropdown` 1000, `--z-overlay` 1100, `--z-modal` 1200, `--z-popover` 1300, `--z-toast` 1400, `--z-tooltip` 1500입니다. 모달 안의 팝오버가 모달 위에 뜨도록 popover를 modal보다 높게 두었습니다.

### 3.4 중립색 단계

L과 C는 고정이고 H만 시안의 `--neutral-hue`를 따릅니다. 순수 회색 대신 브랜드 쪽으로 살짝 기운 회색이 됩니다.

| 단계 | L | C | A (H 215) | B (H 275) | C (H 70) |
|---|---|---|---|---|---|
| `--n-0` | 0.995 | 0.002 | #fcfefe | #fdfdff | #fefdfc |
| `--n-25` | 0.985 | 0.003 | #f8fbfb | #f9fafc | #fbfaf8 |
| `--n-50` | 0.972 | 0.004 | #f3f6f7 | #f5f6f8 | #f7f5f3 |
| `--n-100` | 0.952 | 0.006 | #ebf0f2 | #eeeff3 | #f2eeeb |
| `--n-150` | 0.928 | 0.007 | #e2e8ea | #e6e7ec | #eae6e2 |
| `--n-200` | 0.900 | 0.009 | #d8e0e2 | #dcdee4 | #e2ddd8 |
| `--n-300` | 0.840 | 0.011 | #c3cccf | #c8cad2 | #cfc9c3 |
| `--n-400` | 0.720 | 0.014 | #9ba7aa | #a2a4ae | #aaa39b |
| `--n-450` | 0.640 | 0.015 | #828f92 | #898c96 | #928b83 |
| `--n-500` | 0.560 | 0.016 | #6a777a | #71747e | #7b736b |
| `--n-600` | 0.470 | 0.016 | #515d60 | #585a64 | #615951 |
| `--n-700` | 0.380 | 0.015 | #3a4547 | #40424b | #48413a |
| `--n-750` | 0.320 | 0.014 | #2b3537 | #31323a | #38322b |
| `--n-800` | 0.275 | 0.013 | #21292c | #26272e | #2c2721 |
| `--n-850` | 0.240 | 0.012 | #192123 | #1d1f25 | #231e19 |
| `--n-900` | 0.210 | 0.011 | #131a1b | #17181d | #1c1713 |
| `--n-950` | 0.180 | 0.010 | #0d1314 | #101116 | #15110d |
| `--n-1000` | 0.150 | 0.009 | #070c0e | #0a0b0f | #0e0b07 |

`--n-450`은 라이트 입력 경계가 3:1을 넘도록, `--n-600`은 라이트 보조 텍스트가 4.5:1을 넘도록 넣은 단계입니다. C의 라이트 배경은 채도가 0.003 이하라서 크림색처럼 보이지 않습니다.

### 3.5 면과 텍스트 역할

| 역할 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--bg` | n-25 | n-950 | 페이지 |
| `--bg-subtle` | n-50 | n-1000 | 사이드바, 표 머리 |
| `--surface` | n-0 | n-900 | 카드, 패널 |
| `--surface-raised` | n-0 (+그림자) | n-850 | 팝오버, 다이얼로그 |
| `--surface-sunken` | n-50 | n-1000 | 코드, JSON, 로그 |
| `--surface-hover` / `--surface-active` | n-100 / n-150 | n-800 / n-750 | hover / 눌림, 선택 행 |
| `--line` | n-150 | n-800 | 장식용 구분선 |
| `--line-strong` | n-450 | n-500 | 입력, 체크박스 경계(3:1) |
| `--fg` | n-1000 | n-25 | 본문 |
| `--fg-muted` | n-600 | n-400 | 보조 텍스트, placeholder |
| `--fg-subtle` | n-450 | n-500 | 아이콘, 비활성, 큰 텍스트 전용 |
| `--inverse` / `--fg-on-inverse` | n-900 / n-0 | n-100 / n-1000 | 툴팁, 토스트 |
| `--overlay` | 중립색 45% | 검정 60% | 모달 뒤 막 |

### 3.6 의미 색

각 색은 다섯 단계입니다. `fg`는 텍스트, `bg`는 옅은 면, `border`는 경계(3:1), `solid`는 상태 점과 채운 배지, `solid-fg`는 solid 위 글자입니다.

| 색 | 색조 | 라이트 fg / bg / border / solid | 다크 fg / bg / border / solid |
|---|---|---|---|
| success | 150 | #0f6a31 / #e5f9e8 / #429c5a / #17843f | #7cd591 / #152d1a / #3b834e / #53be70 |
| warning | 62 (C는 48) | #934a06 / #fff2de / #c77618 / #d27908 | #f9b96c / #392310 / #a86a2c / #f6a14f |
| danger | 25 | #b02a2d / #ffeeec / #de4e4b / #c92f33 | #ff958d / #3d1b18 / #c34f4b / #ef6661 |
| info | 245 (B는 232) | #00629d / #e8f4ff / #348dcf / #0071b3 | #86c5fa / #12283b / #337ab0 / #5eaceb |

`solid-fg`는 라이트에서 success, danger, info가 흰색(n-0), warning이 검정(n-1000)이고 다크에서는 모두 n-1000입니다. 주황 위의 흰 글자는 대비가 모자라기 때문입니다. 상태는 색만으로 전달하지 않고 아이콘이나 글자(`Connected`, `[MASS_SCAN_BLOCKED]`)를 함께 씁니다(WCAG 1.4.1).

### 3.7 JSON 구문 강조와 로그 레벨

| 토큰 | 라이트 | 다크 | 비고 |
|---|---|---|---|
| `--syntax-key` | #215da5 | #80c7f8 | 파랑 |
| `--syntax-string` | #1d7339 | #80d58d | 초록 |
| `--syntax-number` | #ab4500 | #f6ab6b | 주황 |
| `--syntax-boolean` | #92318d | #e698df | 자홍 |
| `--syntax-null` | 중립 L 0.52 | 중립 L 0.68 | 기울임꼴 권장 |
| `--syntax-punct` | `--fg-muted` | `--fg-muted` | 괄호, 쉼표 |
| `--log-debug` | `--fg-muted` | | |
| `--log-info` / `--log-warn` / `--log-error` | 의미 색 fg | | |
| `--log-request` | `--brand-text` | | JSON-RPC 요청(→) |
| `--log-response` | `--success-fg` | | JSON-RPC 응답(←) |

구문 색은 세 시안이 같습니다. 코드 블록은 하루에도 수십 번 읽으므로 시안이 바뀌어도 같은 색이 같은 뜻을 갖는 편이 낫다고 판단했습니다.

### 3.8 차트

`--chart-1`은 시안의 브랜드(C 라이트만 더 진한 앰버 `#c67600`), `--chart-2`부터 `--chart-6`은 청록, 주황, 자홍, 파랑, 보라입니다. C는 주황이 앰버와 겹쳐서 `--chart-3`을 보라(`oklch(0.55 0.15 290)`)로 바꿉니다. `--chart-6`(라이트 `#795bbf`, 다크 `#aa95e8`)은 3-7 확정안에서 가드레일 스팬용으로 더했습니다.

### 3.9 트레이스 스팬 (3-7 추가)

확정안(final.html)의 Chat 실행 추적과 Inspector Timing 탭은 시안 C의 워터폴 하나를 같이 씁니다. 스팬 종류마다 색조를 45도 안팎으로 벌려 브랜드 청록과 도구 스팬이 겹치지 않게 했습니다.

| 토큰 | 값 | A 라이트 | A 다크 | 쓰임 |
|---|---|---|---|---|
| `--span-llm` | `var(--chart-1)` | `#007781` | `#37d6dd` | LLM 호출 (브랜드) |
| `--span-tool` | `var(--chart-4)` | `#b53e95` | `#de73bd` | 도구 호출 (자홍) |
| `--span-guard` | `var(--chart-6)` | `#795bbf` | `#aa95e8` | 가드레일 (보라) |
| `--span-proxy` | `var(--chart-5)` | `#0c82bf` | `#55aee8` | 프록시, 업스트림, DB (파랑) |
| `--span-err` | `var(--danger-solid)` | `#c92f33` | `#ef6661` | 오류, 거부 |
| `--span-wait` | `var(--warning-border)` | `#c77618` | `#a86a2c` | 승인 대기 (빗금으로 그림) |

스팬 토큰은 bare `:root`에만 있고 모두 테마를 따라 바뀌는 토큰을 가리킵니다. 그래서 다크 블록에 복사본이 없고, 시안 C처럼 페이지 `:root`에서 자기 값을 다시 정해도 다크 블록이 덮어쓰지 않아요. `--span-wait`은 처음에 `--warning-solid`로 잡았지만 라이트 `--surface-sunken` 위에서 2.99:1이라 `--warning-border`(3.22:1)로 바꿨습니다.

## 4. 시안별 차이

| 항목 | A "Console" | B "Studio" | C "Workbench" |
|---|---|---|---|
| 성격 | IDE형 개발 도구, 고밀도 | 정제된 SaaS, 넓은 여백 | 대화와 실행 추적, 따뜻함 |
| 기본 테마 | 다크 우선(페이지가 `data-theme="dark"`) | 라이트 우선, 시스템 따름 | 균형, 시스템 따름 |
| `--brand-hue` / `--neutral-hue` | 200 / 215 | 277 / 275 | 78 / 70 |
| `--brand` 라이트 | `oklch(0.52 0.095 205)` #007781 | `oklch(0.51 0.19 277)` #5051cf | `oklch(0.80 0.15 78)` #f2b036 |
| `--brand` 다크 | `oklch(0.80 0.125 200)` #37d6dd | `oklch(0.55 0.19 277)` #5a5edd | `oklch(0.80 0.15 78)` #f2b036 |
| `--brand-fg` | 라이트 흰색, 다크 n-1000 | 라이트와 다크 모두 흰색 | 라이트와 다크 모두 n-1000 |
| `--brand-text` 라이트 / 다크 | #006b74 / #55dae1 | #4e50c6 / #a9b4ff | #925512 / #f3bd5c |
| `--radius` | 4px | 8px | 10px |
| Display | JetBrains Mono | Geist | Bricolage Grotesque |
| Body | IBM Plex Sans | Geist | Atkinson Hyperlegible Next |
| Mono | JetBrains Mono | Geist Mono | Atkinson Hyperlegible Mono |
| 한국어 | IBM Plex Sans KR | Noto Sans KR | Gothic A1 |
| 의미 색 조정 | 없음 | info 245 → 232(하늘색 쪽) | warning 62 → 48(주황 쪽), chart-3 보라 |

서체 선택 근거입니다.

- **A**: 제목까지 JetBrains Mono로 써서 터미널과 에디터 감각을 만들고, 긴 설명은 IBM Plex Sans로 읽힘을 지킵니다. IBM Plex Sans KR이 같은 가족이라 한영 혼용 시 굵기와 높이가 잘 맞습니다.
- **B**: Geist 한 벌로 제목, 본문, 코드를 통일합니다. 현재 Frontend가 이미 `next/font`로 Geist를 쓰고 있어 Phase 4 전환 비용이 가장 낮습니다. 한국어는 굵기 폭이 넓은 Noto Sans KR입니다.
- **C**: Bricolage Grotesque는 광학 크기 축이 있어 큰 제목에서 개성이 살고, Atkinson Hyperlegible Next와 Mono는 저시력 사용자를 위해 설계된 서체라 `0O`, `1lI` 구분이 분명합니다. 한국어는 둥글지 않으면서 부드러운 Gothic A1을 짝지었습니다.

모든 패밀리는 `fonts.googleapis.com/css2`에서 200 응답으로 존재를 확인했습니다. 각 시안의 `<link>` URL은 tokens.css의 시안 블록 주석에 있습니다. Inter와 Space Grotesk는 쓰지 않습니다.

## 5. 사용 규칙

- 컴포넌트는 역할 토큰만 씁니다. `--n-*` 단계를 직접 쓰는 곳은 중립색 단계 표시 같은 문서 화면뿐이어야 합니다.
- 리터럴 색을 쓰지 않습니다. 반투명이 필요하면 `color-mix(in oklch, var(--fg) 12%, transparent)`처럼 토큰에서 만듭니다.
- 본문 크기 텍스트에는 `--fg-subtle`을 쓰지 않습니다. 3:1만 보장하는 값입니다.
- placeholder는 `--fg-muted`입니다. placeholder도 텍스트라서 4.5:1이 필요합니다.
- 포커스는 `:focus-visible`에 `--focus-ring` 2px 실선, 간격 2px입니다(tokens.css 기본 블록).
- 숫자 열에는 `font-variant-numeric: tabular-nums`를 씁니다.
- tokens.css를 고친 뒤에는 `python3 docs/revamp/design/scripts/check_contrast.py`로 검사하고, `python3 docs/revamp/design/scripts/inline_tokens.py docs/revamp/design/tokens.html (시안 HTML들)`로 인라인 사본을 갱신합니다.

## 6. shadcn 변수 매핑 (Phase 4)

`globals.css`의 `:root`와 `.dark`(또는 `[data-theme="dark"]`) 양쪽에 같은 대입을 둡니다. 값은 토큰이 테마에 따라 바꾸므로 대입 자체는 한 벌이면 됩니다.

| shadcn 변수 | 토큰 | 비고 |
|---|---|---|
| `--background` | `--bg` | |
| `--foreground` | `--fg` | |
| `--card` / `--card-foreground` | `--surface` / `--fg` | |
| `--popover` / `--popover-foreground` | `--surface-raised` / `--fg` | |
| `--primary` / `--primary-foreground` | `--brand` / `--brand-fg` | |
| `--secondary` / `--secondary-foreground` | `--surface-hover` / `--fg` | |
| `--muted` / `--muted-foreground` | `--bg-subtle` / `--fg-muted` | |
| `--accent` / `--accent-foreground` | `--surface-hover` / `--fg` | shadcn의 accent는 hover 면입니다. 브랜드가 아닙니다 |
| `--destructive` | `--danger-solid` | 그 위 글자는 `--danger-solid-fg` |
| `--border` | `--line` | 장식용 |
| `--input` | `--line-strong` | 입력 경계, 3:1 |
| `--ring` | `--focus-ring` | |
| `--chart-1` ~ `--chart-5` | `--chart-1` ~ `--chart-5` | 이름이 같으므로 tokens.css 값을 그대로 둡니다 |
| `--sidebar` / `--sidebar-foreground` | `--bg-subtle` / `--fg` | |
| `--sidebar-primary` / `--sidebar-primary-foreground` | `--brand` / `--brand-fg` | |
| `--sidebar-accent` / `--sidebar-accent-foreground` | `--surface-hover` / `--fg` | |
| `--sidebar-border` / `--sidebar-ring` | `--line` / `--focus-ring` | |
| `--radius` | `--radius` | 4px, 8px, 10px. shadcn의 `--radius-sm` 등 파생 계산은 그대로 둡니다 |

옮길 때 주의할 점은 세 가지입니다.

1. 현재 `@custom-variant dark (&:is(.dark *))`는 `.dark` 클래스를 봅니다. tokens.css는 `data-theme` 속성을 보므로 next-themes를 `attribute="data-theme"`로 쓰고 variant도 `[data-theme="dark"]` 기준으로 바꾸거나, 다크 블록 선택자를 `.dark`로 바꿔야 합니다. 시스템 설정을 따르는 미디어 쿼리 블록은 next-themes가 클래스를 직접 넣으므로 Phase 4에서는 빼도 됩니다.
2. `@theme inline`의 `--font-sans`, `--font-mono`, `--font-heading`은 `--font-body`, `--font-mono`, `--font-display`로 연결합니다. Google Fonts `<link>` 대신 `next/font/google`로 같은 패밀리를 불러옵니다.
3. 토큰 이름이 shadcn 변수와 겹치지 않으므로(`--line`, `--brand`, `--focus-ring`) `--border: var(--border)` 같은 자기 참조는 생기지 않습니다. 단 `--chart-*`와 `--radius`는 이름이 같아서 별도 대입 없이 tokens.css 값을 씁니다.

## 7. 접근성 근거와 대비 검사 결과

### 7.1 기준

| 대상 | 기준 | 근거 |
|---|---|---|
| 본문, 보조 텍스트, 링크, 배지 글자, 코드, 로그 | 4.5:1 | WCAG 2.2 SC 1.4.3 |
| 입력 경계, 포커스 링, 상태 점, 차트 막대, 의미 색 경계 | 3:1 | SC 1.4.11 비텍스트 대비 |
| 아이콘, 비활성, 18px 이상 굵은 글자(`--fg-subtle`) | 3:1 | SC 1.4.3 큰 텍스트 |
| 장식용 구분선(`--line`), 선택 외곽선(`--brand-border`) | 기준 없음 | 정보를 전달하지 않음 |
| 브랜드 버튼 면 대 배경 | 참고만 | 버튼은 글자 레이블로 식별되므로 SC 1.4.11의 경계 요구 대상이 아닙니다 |

### 7.2 계산 방법

`check_contrast.py`는 tokens.css를 파싱해 시안(a, b, c)과 테마(light, dark)마다 CSS 캐스케이드를 흉내 내고, `var()`와 단순 `calc()`를 풀어 최종 oklch 값을 얻습니다. oklch는 OKLab을 거쳐 선형 sRGB로 바꾸고, WCAG 상대 휘도로 대비비를 냅니다. sRGB 범위를 벗어나는 색은 두 방식(채널 자르기, 같은 L과 H에서 채도 줄이기)으로 모두 계산해 더 나쁜 값을 씁니다. 브라우저마다 범위 밖 색을 다루는 방식이 달라서 그렇습니다. 또 시스템 다크(미디어 쿼리)와 `data-theme="dark"`가 모든 색에서 같은 값으로 풀리는지도 확인합니다.

### 7.3 결과 (2026-10-22, 필수 630쌍, 미달 0건. 3-7에서 `--chart-6`과 스팬 150쌍 추가)

| 시안 | 테마 | 필수 검사 | 미달 | 최소 대비(본문 4.5 기준) | 최소 대비(UI 3.0 기준) |
|---|---|---:|---:|---|---|
| A Console | light | 105 | 0 | 4.68 (`--success-solid-fg` / `--success-solid`) | 3.09 (`--line-strong` / `--surface-sunken`) |
| A Console | dark | 105 | 0 | 5.98 (`--fg-muted` / `--surface-hover`) | 3.82 (`--fg-subtle` / `--surface`) |
| B Studio | light | 105 | 0 | 4.68 (`--success-solid-fg` / `--success-solid`) | 3.10 (`--warning-solid` / `--bg`) |
| B Studio | dark | 105 | 0 | 5.08 (`--brand-fg` / `--brand`) | 3.44 (`--chart-1` / `--surface`) |
| C Workbench | light | 105 | 0 | 4.68 (`--success-solid-fg` / `--success-solid`) | 3.11 (`--line-strong` / `--surface-sunken`) |
| C Workbench | dark | 105 | 0 | 5.98 (`--fg-muted` / `--surface-hover`) | 3.80 (`--fg-subtle` / `--surface`) |

그룹별 최솟값입니다.

| 검사 그룹 | 기준 | A light | A dark | B light | B dark | C light | C dark |
|---|---:|---:|---:|---:|---:|---:|---:|
| 본문 | 4.5 | 15.93 | 12.10 | 15.91 | 12.17 | 15.91 | 12.17 |
| 보조 텍스트 | 4.5 | 5.91 | 5.98 | 5.94 | 5.98 | 5.95 | 5.98 |
| 아이콘/큰 텍스트 | 3.0 | 3.21 | 3.82 | 3.23 | 3.80 | 3.23 | 3.80 |
| UI 경계 | 3.0 | 3.09 | 3.82 | 3.11 | 3.80 | 3.11 | 3.80 |
| 브랜드 | 4.5 | 5.16 | 8.01 | 5.57 | 5.08 | 5.31 | 8.04 |
| 차트 | 3.0 | 3.82 | 6.12 | 3.82 | 3.44 | 3.44 | 6.14 |
| 트레이스 스팬 | 3.0 | 3.22 | 4.01 | 3.22 | 3.44 | 3.21 | 3.98 |
| JSON 구문 | 4.5 | 5.06 | 6.16 | 5.09 | 6.15 | 5.09 | 6.15 |
| 로그 | 4.5 | 5.73 | 7.96 | 5.65 | 7.92 | 5.47 | 7.92 |
| 의미 색 텍스트 | 4.5 | 4.68 | 6.31 | 4.68 | 6.32 | 4.68 | 6.32 |
| 의미 색 경계/점 | 3.0 | 3.10 | 3.83 | 3.10 | 3.84 | 3.14 | 3.84 |
| 버튼 면(참고) | 3.0 | 5.01 | 9.92 | 5.87 | 3.44 | 1.82 | 9.33 |

### 7.4 고친 값

첫 실행에서 미달 6건이 나와 아래처럼 고쳤습니다.

| 토큰 (라이트, 공통) | 처음 | 수정 | 이유 |
|---|---|---|---|
| `--success-solid` | L 0.55 | L 0.54 | 흰 글자 대비 4.49 → 4.68 |
| `--warning-solid` | L 0.70 | L 0.66 | 배경 대비 2.66 → 3.10 (상태 점) |
| `--info-solid` | L 0.55 | L 0.53 | 범위 밖 색을 자르는 브라우저에서 B의 흰 글자 대비가 4.50으로 경계선이라 여유 확보 |

### 7.5 알려진 한계

- **C 라이트의 브랜드 버튼 면**은 배경 대비 1.82입니다. 앰버 특성상 밝은 면에서 피할 수 없습니다. 버튼 글자(`--brand-fg`, 10:1 이상)가 식별을 맡으므로 기준 위반은 아니지만, 보조 버튼처럼 글자 없이 면만으로 상태를 나타내는 용도(예: 토글 켜짐)에는 C 라이트에서 `--brand` 대신 `--focus-ring`(#b96a00)이나 `--brand-text`를 써야 합니다.
- **라이트 `--line-strong`**(3.09~3.11)과 의미 색 border(3.10~3.14)는 3:1을 겨우 넘깁니다. 더 연하게 바꾸면 미달이므로 시안에서 입력 경계를 이보다 옅게 덮어쓰지 마세요.
- 대비비는 sRGB 기준입니다. P3 디스플레이에서는 범위 밖 색이 더 선명하게 보일 수 있지만 휘도 차이는 작습니다.
- WCAG 2 대비비는 다크 테마의 밝은 글자를 실제보다 낮게 평가하는 경향이 있어 다크 값에는 여유를 더 두었습니다. APCA 검사는 이번 범위에 넣지 않았습니다.

## 8. 남은 일

- 시안 3종(3-2 ~ 3-4) 제작 시 각 HTML에 `@tokens` 표식을 두고 `inline_tokens.py`로 인라인합니다.
- 시안 확정 후 `docs/revamp/design-decision.md`에 고른 브랜드, 서체, 라운드를 기록하고 tokens.css에서 쓰지 않는 시안 블록을 정리합니다.
- Phase 4에서 `globals.css`로 옮길 때 6절의 주의점 세 가지를 따릅니다.
