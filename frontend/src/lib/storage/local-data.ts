// 이 앱이 브라우저에 남기는 데이터의 목록과 일괄 삭제 (순수 함수 + Storage 인터페이스만 사용).
//
// 테마(next-themes 의 localStorage)와 언어(쿠키)는 목록에 넣지 않는다. 화면이 갑자기 바뀌므로 초기화 대상이 아니다.
// 새 저장소 키를 추가하면 여기 그룹에도 넣는다. local-data.test.ts 가 각 모듈의 상수와 맞는지 점검한다.

import { APPROVAL_PREF_KEY } from "@/lib/chat/approval-pref";
import { EXPOSED_KEY } from "@/lib/chat/exposure";
import { STORAGE_KEY as CALL_STATS_KEY } from "@/lib/inspector/call-stats";
import { DOCK_STORAGE_PREFIX } from "@/lib/inspector/layout";
import { TOOLS_CACHE_PREFIX } from "@/lib/inspector/tools-cache";
import { RUNTIME_STORAGE_KEY } from "@/lib/runtime/storage";
import { STORAGE_KEY as GETTING_STARTED_KEY } from "@/lib/onboarding/getting-started";
import { RECENT_CALLS_KEY, SETTINGS_KEY } from "@/lib/storage/settings";

export type LocalDataId = "settings" | "gettingStarted" | "layout" | "chatServers" | "sessionCache" | "runtimeServers";

export interface LocalDataGroup {
  id: LocalDataId;
  store: "local" | "session";
  exact: readonly string[];
  prefixes: readonly string[];
}

// react-resizable-panels 는 "react-resizable-panels:<id>:<패널들>" 로 저장한다 (Inspector, Chat 분할 비율).
export const LAYOUT_PREFIX = "react-resizable-panels:";

export const LOCAL_DATA_GROUPS: readonly LocalDataGroup[] = [
  { id: "settings", store: "local", exact: [SETTINGS_KEY, RECENT_CALLS_KEY], prefixes: [] },
  { id: "gettingStarted", store: "local", exact: [GETTING_STARTED_KEY], prefixes: [] },
  // 분할 비율과 Inspector 도킹 패널의 펼침 여부, 높이
  { id: "layout", store: "local", exact: [], prefixes: [LAYOUT_PREFIX, DOCK_STORAGE_PREFIX] },
  { id: "chatServers", store: "local", exact: [EXPOSED_KEY], prefixes: [] },
  // 이 탭의 호출 통계, 도구 캐시, Chat 승인 방식
  { id: "sessionCache", store: "session", exact: [CALL_STATS_KEY, APPROVAL_PREF_KEY], prefixes: [TOOLS_CACHE_PREFIX] },
  // 이 탭에서 추가한 런타임 서버 (URL 과 헤더 값 포함). 메모리 스토어는 clearRuntimeServers 로 따로 비운다.
  { id: "runtimeServers", store: "session", exact: [RUNTIME_STORAGE_KEY], prefixes: [] },
];

type StorageLike = Pick<Storage, "length" | "key" | "removeItem">;

export function keyMatchesGroup(group: LocalDataGroup, key: string): boolean {
  return group.exact.includes(key) || group.prefixes.some((p) => key.startsWith(p));
}

function listKeys(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function storageFor(group: LocalDataGroup, local: StorageLike | null, session: StorageLike | null) {
  return group.store === "local" ? local : session;
}

// 그룹별로 지금 저장돼 있는 항목 수.
export function countLocalData(
  local: StorageLike | null,
  session: StorageLike | null,
): Record<LocalDataId, number> {
  const counts = {} as Record<LocalDataId, number>;
  for (const group of LOCAL_DATA_GROUPS) {
    counts[group.id] = listKeys(storageFor(group, local, session)).filter((k) => keyMatchesGroup(group, k)).length;
  }
  return counts;
}

// 목록에 있는 항목을 모두 지우고 지운 개수를 돌려준다. 막힌 저장소는 조용히 건너뛴다.
export function clearLocalData(local: StorageLike | null, session: StorageLike | null): number {
  let removed = 0;
  for (const group of LOCAL_DATA_GROUPS) {
    const storage = storageFor(group, local, session);
    if (!storage) continue;
    for (const key of listKeys(storage).filter((k) => keyMatchesGroup(group, k))) {
      try {
        storage.removeItem(key);
        removed++;
      } catch {
        /* 지우지 못한 항목은 건너뛴다 */
      }
    }
  }
  return removed;
}

// 브라우저의 실제 저장소. 접근이 막혀 있으면 null.
export function browserStorages(): { local: Storage | null; session: Storage | null } {
  const pick = (get: () => Storage): Storage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return { local: pick(() => window.localStorage), session: pick(() => window.sessionStorage) };
}
