// 런타임 서버 스토어 (브라우저 전용 싱글턴). useSyncExternalStore 와 함께 쓴다 (use-runtime-servers.ts).
// sessionStorage 가 막혀 있으면 이 탭이 열려 있는 동안만 메모리에 기억한다.

import { RUNTIME_STORAGE_KEY, MAX_RUNTIME_SERVERS, parseRuntime, serializeRuntime } from "./storage";
import type { RuntimeServerDef } from "./types";

export const EMPTY_RUNTIME: readonly RuntimeServerDef[] = Object.freeze([]);

let cache: readonly RuntimeServerDef[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly RuntimeServerDef[] {
  try {
    return parseRuntime(window.sessionStorage.getItem(RUNTIME_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function getRuntimeSnapshot(): readonly RuntimeServerDef[] {
  if (typeof window === "undefined") return EMPTY_RUNTIME;
  if (cache === null) cache = read();
  return cache;
}

function commit(next: readonly RuntimeServerDef[]) {
  cache = next;
  try {
    if (next.length === 0) window.sessionStorage.removeItem(RUNTIME_STORAGE_KEY);
    else window.sessionStorage.setItem(RUNTIME_STORAGE_KEY, serializeRuntime(next));
  } catch {
    /* 저장이 막혀도 이 탭 안에서는 메모리 값으로 동작한다 */
  }
  listeners.forEach((l) => l());
}

export function subscribeRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 추가. 같은 이름이 있으면 거부하고 false.
export function addRuntimeServer(def: Omit<RuntimeServerDef, "rev">): boolean {
  const current = getRuntimeSnapshot();
  if (current.some((d) => d.name === def.name) || current.length >= MAX_RUNTIME_SERVERS) return false;
  commit([...current, { ...def, rev: 0 }]);
  return true;
}

// 수정 (이름 바꾸기 포함). 목록 위치는 유지하고 rev 를 올린다.
export function updateRuntimeServer(oldName: string, def: Omit<RuntimeServerDef, "rev">): boolean {
  const current = getRuntimeSnapshot();
  const index = current.findIndex((d) => d.name === oldName);
  if (index < 0) return false;
  if (def.name !== oldName && current.some((d) => d.name === def.name)) return false;
  const next = [...current];
  next[index] = { ...def, rev: current[index]!.rev + 1 };
  commit(next);
  return true;
}

export function removeRuntimeServer(name: string): void {
  const current = getRuntimeSnapshot();
  if (!current.some((d) => d.name === name)) return;
  commit(current.filter((d) => d.name !== name));
}

// 모두 지운다 (설정의 "모든 로컬 데이터 초기화"). sessionStorage 항목도 함께 지워진다.
export function clearRuntimeServers(): void {
  if (getRuntimeSnapshot().length === 0) {
    try {
      window.sessionStorage.removeItem(RUNTIME_STORAGE_KEY);
    } catch {
      /* 막혀 있으면 지울 것이 없다 */
    }
    return;
  }
  commit([]);
}

export function findRuntimeServer(name: string): RuntimeServerDef | undefined {
  return getRuntimeSnapshot().find((d) => d.name === name);
}

// 테스트 전용: 모듈 상태 초기화
export function __resetRuntimeStoreForTests() {
  cache = null;
  listeners.clear();
}
