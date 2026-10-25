import { describe, expect, it } from "vitest";

import { buildAxis, formatDuration, formatTick, spanFraction } from "./scale";

describe("buildAxis", () => {
  it("picks a nice step that covers the total within maxTicks", () => {
    const axis = buildAxis(87, 6);
    expect(axis.step).toBe(20);
    expect(axis.domain).toBe(100);
    expect(axis.ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("handles sub-millisecond totals", () => {
    const axis = buildAxis(2.4, 6);
    expect(axis.domain).toBeGreaterThanOrEqual(2.4);
    expect(axis.ticks.length).toBeLessThanOrEqual(7);
    expect(axis.ticks[0]).toBe(0);
  });

  it("handles second-scale totals and keeps ticks evenly spaced", () => {
    const axis = buildAxis(3040, 5);
    expect(axis.domain).toBeGreaterThanOrEqual(3040);
    const gaps = axis.ticks.slice(1).map((t, i) => Number((t - axis.ticks[i]!).toFixed(6)));
    expect(new Set(gaps).size).toBe(1);
    expect(axis.ticks.length - 1).toBeLessThanOrEqual(5);
  });

  it("falls back for zero or invalid totals", () => {
    expect(buildAxis(0, 5).domain).toBeGreaterThan(0);
    expect(buildAxis(Number.NaN, 5).ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("always covers the total for many magnitudes", () => {
    for (const total of [0.3, 1, 4.2, 9, 12, 33, 99, 101, 250, 999, 1200, 4800, 20000]) {
      for (const maxTicks of [2, 3, 5, 7]) {
        const axis = buildAxis(total, maxTicks);
        expect(axis.domain).toBeGreaterThanOrEqual(total - 1e-9);
        expect(axis.ticks.length - 1).toBeLessThanOrEqual(Math.max(maxTicks, 2));
      }
    }
  });
});

describe("spanFraction", () => {
  it("returns ratios of the domain and clamps overflow", () => {
    expect(spanFraction(25, 25, 100)).toEqual({ left: 0.25, width: 0.25 });
    expect(spanFraction(90, 50, 100)).toEqual({ left: 0.9, width: expect.closeTo(0.1, 10) });
    expect(spanFraction(0, 10, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe("formatDuration", () => {
  it("scales units", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(0.04)).toBe("<0.1 ms");
    expect(formatDuration(0.62)).toBe("0.6 ms");
    expect(formatDuration(7.46)).toBe("7.5 ms");
    expect(formatDuration(86.4)).toBe("86 ms");
    expect(formatDuration(3035)).toBe("3.04 s");
    expect(formatDuration(12500)).toBe("12.5 s");
  });
});

describe("formatTick", () => {
  it("shows only the needed digits", () => {
    expect(formatTick(0, 20)).toBe("0");
    expect(formatTick(40, 20)).toBe("40 ms");
    expect(formatTick(2.5, 0.5)).toBe("2.5 ms");
    expect(formatTick(1000, 500)).toBe("1.0 s");
    expect(formatTick(2000, 1000)).toBe("2 s");
  });
});
