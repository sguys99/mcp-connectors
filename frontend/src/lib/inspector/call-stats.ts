// 이 세션에서 한 도구 호출의 소요 시간 기록과 p50. 상태바의 "last / p50" 에 쓴다.
// 탭 안에서만 유지한다 (sessionStorage, 막혀 있으면 메모리). 최근 MAX_SAMPLES 개만 남긴다.

export const STORAGE_KEY = "mcpc-inspector-calls";
export const MAX_SAMPLES = 50;

let memory: number[] = [];

export function parseSamples(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0).slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}

export function p50(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value);
}

export function loadSamples(): number[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw !== null) memory = parseSamples(raw);
  } catch {
    /* 저장소가 막혀 있으면 메모리 값을 쓴다 */
  }
  return [...memory];
}

// 성공한 호출(취소와 전송 오류 제외)의 소요 시간을 더하고 갱신된 목록을 돌려준다.
export function recordSample(ms: number): number[] {
  memory = [...loadSamples(), ms].slice(-MAX_SAMPLES);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* 무시 */
  }
  return [...memory];
}
