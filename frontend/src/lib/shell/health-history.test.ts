import { describe, expect, it } from "vitest";

import {
  MAX_EVENTS,
  MAX_SAMPLES,
  emptyHistory,
  pruneHistory,
  pushEvent,
  pushSample,
  recordCheck,
} from "./health-history";

describe("pushSample", () => {
  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let list = undefined as ReturnType<typeof pushSample> | undefined;
    for (let i = 0; i < MAX_SAMPLES + 5; i += 1) list = pushSample(list, { at: i, ms: i });
    expect(list).toHaveLength(MAX_SAMPLES);
    expect(list![0]!.at).toBe(5);
  });
});

describe("pushEvent", () => {
  it("최신이 앞이고 상한을 지킨다", () => {
    let list: ReturnType<typeof pushEvent> = [];
    for (let i = 0; i < MAX_EVENTS + 3; i += 1) {
      list = pushEvent(list, { id: i, at: i, server: "a", outcome: { ok: true, latencyMs: 1 }, background: false });
    }
    expect(list).toHaveLength(MAX_EVENTS);
    expect(list[0]!.id).toBe(MAX_EVENTS + 2);
  });
});

describe("recordCheck", () => {
  it("성공은 샘플, 시각, 도구 수를 남기고 이전 오류를 지운다", () => {
    let h = recordCheck(emptyHistory(), "a", { ok: false, error: "boom" }, 1000, 1, false);
    expect(h.lastError.a).toBe("boom");
    expect(h.samples.a).toEqual([{ at: 1000, ms: null }]);
    h = recordCheck(h, "a", { ok: true, latencyMs: 12, toolCount: 3 }, 2000, 2, true);
    expect(h.lastError.a).toBeUndefined();
    expect(h.knownTools.a).toBe(3);
    expect(h.checkedAt.a).toBe(2000);
    expect(h.samples.a).toEqual([
      { at: 1000, ms: null },
      { at: 2000, ms: 12 },
    ]);
    expect(h.events.map((e) => e.id)).toEqual([2, 1]);
    expect(h.events[0]!.background).toBe(true);
  });

  it("실패해도 마지막으로 안 도구 수는 남는다", () => {
    let h = recordCheck(emptyHistory(), "a", { ok: true, latencyMs: 5, toolCount: 4 }, 1, 1, false);
    h = recordCheck(h, "a", { ok: false, error: "x" }, 2, 2, false);
    expect(h.knownTools.a).toBe(4);
  });

  it("원본을 바꾸지 않는다", () => {
    const base = emptyHistory();
    recordCheck(base, "a", { ok: true, latencyMs: 1 }, 1, 1, false);
    expect(base).toEqual(emptyHistory());
  });
});

describe("pruneHistory", () => {
  it("레지스트리에서 사라진 서버의 이력을 정리한다", () => {
    let h = recordCheck(emptyHistory(), "a", { ok: true, latencyMs: 1, toolCount: 1 }, 1, 1, false);
    h = recordCheck(h, "b", { ok: true, latencyMs: 1, toolCount: 2 }, 2, 2, false);
    const pruned = pruneHistory(h, new Set(["a"]));
    expect(Object.keys(pruned.samples)).toEqual(["a"]);
    expect(pruned.knownTools).toEqual({ a: 1 });
    expect(pruned.events.map((e) => e.server)).toEqual(["a"]);
  });
});
