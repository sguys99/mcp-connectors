import { beforeEach, describe, expect, it } from "vitest";

import { loadSamples, MAX_SAMPLES, p50, parseSamples, recordSample, STORAGE_KEY } from "./call-stats";

describe("p50", () => {
  it("returns the median rounded, or null when empty", () => {
    expect(p50([])).toBeNull();
    expect(p50([5])).toBe(5);
    expect(p50([9, 1, 5])).toBe(5);
    expect(p50([10, 20, 30, 41])).toBe(25);
  });
});

describe("parseSamples", () => {
  it("keeps finite non-negative numbers only", () => {
    expect(parseSamples('[1, "x", -3, 4.5, null]')).toEqual([1, 4.5]);
    expect(parseSamples("not json")).toEqual([]);
    expect(parseSamples('{"a":1}')).toEqual([]);
    expect(parseSamples(null)).toEqual([]);
  });
});

describe("recordSample", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    recordSample(0);
    window.sessionStorage.clear();
  });

  it("accumulates samples in sessionStorage and caps the window", () => {
    for (let i = 1; i <= MAX_SAMPLES + 5; i += 1) recordSample(i);
    const samples = loadSamples();
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples.at(-1)).toBe(MAX_SAMPLES + 5);
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(MAX_SAMPLES);
  });
});
