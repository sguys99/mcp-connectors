import { describe, expect, it } from "vitest";

import { argsShort, prettyResult, sqlOnly, truncateText } from "./format";

describe("sqlOnly", () => {
  it("returns the sql text only when it is the sole argument", () => {
    expect(sqlOnly({ sql: "SELECT 1" })).toBe("SELECT 1");
    expect(sqlOnly({ sql: "SELECT 1", limit: 5 })).toBeNull();
    expect(sqlOnly({ sql: 3 })).toBeNull();
    expect(sqlOnly({})).toBeNull();
  });
});

describe("argsShort", () => {
  it("serializes short input and cuts long input", () => {
    expect(argsShort({ a: 1 })).toBe('{"a":1}');
    const long = argsShort({ sql: "x".repeat(200) });
    expect(long).toHaveLength(72);
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("prettyResult", () => {
  it("indents JSON objects and arrays and leaves other text alone", () => {
    expect(prettyResult('{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', json: true });
    expect(prettyResult("plain text")).toEqual({ text: "plain text", json: false });
    expect(prettyResult("42")).toEqual({ text: "42", json: false });
  });

  it("unwraps MCP text blocks and re-indents JSON text inside them", () => {
    const err = JSON.stringify([{ type: "text", text: "limit must be >= 0, got -1" }]);
    expect(prettyResult(err)).toEqual({ text: "limit must be >= 0, got -1", json: false });
    const nested = JSON.stringify([{ type: "text", text: '{"ok":true}' }]);
    expect(prettyResult(nested)).toEqual({ text: '{\n  "ok": true\n}', json: true });
    // 다른 종류의 블록이 섞이면 건드리지 않는다
    const mixed = JSON.stringify([{ type: "image", data: "x" }]);
    expect(prettyResult(mixed).json).toBe(true);
  });
});

describe("truncateText", () => {
  it("keeps short text and cuts long text at a line boundary", () => {
    expect(truncateText("abc", 10)).toEqual({ text: "abc", truncated: false });
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const out = truncateText(lines, 100);
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith("\n…")).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(103);
    expect(out.text.split("\n").every((l) => l === "…" || /^line \d+$/.test(l))).toBe(true);
  });
});
