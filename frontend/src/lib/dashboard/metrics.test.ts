import { describe, expect, it } from "vitest";

import type { PublicServer } from "@/lib/mcp/types";
import type { HealthState } from "@/lib/shell/health";
import { emptyHistory, recordCheck } from "@/lib/shell/health-history";

import { computeMetrics } from "./metrics";

const http = (name: string): PublicServer => ({ name, transport: "streamable_http", url: `/api/mcp/${name}` });
const stdio = (name: string): PublicServer => ({ name, transport: "stdio" });

describe("computeMetrics", () => {
  const servers = [stdio("s"), http("a"), http("b"), http("c")];

  it("아직 아무것도 모르면 합계와 p50 이 null", () => {
    const m = computeMetrics(servers, {}, emptyHistory());
    expect(m).toMatchObject({ httpTotal: 3, httpOnline: 0, httpOffline: 0, httpPending: 3, stdio: 1 });
    expect(m.toolsTotal).toBeNull();
    expect(m.p50).toBeNull();
  });

  it("상태별 수, 아는 도구 수의 합, 모은 p50", () => {
    let h = emptyHistory();
    h = recordCheck(h, "a", { ok: true, latencyMs: 10, toolCount: 3 }, 1, 1, false);
    h = recordCheck(h, "b", { ok: true, latencyMs: 30, toolCount: 5 }, 2, 2, false);
    h = recordCheck(h, "c", { ok: false, error: "x" }, 3, 3, false);
    const health: Record<string, HealthState> = {
      s: { status: "na" },
      a: { status: "healthy", latencyMs: 10 },
      b: { status: "healthy", latencyMs: 30 },
      c: { status: "offline", error: "x" },
    };
    const m = computeMetrics(servers, health, h);
    expect(m).toMatchObject({ httpOnline: 2, httpOffline: 1, httpPending: 0, toolsTotal: 8, toolServers: 2, p50: 20 });
  });

  it("서버가 꺼져도 마지막으로 안 도구 수는 합계에 남는다", () => {
    let h = recordCheck(emptyHistory(), "a", { ok: true, latencyMs: 10, toolCount: 3 }, 1, 1, false);
    h = recordCheck(h, "a", { ok: false, error: "x" }, 2, 2, false);
    const m = computeMetrics([http("a")], { a: { status: "offline", error: "x" } }, h);
    expect(m.toolsTotal).toBe(3);
    expect(m.httpOffline).toBe(1);
  });

  it("레지스트리가 비어도 안전", () => {
    expect(computeMetrics([], {}, emptyHistory())).toMatchObject({ httpTotal: 0, stdio: 0, toolsTotal: null, p50: null });
  });
});
