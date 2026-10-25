// 지표 띠 계산. 상태 맵과 점검 이력에서 네 칸 값을 만든다 (순수 함수).

import type { PublicServer } from "@/lib/mcp/types";
import type { HealthState } from "@/lib/shell/health";
import type { HealthHistory } from "@/lib/shell/health-history";

import { pooledP50 } from "./latency";

export interface DashboardMetrics {
  httpTotal: number;
  httpOnline: number;
  httpOffline: number;
  // 아직 첫 결과를 못 받았거나 점검 중인 HTTP 서버 수.
  httpPending: number;
  stdio: number;
  // 도구 수를 아는 HTTP 서버들의 합. 아는 서버가 없으면 null.
  toolsTotal: number | null;
  toolServers: number;
  // 이 세션 최근 샘플로 모은 p50(ms). 샘플이 없으면 null.
  p50: number | null;
}

export function computeMetrics(
  servers: readonly PublicServer[],
  health: Readonly<Record<string, HealthState>>,
  history: HealthHistory,
): DashboardMetrics {
  const http = servers.filter((s) => s.transport !== "stdio");
  let online = 0;
  let offline = 0;
  let pending = 0;
  for (const s of http) {
    const status = health[s.name]?.status ?? "idle";
    if (status === "healthy") online += 1;
    else if (status === "offline") offline += 1;
    else pending += 1;
  }
  const known = http.filter((s) => history.knownTools[s.name] !== undefined);
  return {
    httpTotal: http.length,
    httpOnline: online,
    httpOffline: offline,
    httpPending: pending,
    stdio: servers.length - http.length,
    toolsTotal: known.length ? known.reduce((sum, s) => sum + history.knownTools[s.name]!, 0) : null,
    toolServers: known.length,
    p50: pooledP50(http.map((s) => history.samples[s.name])),
  };
}
