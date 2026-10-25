import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { assertToolOutput } from "./output-validation";

const schema = {
  type: "object",
  properties: { count: { type: "integer" }, when: { type: "string", format: "date-time" } },
  required: ["count"],
};

function catchError(fn: () => void): McpError {
  try {
    fn();
  } catch (e) {
    return e as McpError;
  }
  throw new Error("expected an error");
}

describe("assertToolOutput", () => {
  it("accepts structuredContent that matches the schema", () => {
    expect(() => assertToolOutput("t", schema, { structuredContent: { count: 2, when: "2026-01-01T00:00:00Z" } })).not.toThrow();
  });

  it("reports a mismatch with the SDK wording and InvalidParams", () => {
    const err = catchError(() => assertToolOutput("t", schema, { structuredContent: { count: "x" } }));
    expect(err).toBeInstanceOf(McpError);
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain("Structured content does not match the tool's output schema:");
    expect(err.message).toContain("count");
  });

  it("checks formats like the SDK default validator", () => {
    const err = catchError(() => assertToolOutput("t", schema, { structuredContent: { count: 1, when: "nope" } }));
    expect(err.message).toContain("date-time");
  });

  it("errors when an output schema is declared but structuredContent is missing", () => {
    const err = catchError(() => assertToolOutput("my_tool", schema, {}));
    expect(err.code).toBe(ErrorCode.InvalidRequest);
    expect(err.message).toContain("Tool my_tool has an output schema but did not return structured content");
  });

  it("lets error results through without structuredContent", () => {
    expect(() => assertToolOutput("t", schema, { isError: true })).not.toThrow();
  });

  it("wraps schema compile failures", () => {
    const err = catchError(() => assertToolOutput("t", { type: "bogus-type" }, { structuredContent: { a: 1 } }));
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain("Failed to validate structured content");
  });
});
