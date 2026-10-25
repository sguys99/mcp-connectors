import { describe, expect, it } from "vitest";

import { describeKey } from "./keys";

describe("describeKey", () => {
  it("빈 값과 공백뿐인 값은 설정되지 않은 것으로 본다", () => {
    expect(describeKey("")).toEqual({ configured: false, last4: null });
    expect(describeKey("   ")).toEqual({ configured: false, last4: null });
  });

  it("긴 키는 끝 4자리만 알려 준다", () => {
    expect(describeKey("sk-ant-abcdefghij1234")).toEqual({ configured: true, last4: "1234" });
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(describeKey("  sk-abcdefghij9876  ").last4).toBe("9876");
  });

  it("짧은 키는 끝자리를 숨긴다", () => {
    expect(describeKey("sk-short")).toEqual({ configured: true, last4: null });
  });
});
