import { describe, expect, it } from "vitest";

import { THREAD_MIN_PX, TRACE_MAX_PX, TRACE_MIN_PX, traceDefaultSizes, tracePanesKey } from "./layout";

const pct = (s: string) => Number.parseFloat(s);

describe("traceDefaultSizes", () => {
  it("turns the trace width in px into a percentage of the group", () => {
    const { thread, trace } = traceDefaultSizes(420, 1400);
    expect(pct(trace)).toBeCloseTo(30, 1);
    expect(pct(thread) + pct(trace)).toBeCloseTo(100, 2);
  });

  it("keeps the trace column within its min and max and leaves room for the thread", () => {
    expect(pct(traceDefaultSizes(100, 1000).trace)).toBeCloseTo((TRACE_MIN_PX / 1000) * 100, 1);
    expect(pct(traceDefaultSizes(900, 2000).trace)).toBeCloseTo((TRACE_MAX_PX / 2000) * 100, 1);
    // 좁은 그룹에서는 대화 열의 최소 폭을 먼저 지킨다
    const narrow = traceDefaultSizes(420, 700);
    expect((pct(narrow.thread) / 100) * 700).toBeGreaterThanOrEqual(THREAD_MIN_PX - 1);
  });

  it("names the storage key per band", () => {
    expect(tracePanesKey("wide")).toBe("mcpc-chat-panes-wide");
  });
});
