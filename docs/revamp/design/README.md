# docs/revamp/design

Phase 3(테스트 화면 디자인 시안) 산출물입니다. 결정 내용과 Phase 4 반영 가이드는 [../design-decision.md](../design-decision.md)에 있습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `final.html` | **화면 정본.** 확정 시안(A 셸과 Inspector, B Getting started, C 워터폴 Chat). Phase 4는 이 파일을 기준으로 구현합니다 |
| `tokens.css` | **값 정본.** 디자인 토큰. 다른 HTML의 `@tokens` 표식 사이에 인라인되는 원본입니다 |
| `tokens.md` | 토큰 원칙, 시안별 차이, shadcn 매핑, 대비 검사 근거 |
| `tokens.html` | 토큰 미리보기(시안 탭, 테마 토글, 실시간 대비비). `--chart-6`과 `--span-*` 견본은 아직 없습니다 |
| `comparison.html` | 시안 비교 페이지(와이어프레임, 10개 기준 매트릭스, 섞어 쓰기 가이드, 추천안, 선택기) |
| `concept-a-console.html` | 시안 A "Console" 원본(청록, IDE형) |
| `concept-b-studio.html` | 시안 B "Studio" 원본(인디고, SaaS형) |
| `concept-c-workbench.html` | 시안 C "Workbench" 원본(앰버, 실행 추적형) |
| `qa-report.md` | 3-5 교차 QA 보고서(폭 5종, 테마 4종, EN/KO, axe) |
| `scripts/` | 아래 스크립트 3종 |

HTML 파일은 claude.ai Artifact 계약을 따르므로 `<html>`, `<head>`, `<body>` 태그가 없습니다. 직접 열면 doctype이 없어 quirks 모드로 그려질 수 있으므로, QA는 `qa_check.mjs`가 doctype과 viewport를 붙인 사본으로 돌립니다.

## Artifact 링크 (비공개)

소유자 계정으로 로그인해야 열립니다. 링크는 게시 시점 사본이고, 이 디렉터리의 HTML이 정본입니다. 링크 뒤에 `#dashboard`, `#inspector`, `#chat`을 붙이면 해당 화면이 열려요.

| 대상 | 링크 |
|---|---|
| 확정 시안 | https://claude.ai/artifact/WzcGij7UahFnYxmZgaRsEj |
| 비교 페이지 | https://claude.ai/artifact/91omN7JkAvy5oq9XEhXyyF |
| 시안 A | https://claude.ai/artifact/AvReiikRfF9JWrUdTjgMVu |
| 시안 B | https://claude.ai/artifact/DyKWeEBpLKih7NcjnWHMqY |
| 시안 C | https://claude.ai/artifact/5cvnogU3JEZdoDrxmAbM2u |
| 토큰 미리보기 | https://claude.ai/artifact/LbQjQA6a1w3awU4CsoPWRt |

## 스크립트

저장소 루트에서 실행합니다.

```bash
# WCAG 대비 검사: tokens.css를 직접 파싱, 표준 라이브러리만 사용, 미달 시 종료 코드 1
python3 docs/revamp/design/scripts/check_contrast.py [--hex] [--markdown]

# tokens.css를 고친 뒤 HTML의 인라인 사본 갱신
python3 docs/revamp/design/scripts/inline_tokens.py docs/revamp/design/tokens.html docs/revamp/design/final.html ...

# QA 매트릭스: Playwright와 axe-core를 frontend/node_modules에서 불러옴, 결과와 스크린샷은 저장소 밖에 저장
node docs/revamp/design/scripts/qa_check.mjs --out "$TMPDIR/mcpc-qa" [--files a,b,c,t,f] [--widths 390,1280] [--no-shots]
```

토큰을 바꾸는 순서는 `tokens.css` 수정, `check_contrast.py` 통과 확인, `inline_tokens.py`로 HTML 갱신, `qa_check.mjs` 재검사입니다.
