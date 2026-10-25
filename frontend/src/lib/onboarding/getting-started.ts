// Getting started 체크리스트의 상태와 이벤트 API (순수 로직 + 작은 localStorage 스토어).
//
// 다른 화면이 하는 일은 한 줄이다:
//   import { markGettingStarted } from "@/lib/onboarding/getting-started";
//   markGettingStarted("inspectorCall");   // Inspector 도구 호출이 성공했을 때
//   markGettingStarted("chatToolCall");    // Chat 에서 도구 호출이 끝났을 때
//   markGettingStarted("copyConfig");      // 클라이언트 설정을 복사했을 때
// 이미 끝난 단계에 다시 불러도 아무 일도 없다 (멱등). 서버에서 불러도 안전하게 무시된다.
//
// 저장: localStorage "mcpc-getting-started" = {"v":1,"done":{...},"hidden":false}. 읽기와 쓰기는 모두 try/catch 이고,
// 막혀 있으면 이 탭이 열려 있는 동안만 메모리에 기억한다.
//
// 단계 목록(STEP_IDS)이 곧 진행 막대의 칸 수다.

export const STORAGE_KEY = "mcpc-getting-started";

// 숨긴 패널이 하이드레이션 전에 번쩍이지 않도록 <head> 스크립트가 <html> 에 다는 속성.
export const GS_HIDDEN_ATTR = "data-gs-hidden";

// 루트 레이아웃 <head> 에 그대로 넣는 스크립트. 저장값이 hidden 이면 그리기 전에 속성을 단다 (막혀 있으면 아무것도 안 함).
export const GS_HIDDEN_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(s&&JSON.parse(s).hidden===true)document.documentElement.setAttribute(${JSON.stringify(GS_HIDDEN_ATTR)},"")}catch(e){}`;

export const STEP_IDS = ["startServer", "inspectorCall", "chatToolCall", "copyConfig"] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface GettingStartedState {
  done: Record<StepId, boolean>;
  hidden: boolean;
}

export function emptyState(): GettingStartedState {
  return {
    done: Object.fromEntries(STEP_IDS.map((id) => [id, false])) as Record<StepId, boolean>,
    hidden: false,
  };
}

export function countDone(state: GettingStartedState): number {
  return STEP_IDS.filter((id) => state.done[id]).length;
}

// 저장값을 읽는다. 깨졌거나 모르는 키가 섞여 있어도 알려진 단계만 살리고 나머지는 버린다.
export function parseState(raw: string | null | undefined): GettingStartedState {
  const state = emptyState();
  if (!raw) return state;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return state;
    const { done, hidden } = data as { done?: unknown; hidden?: unknown };
    if (typeof done === "object" && done !== null) {
      for (const id of STEP_IDS) {
        if ((done as Record<string, unknown>)[id] === true) state.done[id] = true;
      }
    }
    if (hidden === true) state.hidden = true;
  } catch {
    /* 깨진 JSON 은 빈 상태로 */
  }
  return state;
}

export function serializeState(state: GettingStartedState): string {
  return JSON.stringify({ v: 1, done: state.done, hidden: state.hidden });
}

// 단계를 끝낸 새 상태. 이미 끝났으면 같은 객체를 돌려준다.
export function withStepDone(state: GettingStartedState, id: StepId): GettingStartedState {
  if (state.done[id]) return state;
  return { ...state, done: { ...state.done, [id]: true } };
}

// ---------- 스토어 (브라우저 전용) ---------- //

let cache: GettingStartedState | null = null;
const listeners = new Set<() => void>();
type ProgressListener = (info: { step: StepId; done: number; total: number }) => void;
const progressListeners = new Set<ProgressListener>();

function readStorage(): GettingStartedState {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

function writeStorage(state: GettingStartedState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    /* 저장이 막혀도 이 탭 안에서는 메모리 값으로 계속 동작한다 */
  }
}

export const SERVER_SNAPSHOT: GettingStartedState = emptyState();

export function getSnapshot(): GettingStartedState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (cache === null) cache = readStorage();
  return cache;
}

function commit(next: GettingStartedState) {
  cache = next;
  writeStorage(next);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // 다른 탭에서 바뀐 값을 따라간다.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    cache = readStorage();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// 단계가 처음 끝났을 때만 알림을 받는다 (토스트용). 다른 탭의 변화나 첫 로딩은 알리지 않는다.
export function onGettingStartedProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

// 단계를 끝낸 것으로 기록한다. 새로 끝났으면 true.
// { silent: true } 는 사용자가 한 일이 아니라 자동으로 감지한 완료(서버가 켜져 있음)에 쓴다. 기록은 하되 진행 알림(토스트)은 보내지 않는다.
export function markGettingStarted(step: StepId, options: { silent?: boolean } = {}): boolean {
  if (typeof window === "undefined") return false;
  const prev = getSnapshot();
  const next = withStepDone(prev, step);
  if (next === prev) return false;
  commit(next);
  if (options.silent) return true;
  const info = { step, done: countDone(next), total: STEP_IDS.length };
  progressListeners.forEach((l) => l(info));
  return true;
}

export function setGettingStartedHidden(hidden: boolean) {
  if (typeof window === "undefined") return;
  const prev = getSnapshot();
  if (prev.hidden === hidden) return;
  commit({ ...prev, hidden });
}

// 진행 상태를 처음으로 되돌린다 (테스트와 디버깅용).
export function resetGettingStarted() {
  if (typeof window === "undefined") return;
  commit(emptyState());
}

// 저장된 진행 상태를 지운다 (Settings 의 "모든 로컬 데이터 초기화"). 메모리 캐시도 비워 열려 있는 화면이 바로 따라간다.
export function clearGettingStarted() {
  if (typeof window === "undefined") return;
  cache = emptyState();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 막혀 있으면 메모리 값만 비운다 */
  }
  listeners.forEach((l) => l());
}
