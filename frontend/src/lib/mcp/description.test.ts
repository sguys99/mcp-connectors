import { describe, expect, it } from "vitest";

import { pickDescription } from "./description";

describe("pickDescription", () => {
  const both = { description: "English text", descriptionKo: "한국어 문구" };

  it("ko 이고 descriptionKo 가 있으면 한국어", () => {
    expect(pickDescription(both, "ko")).toBe("한국어 문구");
  });
  it("en 이면 영어", () => {
    expect(pickDescription(both, "en")).toBe("English text");
  });
  it("ko 인데 descriptionKo 가 없으면 영어로 되돌린다", () => {
    expect(pickDescription({ description: "English text" }, "ko")).toBe("English text");
  });
  it("둘 다 없으면 빈 문자열", () => {
    expect(pickDescription({}, "ko")).toBe("");
    expect(pickDescription({}, "en")).toBe("");
  });
});
