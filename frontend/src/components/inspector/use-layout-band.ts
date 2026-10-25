"use client";

import { useSyncExternalStore } from "react";

import { BAND_QUERIES, bandFromMatches, type LayoutBand } from "@/lib/inspector/layout";

function subscribe(onChange: () => void) {
  const lists = Object.values(BAND_QUERIES).map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", onChange));
  return () => lists.forEach((l) => l.removeEventListener("change", onChange));
}

function snapshot(): LayoutBand {
  return bandFromMatches({
    mobile: window.matchMedia(BAND_QUERIES.mobile).matches,
    narrow: window.matchMedia(BAND_QUERIES.narrow).matches,
    mid: window.matchMedia(BAND_QUERIES.mid).matches,
  });
}

// 지금 폭 구간. 서버 렌더와 하이드레이션 중에는 null (모르는 상태)이라 화면은 skeleton 을 그린다.
export function useLayoutBand(): LayoutBand | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
