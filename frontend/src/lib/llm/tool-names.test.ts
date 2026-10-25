import { describe, expect, it } from "vitest";

import type { ToolMeta } from "@/lib/mcp/types";

import { exposeTools, ToolNameError } from "./tool-names";

const tool = (name: string): ToolMeta => ({ name, description: `${name} tool`, inputSchema: { type: "object" } });

describe("exposeTools", () => {
  it("keeps names as they are for a single server", () => {
    const { tools, index } = exposeTools([{ server: "starter-mcp-http", tools: [tool("echo"), tool("add")] }]);
    expect(tools.map((t) => t.name)).toEqual(["echo", "add"]);
    expect(index.get("echo")).toEqual({ server: "starter-mcp-http", tool: "echo" });
  });

  it("prefixes names with the server for several servers and maps them back", () => {
    const { tools, index } = exposeTools([
      { server: "starter-mcp-http", tools: [tool("echo")] },
      { server: "mock-repo-mcp", tools: [tool("echo"), tool("list_repositories")] },
    ]);
    expect(tools.map((t) => t.name)).toEqual([
      "starter-mcp-http__echo",
      "mock-repo-mcp__echo",
      "mock-repo-mcp__list_repositories",
    ]);
    // 원래 설명과 스키마는 그대로
    expect(tools[2]).toMatchObject({ description: "list_repositories tool", inputSchema: { type: "object" } });
    expect(index.get("mock-repo-mcp__echo")).toEqual({ server: "mock-repo-mcp", tool: "echo" });
    expect(index.get("echo")).toBeUndefined();
  });

  it("maps a tool whose own name contains the separator without splitting", () => {
    const { index } = exposeTools([
      { server: "a", tools: [tool("x__y")] },
      { server: "b", tools: [tool("z")] },
    ]);
    expect(index.get("a__x__y")).toEqual({ server: "a", tool: "x__y" });
  });

  it("rejects names that are too long or invalid for the LLM APIs", () => {
    const long = "t".repeat(60);
    expect(() =>
      exposeTools([
        { server: "starter-mcp-http", tools: [tool(long)] },
        { server: "b", tools: [] },
      ]),
    ).toThrow(ToolNameError);
    expect(() => exposeTools([{ server: "a", tools: [tool("has space")] }])).toThrow(ToolNameError);
  });

  it("rejects duplicate names inside one server", () => {
    expect(() => exposeTools([{ server: "a", tools: [tool("x"), tool("x")] }])).toThrow(/Duplicate/);
  });
});
