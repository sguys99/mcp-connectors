import { describe, expect, it } from "vitest";

import { effectiveExposed, parseExposed, resolveExposed, toggleExposed } from "./exposure";

const reachable = ["starter-mcp-http", "mock-repo-mcp", "nl2sql-mcp-http"];

describe("parseExposed", () => {
  it("reads a string array and ignores broken values", () => {
    expect(parseExposed('["a","b"]')).toEqual(["a", "b"]);
    expect(parseExposed('["a",1,null]')).toEqual(["a"]);
    expect(parseExposed("{}")).toBeNull();
    expect(parseExposed("not json")).toBeNull();
    expect(parseExposed(null)).toBeNull();
  });
});

describe("resolveExposed", () => {
  it("exposes every reachable server the first time", () => {
    expect(resolveExposed({ stored: null, urlServer: null, reachable })).toEqual(reachable);
  });

  it("uses the stored selection and drops servers that left the registry", () => {
    expect(resolveExposed({ stored: ["nl2sql-mcp-http", "gone"], urlServer: null, reachable })).toEqual(["nl2sql-mcp-http"]);
  });

  it("keeps an explicit empty selection", () => {
    expect(resolveExposed({ stored: [], urlServer: null, reachable })).toEqual([]);
  });

  it("lets a valid ?server= link win over the stored selection", () => {
    expect(resolveExposed({ stored: ["starter-mcp-http"], urlServer: "mock-repo-mcp", reachable })).toEqual(["mock-repo-mcp"]);
    expect(resolveExposed({ stored: ["starter-mcp-http"], urlServer: "unknown", reachable })).toEqual(["starter-mcp-http"]);
  });
});

describe("toggleExposed and effectiveExposed", () => {
  it("keeps registry order when toggling", () => {
    expect(toggleExposed(["nl2sql-mcp-http"], reachable, "starter-mcp-http", true)).toEqual(["starter-mcp-http", "nl2sql-mcp-http"]);
    expect(toggleExposed(reachable, reachable, "mock-repo-mcp", false)).toEqual(["starter-mcp-http", "nl2sql-mcp-http"]);
  });

  it("drops offline servers from the request", () => {
    expect(effectiveExposed(reachable, new Set(["mock-repo-mcp"]))).toEqual(["starter-mcp-http", "nl2sql-mcp-http"]);
  });
});
