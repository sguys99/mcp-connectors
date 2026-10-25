import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import type { HistoryEntry } from "./history";
import { buildScenario, deriveExpect, exportScenarioYaml, scenarioFileName } from "./scenario-export";

// 저장소 루트의 스키마를 그대로 읽는다 (docs/scenario-format.md 와 mcp_cli.py test 가 쓰는 정본).
const schema = JSON.parse(readFileSync(resolve(__dirname, "../../../../configs/schemas/scenario.schema.json"), "utf8")) as Record<string, unknown>;
const validator = new AjvJsonSchemaValidator().getValidator(schema);

function expectValid(doc: unknown) {
  const result = validator(doc);
  expect(result.valid, result.valid ? "" : String(result.errorMessage)).toBe(true);
}

let n = 0;
const entry = (over: Partial<HistoryEntry>): HistoryEntry => {
  n += 1;
  return {
    id: `id${n}`,
    ts: new Date(2026, 9, 23, 10, 0, n).toISOString(),
    server: "starter-mcp-http",
    kind: "tool",
    target: "add",
    args: { a: 2, b: 3 },
    outcome: "ok",
    status: "ok",
    durationMs: 5,
    observed: { result: 5 },
    ...over,
  };
};

const NOW = new Date("2026-10-23T09:00:00Z");

describe("deriveExpect", () => {
  it("derives eq checks from scalar fields and marks them with a note", () => {
    const e = deriveExpect(entry({ observed: { result: 5, ok: true, label: "sum" } }));
    expect(e.status).toBeUndefined();
    expect(e.checks).toEqual([
      expect.objectContaining({ op: "note" }),
      { field: "result", op: "eq", value: 5 },
      { field: "ok", op: "eq", value: true },
      { field: "label", op: "eq", value: "sum" },
    ]);
  });

  it("uses shapes for volatile values and not_empty for clipped text", () => {
    const e = deriveExpect(
      entry({ observed: { now: "2026-10-23T10:00:00+09:00", id: "123e4567-e89b-12d3-a456-426614174000", big: 1_700_000_000_000, text: `${"x".repeat(199)}…`, tags: ["a"] } }),
    );
    const byField = Object.fromEntries((e.checks ?? []).filter((c) => c.field).map((c) => [c.field, c]));
    expect(byField.now).toMatchObject({ op: "matches_regex" });
    expect(byField.id).toMatchObject({ op: "matches_regex" });
    expect(byField.big).toMatchObject({ op: "not_null" });
    // 상한(4개)을 넘는 검사는 만들지 않는다
    expect((e.checks ?? []).length).toBeLessThanOrEqual(5);
  });

  it("derives error status, code and a message snippet for tool errors", () => {
    const e = deriveExpect(entry({ status: "error", outcome: "tool-error", errorCode: "INVALID_INPUT", errorMessage: "text is required [INVALID_INPUT]", observed: undefined }));
    expect(e).toMatchObject({ status: "error", error_code: "INVALID_INPUT" });
    expect(e.checks).toContainEqual({ field: "error.message", op: "contains", value: "text is required" });
  });

  it("derives resource and prompt checks", () => {
    const r = deriveExpect(entry({ kind: "resource", target: "starter://about", args: {}, observed: { contents: [{ uri: "starter://about", mimeType: "text/markdown", text: "# hi" }] } }));
    expect(r.checks).toContainEqual({ field: "contents[0].mimeType", op: "eq", value: "text/markdown" });
    const p = deriveExpect(entry({ kind: "prompt", target: "explain_tool", observed: { messages: [{ role: "user", content: { type: "text", text: "x" } }] } }));
    expect(p.checks).toContainEqual({ field: "messages[0].role", op: "eq", value: "user" });
    // JSON-RPC 오류는 상태만 기대한다
    expect(deriveExpect(entry({ kind: "resource", status: "error", outcome: "rpc-error", errorMessage: "Unknown resource" })).checks).toHaveLength(1);
  });
});

describe("exportScenarioYaml", () => {
  const history: HistoryEntry[] = [
    entry({ target: "add", args: { a: 2, b: 3 }, observed: { result: 5 } }),
    entry({ target: "add", args: { a: -4, b: 1 }, observed: { result: -3 } }),
    entry({ target: "echo", args: { text: "" }, status: "error", outcome: "tool-error", errorCode: "INVALID_INPUT", errorMessage: "text is required [INVALID_INPUT]", observed: undefined }),
    entry({ kind: "resource", target: "starter://about", args: {}, observed: { contents: [{ uri: "starter://about", mimeType: "text/markdown", text: "# starter" }] } }),
    entry({ kind: "prompt", target: "explain_tool", args: { tool_name: "add" }, observed: { messages: [{ role: "user", content: { type: "text", text: "Explain" } }] } }),
    entry({ target: "slow", args: {}, status: "cancelled", outcome: "cancelled", observed: undefined }),
    entry({ target: "login", args: { user: "kim", password: "[REDACTED]" }, redacted: true, observed: { ok: true } }),
  ].reverse(); // 기록은 최근 순

  it("produces a file that conforms to configs/schemas/scenario.schema.json", () => {
    const { yaml, scenario, skipped } = exportScenarioYaml(history, { server: "starter-mcp-http", now: NOW });
    expectValid(scenario);
    const parsed = parse(yaml);
    expectValid(parsed);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(scenario)));
    expect(skipped).toBe(1);
    expect(parsed.version).toBe(1);
    expect(parsed.server).toBe("starter-mcp-http");
  });

  it("keeps chronological order, unique ids, step kinds and the redaction skip", () => {
    const { scenario } = buildScenario(history, { server: "starter-mcp-http", now: NOW });
    expect(scenario.cases.map((c) => c.id)).toEqual(["add", "add-2", "echo", "about", "explain-tool", "login"]);
    expect(scenario.cases[0]).toMatchObject({ tool: "add", params: { a: 2, b: 3 }, tags: ["derived", "tools"] });
    expect(scenario.cases[3]).toMatchObject({ resource: "starter://about" });
    expect(scenario.cases[4]).toMatchObject({ prompt: "explain_tool", arguments: { tool_name: "add" } });
    expect(scenario.cases[5]!.skip).toMatch(/redacted/);
    expect(scenario.cases[2]!.expect).toMatchObject({ status: "error", error_code: "INVALID_INPUT" });
  });

  it("explains in header comments that the checks are derived, and never leaks a secret", () => {
    const { yaml } = exportScenarioYaml(history, { server: "starter-mcp-http", now: NOW });
    expect(yaml.startsWith("# Generated by the MCP Connectors Inspector")).toBe(true);
    expect(yaml).toContain("DERIVED");
    expect(yaml).toContain("op: note");
  });

  it("an empty selection violates the schema, so the UI must not offer the export", () => {
    // cases 가 비면 스키마 위반이다. 화면은 선택이 없으면 내보내기를 막는다.
    const { scenario } = buildScenario([], { server: "s", now: NOW });
    expect(validator(scenario).valid).toBe(false);
  });

  it("names the file after the server and date", () => {
    expect(scenarioFileName("starter-mcp-http", NOW)).toBe("starter-mcp-http-history-2026-10-23.yaml");
  });
});
