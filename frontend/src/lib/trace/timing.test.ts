import { describe, expect, it } from "vitest";

import { buildCallSpans, parseServerTiming, pickProxyTiming } from "./timing";

const labels = { browser: "browser", proxy: "proxy", upstream: "upstream", network: "network" };

describe("parseServerTiming", () => {
  it("parses names, durations and quoted descriptions", () => {
    expect(parseServerTiming('proxy;dur=0.8, upstream;dur=12.4;desc="first byte, SSE", headers;dur=1.1')).toEqual([
      { name: "proxy", dur: 0.8 },
      { name: "upstream", dur: 12.4, desc: "first byte, SSE" },
      { name: "headers", dur: 1.1 },
    ]);
  });

  it("ignores junk and empty input", () => {
    expect(parseServerTiming(null)).toEqual([]);
    expect(parseServerTiming("")).toEqual([]);
    expect(parseServerTiming("a;dur=abc, ;dur=2, b")).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("pickProxyTiming", () => {
  it("needs both proxy and upstream", () => {
    expect(pickProxyTiming([{ name: "proxy", dur: 1 }])).toBeNull();
    expect(
      pickProxyTiming([
        { name: "proxy", dur: 1 },
        { name: "upstream", dur: 5 },
        { name: "headers", dur: 2 },
      ]),
    ).toEqual({ proxyMs: 1, upstreamMs: 5, headersMs: 2 });
  });
});

describe("buildCallSpans", () => {
  it("lays out proxy, upstream and the remainder under the browser span", () => {
    const spans = buildCallSpans({
      totalMs: 100,
      outcome: "ok",
      timing: { proxyMs: 2, upstreamMs: 90 },
      path: "/api/mcp/x",
      labels,
    });
    expect(spans.map((s) => [s.id, s.start, s.dur, s.parent])).toEqual([
      ["browser", 0, 100, undefined],
      ["proxy", 0, 2, "browser"],
      ["upstream", 2, 90, "browser"],
      ["network", 92, 8, "browser"],
    ]);
  });

  it("draws only the browser span without proxy timing", () => {
    const spans = buildCallSpans({ totalMs: 40, outcome: "ok", timing: null, path: "/p", labels });
    expect(spans).toHaveLength(1);
  });

  it("clamps measured values that exceed the total and marks failures", () => {
    const spans = buildCallSpans({
      totalMs: 10,
      outcome: "transport",
      timing: { proxyMs: 4, upstreamMs: 50 },
      path: "/p",
      labels,
    });
    expect(spans[0]).toMatchObject({ kind: "error", status: "error" });
    expect(spans.find((s) => s.id === "upstream")?.dur).toBe(6);
    expect(spans.find((s) => s.id === "network")).toBeUndefined();
  });

  it("marks a cancelled call", () => {
    const [root] = buildCallSpans({ totalMs: 10, outcome: "cancelled", timing: null, path: "/p", labels });
    expect(root?.status).toBe("cancelled");
  });
});
