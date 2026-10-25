"use client";

import { useSyncExternalStore } from "react";

// 1초마다 갱신되는 공용 시계. "12초 전" 같은 상대 시간 표기만 구독하고, 구독자가 없으면 타이머도 없다.
// 서버 렌더와 하이드레이션 첫 렌더는 0 이고, 구독이 시작되면 바로 현재 시각이 된다.
let now = 0;
const listeners = new Set<() => void>();
let timerId: ReturnType<typeof setInterval> | undefined;

function tick() {
  now = Date.now();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timerId = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}
