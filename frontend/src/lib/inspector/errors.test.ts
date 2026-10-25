import { describe, expect, it } from "vitest";

import { errorHint, extractErrorCode, joinText } from "./errors";

describe("extractErrorCode", () => {
  it("returns the last [CODE] tag", () => {
    expect(extractErrorCode("Add a WHERE condition. [MASS_SCAN_BLOCKED]")).toBe("MASS_SCAN_BLOCKED");
    expect(extractErrorCode("see [TODO] then fail [WRITE_BLOCKED]")).toBe("WRITE_BLOCKED");
  });

  it("ignores lowercase brackets and plain text", () => {
    expect(extractErrorCode("nothing here")).toBeNull();
    expect(extractErrorCode("[note] lowercase")).toBeNull();
  });
});

describe("errorHint", () => {
  it("maps known guardrail codes to hint keys", () => {
    expect(errorHint("x [PII_COLUMN_BLOCKED]")).toEqual({ code: "PII_COLUMN_BLOCKED", hintKey: "inspector.hint.pii" });
    expect(errorHint("x [QUERY_TIMEOUT]").hintKey).toBe("inspector.hint.timeout");
  });

  it("uses a separate hint for always-true conditions", () => {
    expect(errorHint("Full-scan conditions (WHERE 1=1, TRUE, OR 1=1) are not allowed. [MASS_SCAN_BLOCKED]").hintKey).toBe(
      "inspector.hint.tautology",
    );
    expect(errorHint("Queries without a WHERE condition are allowed only on small tables. [MASS_SCAN_BLOCKED]").hintKey).toBe(
      "inspector.hint.massScan",
    );
  });

  it("shows the tag but no hint for unknown codes", () => {
    expect(errorHint("boom [SOMETHING_NEW]")).toEqual({ code: "SOMETHING_NEW", hintKey: null });
  });
});

describe("joinText", () => {
  it("joins text blocks only", () => {
    expect(joinText([{ type: "text", text: "a" }, { type: "image", data: "x" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(joinText(undefined)).toBe("");
  });
});
