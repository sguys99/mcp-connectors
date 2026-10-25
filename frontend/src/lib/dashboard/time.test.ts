import { describe, expect, it } from "vitest";

import { agoParts } from "./time";

describe("agoParts", () => {
  it("1초 미만은 1초", () => {
    expect(agoParts(0)).toEqual({ unit: "s", n: 1 });
    expect(agoParts(400)).toEqual({ unit: "s", n: 1 });
  });
  it("초, 분, 시간 단위로 내림", () => {
    expect(agoParts(12_900)).toEqual({ unit: "s", n: 12 });
    expect(agoParts(60_000)).toEqual({ unit: "m", n: 1 });
    expect(agoParts(59 * 60_000 + 59_000)).toEqual({ unit: "m", n: 59 });
    expect(agoParts(3 * 3_600_000)).toEqual({ unit: "h", n: 3 });
  });
});
