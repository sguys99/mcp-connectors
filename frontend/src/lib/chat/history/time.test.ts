import { describe, expect, it } from "vitest";

import { subtractUsage } from "@/lib/chat/usage";

import { formatBytes, relativeTime } from "./time";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

describe("relativeTime", () => {
  it("says now for a few seconds and counts minutes, hours, days", () => {
    expect(relativeTime(NOW - 10_000, NOW, "en")).toMatch(/now|0 sec/);
    expect(relativeTime(NOW - 5 * 60_000, NOW, "en")).toMatch(/5 min/);
    expect(relativeTime(NOW - 3 * 3600_000, NOW, "en")).toMatch(/3 hr/);
    expect(relativeTime(NOW - 24 * 3600_000, NOW, "en")).toMatch(/yesterday/);
    expect(relativeTime(NOW - 3 * 24 * 3600_000, NOW, "en")).toMatch(/3 days/);
  });
  it("follows the locale", () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW, "ko")).toContain("5분");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("subtractUsage", () => {
  it("subtracts the usage a loaded conversation already had", () => {
    expect(subtractUsage({ input: 500, output: 100 }, { input: 300, output: 60 })).toEqual({ input: 200, output: 40 });
  });
  it("returns null when nothing new was used and passes through without a baseline", () => {
    expect(subtractUsage({ input: 5, output: 5 }, { input: 5, output: 5 })).toBeNull();
    expect(subtractUsage({ input: 5, output: 5 }, null)).toEqual({ input: 5, output: 5 });
    expect(subtractUsage(null, { input: 1, output: 1 })).toBeNull();
  });
});
