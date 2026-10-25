// 브레이크포인트 일관성 점검.
// Tailwind v4 의 max-[Npx] 는 width < N 이라 N 을 포함하지 않지만, globals.css 의 (max-width: 900px)
// 와 use-media-query.ts 의 MOBILE_QUERY 는 900 을 포함한다. 그래서 "900px 이하"는 max-[901px] 로 쓴다.
// 이 점검은 900, 1080, 1280 같은 경계값을 max-[...] 에 그대로 쓴 클래스를 막는다.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MOBILE_QUERY } from "@/components/shell/use-media-query";

const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe("breakpoints", () => {
  it("never uses an exclusive max-[Npx] on an inclusive boundary (900, 1080, 1280, 420)", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const m = readFileSync(f, "utf8").match(/max-\[(900|1080|1280|420)px\]/g);
      if (m) bad.push(`${f}: ${[...new Set(m)].join(", ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the JS mobile query inclusive at 900px like the CSS", () => {
    expect(MOBILE_QUERY).toBe("(max-width: 900px)");
  });
});
