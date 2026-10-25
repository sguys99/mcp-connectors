import { describe, expect, it } from "vitest";

import { filterServers } from "./explorer";

const servers = [
  { name: "starter-mcp", description: "Canonical starter" },
  { name: "mock-repo-mcp", description: "Mock code repository" },
  { name: "nl2sql-mcp" },
];

describe("filterServers", () => {
  it("검색어가 비어 있으면 모두 돌려준다", () => {
    expect(filterServers(servers, "  ")).toHaveLength(3);
  });

  it("이름으로 거른다 (대소문자 무시)", () => {
    expect(filterServers(servers, "MOCK").map((s) => s.name)).toEqual(["mock-repo-mcp"]);
  });

  it("설명으로도 거른다", () => {
    expect(filterServers(servers, "starter").map((s) => s.name)).toEqual(["starter-mcp"]);
  });

  it("설명이 없는 항목도 안전하게 다룬다", () => {
    expect(filterServers(servers, "sql").map((s) => s.name)).toEqual(["nl2sql-mcp"]);
    expect(filterServers(servers, "zzz")).toEqual([]);
  });
});
