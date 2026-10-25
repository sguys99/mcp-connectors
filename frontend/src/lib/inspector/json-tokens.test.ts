import { describe, expect, it } from "vitest";

import { formatBytes, parseJsonContainer, tokenizeJson } from "./json-tokens";

describe("tokenizeJson", () => {
  it("splits keys, strings, numbers, booleans, null and punctuation", () => {
    const tokens = tokenizeJson('{"a": [1, -2.5e3, true, null, "x\\"y"]}').filter((t) => t.kind !== "space");
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ["punct", "{"],
      ["key", '"a"'],
      ["punct", ":"],
      ["punct", "["],
      ["number", "1"],
      ["punct", ","],
      ["number", "-2.5e3"],
      ["punct", ","],
      ["boolean", "true"],
      ["punct", ","],
      ["null", "null"],
      ["punct", ","],
      ["string", '"x\\"y"'],
      ["punct", "]"],
      ["punct", "}"],
    ]);
  });

  it("keeps every character (join equals input)", () => {
    const text = JSON.stringify({ k: ["v", 1, { z: null }], s: "한글 😀 \n" }, null, 2);
    expect(tokenizeJson(text).map((t) => t.text).join("")).toBe(text);
    expect(tokenizeJson("{broken").map((t) => t.text).join("")).toBe("{broken");
  });
});

describe("parseJsonContainer", () => {
  it("returns objects and arrays only", () => {
    expect(parseJsonContainer(' {"a":1} ')).toEqual({ a: 1 });
    expect(parseJsonContainer("[1,2]")).toEqual([1, 2]);
    expect(parseJsonContainer("42")).toBeUndefined();
    expect(parseJsonContainer('"s"')).toBeUndefined();
    expect(parseJsonContainer("{bad")).toBeUndefined();
    expect(parseJsonContainer("")).toBeUndefined();
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(120)).toBe("120 B");
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(20480)).toBe("20.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});
