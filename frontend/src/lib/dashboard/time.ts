// 마지막 점검 시각 표기. 시계는 브라우저 시간대를 따른다 (점검은 모두 클라이언트에서 일어난다).

export function formatClock(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

export type AgoUnit = "s" | "m" | "h";

// 경과 시간을 가장 큰 단위 하나로 줄인다. 1초 미만은 1초로 본다.
export function agoParts(deltaMs: number): { unit: AgoUnit; n: number } {
  const s = Math.max(1, Math.floor(deltaMs / 1000));
  if (s < 60) return { unit: "s", n: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "m", n: m };
  return { unit: "h", n: Math.floor(m / 60) };
}
