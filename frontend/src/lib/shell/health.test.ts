import { describe, expect, it } from "vitest";

import { summarizeHealth, type HealthState } from "./health";

describe("summarizeHealth", () => {
  it("상태별로 세고 stdio 는 total 에서 뺀다", () => {
    const states: HealthState[] = [
      { status: "healthy", latencyMs: 12 },
      { status: "offline", error: "x" },
      { status: "checking" },
      { status: "idle" },
      { status: "na" },
    ];
    expect(summarizeHealth(states)).toEqual({ online: 1, offline: 1, checking: 2, total: 4 });
  });
});
