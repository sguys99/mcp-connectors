"use client";

import { useSyncExternalStore } from "react";

import { EMPTY_RUNTIME, getRuntimeSnapshot, subscribeRuntime } from "./store";
import type { RuntimeServerDef } from "./types";

// 이 탭의 런타임 서버 정의. 서버 렌더와 하이드레이션 첫 렌더는 빈 목록이고, 이후 sessionStorage 값으로 바뀐다.
export function useRuntimeServers(): readonly RuntimeServerDef[] {
  return useSyncExternalStore(subscribeRuntime, getRuntimeSnapshot, () => EMPTY_RUNTIME);
}
