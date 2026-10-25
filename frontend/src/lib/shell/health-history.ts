// 이번 세션의 점검 이력: 지연 샘플(스파크라인, p50), 마지막 점검 시각, 마지막으로 안 도구 수, 최근 점검 로그.
// 순수 함수만 둔다. 저장과 구독은 components/shell/health-store.tsx 가 맡는다.
// 새로고침하면 사라지는 "이 세션" 데이터이고, 디스크에는 아무것도 쓰지 않는다.

// 서버마다 보관할 최대 샘플 수. 30초 간격이면 약 12분이다. 스파크라인의 가로 슬롯 수이기도 하다.
export const MAX_SAMPLES = 24;
// 전체 로그 상한. 화면의 Recent checks 가 이 안에서 자른다.
export const MAX_EVENTS = 100;

// ms 가 null 이면 실패한 점검 (오프라인).
export interface Sample {
  at: number;
  ms: number | null;
}

export type CheckOutcome =
  | { ok: true; latencyMs: number; toolCount?: number }
  | { ok: false; error: string };

export interface CheckEvent {
  id: number;
  at: number;
  server: string;
  outcome: CheckOutcome;
  // 30초 주기 점검이면 true, 사용자가 누른 점검과 첫 점검은 false.
  background: boolean;
}

export interface HealthHistory {
  samples: Record<string, Sample[]>;
  checkedAt: Record<string, number>;
  // 마지막으로 확인된 도구 수. 서버가 꺼져도 지우지 않는다.
  knownTools: Record<string, number>;
  // 마지막 실패 메시지. 성공하면 지운다.
  lastError: Record<string, string>;
  // 최신이 앞.
  events: CheckEvent[];
}

export function emptyHistory(): HealthHistory {
  return { samples: {}, checkedAt: {}, knownTools: {}, lastError: {}, events: [] };
}

export function pushSample(list: readonly Sample[] | undefined, sample: Sample, max = MAX_SAMPLES): Sample[] {
  const next = [...(list ?? []), sample];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function pushEvent(list: readonly CheckEvent[], event: CheckEvent, max = MAX_EVENTS): CheckEvent[] {
  const next = [event, ...list];
  return next.length > max ? next.slice(0, max) : next;
}

// 점검 결과 한 건을 이력에 반영한 새 객체를 돌려준다.
export function recordCheck(
  prev: HealthHistory,
  server: string,
  outcome: CheckOutcome,
  at: number,
  eventId: number,
  background: boolean,
): HealthHistory {
  const sample: Sample = { at, ms: outcome.ok ? outcome.latencyMs : null };
  const knownTools = { ...prev.knownTools };
  const lastError = { ...prev.lastError };
  if (outcome.ok) {
    if (outcome.toolCount !== undefined) knownTools[server] = outcome.toolCount;
    delete lastError[server];
  } else {
    lastError[server] = outcome.error;
  }
  return {
    samples: { ...prev.samples, [server]: pushSample(prev.samples[server], sample) },
    checkedAt: { ...prev.checkedAt, [server]: at },
    knownTools,
    lastError,
    events: pushEvent(prev.events, { id: eventId, at, server, outcome, background }),
  };
}

// 레지스트리에서 사라진 서버의 이력을 정리한다.
export function pruneHistory(prev: HealthHistory, names: ReadonlySet<string>): HealthHistory {
  const keep = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([name]) => names.has(name)));
  return {
    samples: keep(prev.samples),
    checkedAt: keep(prev.checkedAt),
    knownTools: keep(prev.knownTools),
    lastError: keep(prev.lastError),
    events: prev.events.filter((e) => names.has(e.server)),
  };
}
