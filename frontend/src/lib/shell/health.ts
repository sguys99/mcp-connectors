// 서버 상태 스냅샷의 타입과 집계. 실제 ping 은 components/shell/health-store.tsx 가 한다.

export type HealthState =
  | { status: "idle" | "checking" }
  | {
      status: "healthy";
      latencyMs: number;
      toolCount?: number;
      protocolVersion?: string;
    }
  | { status: "offline"; error: string }
  | { status: "na" };

export type HealthStatus = HealthState["status"];

export interface HealthSummary {
  online: number;
  offline: number;
  checking: number;
  total: number;
}

// total 은 ping 대상(streamable_http) 서버 수. stdio("na")는 세지 않는다.
export function summarizeHealth(states: Iterable<HealthState>): HealthSummary {
  const sum: HealthSummary = { online: 0, offline: 0, checking: 0, total: 0 };
  for (const s of states) {
    if (s.status === "na") continue;
    sum.total += 1;
    if (s.status === "healthy") sum.online += 1;
    else if (s.status === "offline") sum.offline += 1;
    else sum.checking += 1;
  }
  return sum;
}
