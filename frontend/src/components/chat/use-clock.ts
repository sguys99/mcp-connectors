"use client";

// 진행 중인 실행의 시계. active 인 동안 일정 간격으로 performance.now() 를 돌려줘서 실행 중 스팬이 자란다.
// 탭이 보이지 않으면 멈추고(화면이 갱신되지 않으니 낭비), 모션 줄이기 설정에서는 간격을 늘린다.

import { useEffect, useState } from "react";

import { useMediaQuery } from "@/components/shell/use-media-query";

const FAST_MS = 100;
const REDUCED_MS = 500;

export function useClock(active: boolean): number {
  const [now, setNow] = useState(0);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") setNow(performance.now());
    };
    // 켜지는 즉시 한 번 맞춘다 (effect 본문이 아니라 타이머 콜백에서 상태를 바꾼다).
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, reduced ? REDUCED_MS : FAST_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, reduced]);

  return now;
}
