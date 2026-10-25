import { describe, expect, it } from "vitest";

import { extractType } from "./json-type";

describe("extractType", () => {
  it("reads a plain type", () => {
    expect(extractType({ type: "integer" })).toBe("integer");
  });

  it("skips null in a type array", () => {
    expect(extractType({ type: ["null", "string"] })).toBe("string");
  });

  it("reads FastMCP Optional[X] as anyOf with a null branch", () => {
    expect(extractType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string");
  });

  it("returns undefined for unknown shapes", () => {
    expect(extractType(undefined)).toBeUndefined();
    expect(extractType({ $ref: "#/x" })).toBeUndefined();
  });
});
