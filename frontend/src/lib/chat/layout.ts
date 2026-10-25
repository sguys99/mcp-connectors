// Chat 의 대화 열과 Trace 열 분할 (순수 함수). 폭 구간은 Inspector 와 같은 경계를 쓴다 (lib/inspector/layout.ts).
//
//   wide    1281px 이상   Trace 420px (--trace-w)
//   mid     1081 ~ 1280   Trace 340px
//   narrow  901 ~ 1080    Trace 340px
//   mobile  900px 이하    분할 없음. 대화 / 추적 세그먼트 탭
//
// 사용자가 끈 비율은 구간마다 따로 localStorage 에 저장한다 (키: mcpc-chat-panes-<band>).
// 핸들을 두 번 누르면 기본 크기로 돌아간다.

import type { SplitBand } from "@/lib/inspector/layout";

export const TRACE_STORAGE_PREFIX = "mcpc-chat-panes-";

export function tracePanesKey(band: SplitBand): string {
  return `${TRACE_STORAGE_PREFIX}${band}`;
}

// globals.css 의 --trace-w 기본값과 1280px 이하 값. CSS 변수를 읽을 수 있으면 그 값을 우선한다 (readTraceWidth).
export const TRACE_DEFAULT_PX: Record<SplitBand, number> = { wide: 420, mid: 340, narrow: 340 };

export const TRACE_MIN_PX = 280;
export const TRACE_MAX_PX = 640;
export const THREAD_MIN_PX = 360;

// 그룹 폭에서 기본 패널 크기(퍼센트 문자열)를 계산한다. 두 값의 합은 항상 100% 다.
export function traceDefaultSizes(tracePx: number, groupWidth: number): { thread: string; trace: string } {
  const width = Math.max(groupWidth, 1);
  const min = (TRACE_MIN_PX / width) * 100;
  const max = Math.min((TRACE_MAX_PX / width) * 100, 100 - (THREAD_MIN_PX / width) * 100);
  const pct = Math.min(Math.max((tracePx / width) * 100, min), Math.max(min, max));
  return { thread: `${(100 - pct).toFixed(3)}%`, trace: `${pct.toFixed(3)}%` };
}

// 문서에 선언된 --trace-w(px)를 읽는다. 없거나 읽을 수 없으면 구간 기본값.
export function readTraceWidth(fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--trace-w").trim();
  const px = Number.parseFloat(raw);
  return raw.endsWith("px") && Number.isFinite(px) && px > 0 ? px : fallback;
}
