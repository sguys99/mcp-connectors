import { describe, expect, it } from "vitest";

import { renderSystemPrompt, renderTemplate, toolDefinitionsBlock } from "./prompt";
import type { ToolMeta } from "@/lib/mcp/types";

const SAMPLE_TOOLS: ToolMeta[] = [
  {
    name: "list_repositories",
    description: "List repos",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "get_file_content",
    description: "Read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

describe("renderTemplate", () => {
  it("replaces known {{tokens}} and leaves unknown ones intact", () => {
    const out = renderTemplate("Hello {{name}} from {{server}} ({{unknown}})", {
      name: "Alice",
      server: "mock",
    });
    expect(out).toBe("Hello Alice from mock ({{unknown}})");
  });
});

describe("toolDefinitionsBlock", () => {
  it("renders each tool as a section with JSON Schema fenced block", () => {
    const block = toolDefinitionsBlock(SAMPLE_TOOLS);
    expect(block).toContain("### list_repositories");
    expect(block).toContain("### get_file_content");
    expect(block).toContain('"type": "object"');
    expect(block).toContain('"required"');
    expect(block.split("\n\n").length).toBeGreaterThan(1);
  });

  it("returns a placeholder when there are no tools", () => {
    expect(toolDefinitionsBlock([])).toBe("_(no tools available)_");
  });
});

describe("renderSystemPrompt", () => {
  it("returns the override verbatim when it is non-empty (no placeholder substitution)", async () => {
    const out = await renderSystemPrompt({
      override: "You are terse. Server: {{server_name}}",
      serverName: "mock-repo-mcp",
      tools: SAMPLE_TOOLS,
    });
    // override 는 placeholder 치환 안 함.
    expect(out).toBe("You are terse. Server: {{server_name}}");
  });

  it("reads chat_system.md and substitutes placeholders when override is null/empty", async () => {
    const out = await renderSystemPrompt({
      override: null,
      serverName: "mock-repo-mcp",
      tools: SAMPLE_TOOLS,
    });
    // PRD §7.1 골격의 고정 문구 + 치환된 값.
    expect(out).toContain("MCP Connectors Chat 시스템 프롬프트");
    expect(out).toContain("- 서버: mock-repo-mcp");
    expect(out).toContain("- 사용 가능 도구 개수: 2");
    expect(out).toContain("### list_repositories");
    expect(out).not.toContain("{{server_name}}");
    expect(out).not.toContain("{{tool_count}}");
    expect(out).not.toContain("{{tool_definitions_block}}");
  });

  it("treats whitespace-only override as empty (falls back to template)", async () => {
    const out = await renderSystemPrompt({
      override: "   \n\t  ",
      serverName: "mock-repo-mcp",
      tools: [],
    });
    expect(out).toContain("MCP Connectors Chat 시스템 프롬프트");
    expect(out).toContain("- 사용 가능 도구 개수: 0");
    expect(out).toContain("_(no tools available)_");
  });
});
