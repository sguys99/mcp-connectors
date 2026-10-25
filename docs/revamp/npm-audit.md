# Frontend npm audit 기록 (Phase 2, P2-8)

기준일은 2026-10-22이고 대상은 `frontend/package-lock.json`입니다. 결정 사항에 따라 마이너/패치 업데이트까지만 적용했고, 메이저 업데이트(또는 다운그레이드)가 필요한 항목은 남겨 두고 사유를 적었습니다.

## 결과 요약

| 시점 | critical | high | moderate | low | 합계 |
|---|---|---|---|---|---|
| 작업 전 | 2 | 21 | 6 | 2 | 31 |
| 작업 후 (`npm audit`) | 0 | 9 | 2 | 0 | 11 |
| 작업 후 (`npm audit --omit=dev`) | 0 | 0 | 0 | 0 | 0 |

남은 11건은 모두 개발 도구(lint, shadcn CLI, Tailwind 플러그인)의 의존성이라 Docker 런타임 이미지와 브라우저 번들에는 들어가지 않습니다.

## 적용한 변경

- `npm audit fix` (`--force` 없이): `@modelcontextprotocol/sdk`, `vitest`, `vite`, `hono`, `ws`, `proxy-addr`, `js-yaml` 등 범위 안 패치/마이너 업데이트
- `next` 16.2.6 → 16.4.2, `eslint-config-next` 16.2.6 → 16.4.2 (마이너. 정확한 버전 고정이라 `audit fix`가 손대지 않아 직접 올렸습니다. critical이던 `next`, `postcss`, `sharp` 해소)
- `shadcn` CLI를 `dependencies`에서 `devDependencies`로 옮기고 4.22.1로 갱신 (`globals.css`의 `shadcn/tailwind.css` import는 빌드 단계에서만 쓰여요)
- 새 의존성: `yaml` (레지스트리 파싱, 런타임), `@tailwindcss/typography` (Chat Markdown, 개발)

## 남은 항목

| 패키지 | 심각도 | 경로 | 권고 수정 | 남긴 이유 |
|---|---|---|---|---|
| `braces` ≤3.0.3 ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)) | high | `micromatch` → `fast-glob` → `eslint-config-next`, `shadcn`(`@shadcn/registry`, `ts-morph`) | 없음 | 최신 `braces`가 3.0.3이라 패치 버전이 아직 없습니다. npm이 제안하는 `eslint-config-next@14.2.35`, `shadcn@1.0.0`은 메이저 다운그레이드라 Next 16, Tailwind v4와 맞지 않아요 |
| `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`, `@shadcn/registry`, `shadcn`, `ts-morph`, `@ts-morph/common` | high (8건) | 위 `braces` 한 건이 전파된 것 | 위와 같음 | `braces` 패치가 나오면 `npm audit fix`로 함께 풀립니다 |
| `postcss-selector-parser` <7.1.6 ([GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)) | moderate | `@tailwindcss/typography` (0.5.20이 6.0.10을 정확히 고정) | `@tailwindcss/typography@0.5.4` | 0.5.4는 다운그레이드이고 7.x로 override하면 메이저 변경이라 적용하지 않았습니다. 빌드 때 저장소 안 CSS만 처리하므로 외부 입력 경로가 없어요 |
| `@tailwindcss/typography` | moderate | 위 항목의 상위 | 위와 같음 | 위와 같음 |

## 다시 점검하는 방법

```bash
cd frontend
npm audit                # 전체
npm audit --omit=dev     # 런타임 의존성만 (0건 유지가 목표)
npm audit fix            # --force 없이. 메이저 변경은 별도 검토
```
