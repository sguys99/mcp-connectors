// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { cliCommands, httpTwinOf, MAKE_CLI_TARGETS } from "./cli";

const makefile = readFileSync(resolve(__dirname, "../../../../Makefile"), "utf8");

describe("MAKE_CLI_TARGETS", () => {
  it("only names Makefile targets that exist", () => {
    for (const target of Object.values(MAKE_CLI_TARGETS)) {
      expect(makefile).toMatch(new RegExp(`^${target.listTools}:`, "m"));
      if (target.call) expect(makefile).toMatch(new RegExp(`^${target.call}:`, "m"));
    }
  });
});

describe("cliCommands", () => {
  it("uses the make target for starter-mcp", () => {
    expect(cliCommands("starter-mcp")).toEqual({
      list: "make cli-list-tools-starter",
      call: `python scripts/mcp_cli.py call --server starter-mcp --tool echo --params '{"text":"hi"}'`,
    });
  });

  it("falls back to mcp_cli.py for other servers", () => {
    const c = cliCommands("nl2sql-mcp");
    expect(c.list).toBe("uv run python scripts/mcp_cli.py list-tools --server nl2sql-mcp");
    expect(c.call).toContain("--server nl2sql-mcp --tool <tool>");
  });
});

describe("httpTwinOf", () => {
  const servers = [
    { name: "nl2sql-mcp", transport: "stdio" as const },
    { name: "nl2sql-mcp-http", transport: "streamable_http" as const },
    { name: "solo", transport: "stdio" as const },
  ];
  it("finds the -http twin only when registered as HTTP", () => {
    expect(httpTwinOf("nl2sql-mcp", servers)).toBe("nl2sql-mcp-http");
    expect(httpTwinOf("solo", servers)).toBeNull();
  });
});
