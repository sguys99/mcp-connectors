"use client";

import { useSyncExternalStore } from "react";

// CSS 미디어 쿼리 일치 여부. 서버 렌더는 false 로 그리고 하이드레이션 뒤에 맞춘다.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// 앱 셸의 모바일 구간. globals.css 의 900px 이하 규칙과 같은 값.
export const MOBILE_QUERY = "(max-width: 900px)";
