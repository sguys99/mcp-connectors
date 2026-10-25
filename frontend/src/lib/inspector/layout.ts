// Inspector 3분할의 폭 구간(band)과 구간별 기본 크기.
//
// 구간은 globals.css 의 레이아웃 변수 규칙과 같은 경계를 쓴다 (JS 쪽 max-width 는 경계 포함).
//   wide    1281px 이상   도구 목록 264px, 요청 : 응답 = 1 : 1
//   mid     1081 ~ 1280   도구 목록 250px, 요청 : 응답 = 1 : 1
//   narrow  901 ~ 1080    도구 목록 250px, 요청 : 응답 = 1.06 : 0.94
//   mobile  900px 이하    분할 없음. 도구 / 요청 / 응답 세그먼트 탭
//
// 사용자가 끈 분할 비율은 구간마다 따로 localStorage 에 저장한다 (키: mcpc-inspector-panes-<band>).
// 창을 키우거나 줄여 구간이 바뀌면 그 구간에서 마지막으로 쓰던 비율로 돌아간다. 핸들을 두 번 누르면 기본 크기로 되돌아간다.

export type LayoutBand = "wide" | "mid" | "narrow" | "mobile";
export type SplitBand = Exclude<LayoutBand, "mobile">;

export const BAND_QUERIES = {
  mobile: "(max-width: 900px)",
  narrow: "(max-width: 1080px)",
  mid: "(max-width: 1280px)",
} as const;

export function bandFromMatches(matches: { mobile: boolean; narrow: boolean; mid: boolean }): LayoutBand {
  if (matches.mobile) return "mobile";
  if (matches.narrow) return "narrow";
  if (matches.mid) return "mid";
  return "wide";
}

export interface BandDefaults {
  // 도구 목록 기본 폭(px)
  toolsPx: number;
  // 요청 : 응답 비율
  request: number;
  response: number;
}

export const BAND_DEFAULTS: Record<SplitBand, BandDefaults> = {
  wide: { toolsPx: 264, request: 1, response: 1 },
  mid: { toolsPx: 250, request: 1, response: 1 },
  narrow: { toolsPx: 250, request: 1.06, response: 0.94 },
};

export const PANES_STORAGE_PREFIX = "mcpc-inspector-panes-";

export function panesStorageKey(band: SplitBand): string {
  return `${PANES_STORAGE_PREFIX}${band}`;
}

// 도구 목록이 차지할 수 있는 범위(px). 너무 좁으면 이름이 잘리고, 너무 넓으면 요청 폼이 눌린다.
export const TOOLS_MIN_PX = 200;
export const TOOLS_MAX_PX = 480;
// 요청과 응답 패널의 최소 폭(px)
export const MAIN_MIN_PX = 280;

// 그룹 폭(px)에서 기본 패널 크기(퍼센트 문자열)를 계산한다. 도구 목록은 px 기준으로 잡고,
// 나머지 폭을 요청 : 응답 비율로 나눈다. 세 값의 합은 항상 100% 다.
export function defaultSizes(defaults: BandDefaults, groupWidth: number): { tools: string; request: string; response: string } {
  const toolsPct = Math.min(Math.max((defaults.toolsPx / Math.max(groupWidth, 1)) * 100, 5), 60);
  const rest = 100 - toolsPct;
  const requestPct = (rest * defaults.request) / (defaults.request + defaults.response);
  const responsePct = rest - requestPct;
  const fmt = (n: number) => `${n.toFixed(3)}%`;
  return { tools: fmt(toolsPct), request: fmt(requestPct), response: fmt(responsePct) };
}

// ---------- 하단 도킹 패널 높이 ----------
//
// 펼친 도킹 패널의 높이는 위쪽 가장자리 핸들을 끌거나 방향키로 바꾼다. 데스크톱과 모바일(900px 이하)을 따로 저장하고
// (키: mcpc-inspector-dock-h-desktop, mcpc-inspector-dock-h-mobile), 저장값이 없으면 CSS 기본값(--dock-h: 216px, 모바일 40vh)을 쓴다.
// 핸들을 두 번 누르면 저장값을 지우고 기본값으로 돌아간다. 펼침 여부도 같은 방식으로 나눠 저장한다
// (mcpc-inspector-dock, mcpc-inspector-dock-mobile). 모바일은 화면이 좁아 기본을 접힘으로 둔다.

export type DockMode = "desktop" | "mobile";

export const DOCK_STORAGE_PREFIX = "mcpc-inspector-dock";
export const DOCK_OPEN_KEYS: Record<DockMode, string> = { desktop: "mcpc-inspector-dock", mobile: "mcpc-inspector-dock-mobile" };
export const DOCK_HEIGHT_KEYS: Record<DockMode, string> = { desktop: "mcpc-inspector-dock-h-desktop", mobile: "mcpc-inspector-dock-h-mobile" };
// 저장값이 없을 때 펼침 여부: 데스크톱은 시안대로 펼침, 모바일은 접힘
export const DOCK_DEFAULT_OPEN: Record<DockMode, boolean> = { desktop: true, mobile: false };

// 머리 줄과 몇 줄의 내용이 보이는 최소 높이
export const DOCK_MIN_PX = 96;
// 도킹 패널을 키워도 위쪽 패널(도구, 요청, 응답)에 남겨 둘 높이
export const DOCK_PANES_MIN_PX = 160;
// 방향키 한 번, PageUp/PageDown 한 번에 움직이는 양
export const DOCK_STEP_PX = 16;
export const DOCK_PAGE_STEP_PX = 64;

export function dockMaxHeight(containerHeight: number): number {
  return Math.max(DOCK_MIN_PX, Math.round(containerHeight - DOCK_PANES_MIN_PX));
}

export function clampDockHeight(height: number, containerHeight: number): number {
  return Math.round(Math.min(Math.max(height, DOCK_MIN_PX), dockMaxHeight(containerHeight)));
}

// 저장된 문자열을 높이(px)로. 숫자가 아니거나 범위를 크게 벗어나면 null (기본값 사용).
export function parseDockHeight(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < DOCK_MIN_PX || n > 4000) return null;
  return Math.round(n);
}

export function parseDockOpen(raw: string | null, mode: DockMode): boolean {
  if (raw === "open") return true;
  if (raw === "closed") return false;
  return DOCK_DEFAULT_OPEN[mode];
}

// 핸들의 키보드 조작. 위로 올리면(ArrowUp) 패널이 커진다. 처리하지 않는 키면 null.
export function dockHeightForKey(key: string, current: number, containerHeight: number): number | null {
  switch (key) {
    case "ArrowUp":
      return clampDockHeight(current + DOCK_STEP_PX, containerHeight);
    case "ArrowDown":
      return clampDockHeight(current - DOCK_STEP_PX, containerHeight);
    case "PageUp":
      return clampDockHeight(current + DOCK_PAGE_STEP_PX, containerHeight);
    case "PageDown":
      return clampDockHeight(current - DOCK_PAGE_STEP_PX, containerHeight);
    case "Home":
      return DOCK_MIN_PX;
    case "End":
      return dockMaxHeight(containerHeight);
    default:
      return null;
  }
}
