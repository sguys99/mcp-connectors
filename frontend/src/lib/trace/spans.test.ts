import { describe, expect, it } from "vitest";

import { flattenSpans, traceExtent, type TraceSpan } from "./spans";

const span = (id: string, start: number, dur: number, parent?: string): TraceSpan => ({
  id,
  kind: "tool",
  label: id,
  start,
  dur,
  status: "ok",
  parent,
});

describe("flattenSpans", () => {
  it("puts parents first and orders children by start", () => {
    const flat = flattenSpans([span("c2", 20, 5, "root"), span("root", 0, 30), span("c1", 5, 5, "root"), span("g", 6, 1, "c1")]);
    expect(flat.map((s) => [s.id, s.depth])).toEqual([
      ["root", 0],
      ["c1", 1],
      ["g", 2],
      ["c2", 1],
    ]);
  });

  it("treats an unknown parent as a root and survives cycles", () => {
    const flat = flattenSpans([span("a", 0, 1, "ghost"), span("x", 0, 1, "y"), span("y", 1, 1, "x")]);
    expect(flat.map((s) => s.id).sort()).toEqual(["a", "x", "y"]);
    expect(flat.find((s) => s.id === "a")?.depth).toBe(0);
  });
});

describe("traceExtent", () => {
  it("returns the latest end", () => {
    expect(traceExtent([span("a", 0, 10), span("b", 4, 12)])).toBe(16);
    expect(traceExtent([])).toBe(0);
  });
});
