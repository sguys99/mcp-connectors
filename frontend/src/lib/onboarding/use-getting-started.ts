"use client";

import { useSyncExternalStore } from "react";

import { SERVER_SNAPSHOT, getSnapshot, subscribe, type GettingStartedState } from "./getting-started";

// 체크리스트 상태. 서버 렌더와 하이드레이션 첫 렌더는 빈 상태이고, 이후 localStorage 값으로 바뀐다.
export function useGettingStarted(): GettingStartedState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

// 하이드레이션이 끝났는지. 저장값이 필요한 UI 가 첫 렌더에서 틀린 모양을 그리지 않게 한다.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
