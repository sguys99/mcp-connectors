import { describe, expect, it } from "vitest";

import { fieldsFromSchema } from "./args";
import { draftToForm, draftToJson, newDraft, resetDraft } from "./draft";

const fields = fieldsFromSchema({
  properties: { sql: { type: "string" }, max_rows: { type: "integer" }, tags: { type: "array", items: { type: "string" } } },
  required: ["sql"],
});

describe("draft", () => {
  it("starts as an empty form", () => {
    expect(newDraft(fields)).toMatchObject({ mode: "form", raw: "{}", extra: {} });
  });

  it("moves form values into JSON and back", () => {
    const draft = { ...newDraft(fields), values: { sql: "SELECT 1", max_rows: "5", tags: "a\nb" } };
    const json = draftToJson(fields, draft);
    expect(json.mode).toBe("json");
    expect(JSON.parse(json.raw)).toEqual({ sql: "SELECT 1", max_rows: 5, tags: ["a", "b"] });
    const back = draftToForm(fields, json);
    expect(back).toMatchObject({ ok: true });
    if (back.ok) expect(back.draft.values).toEqual({ sql: "SELECT 1", max_rows: "5", tags: "a\nb" });
  });

  it("keeps invalid text and unknown keys across a round trip", () => {
    const draft = { ...newDraft(fields), values: { sql: "x", max_rows: "12a", tags: "" } };
    const json = draftToJson(fields, draft);
    expect(JSON.parse(json.raw).max_rows).toBe("12a");

    const withExtra = { ...json, raw: JSON.stringify({ sql: "y", other: 1 }) };
    const form = draftToForm(fields, withExtra);
    expect(form).toMatchObject({ ok: true });
    if (!form.ok) return;
    expect(form.draft.extra).toEqual({ other: 1 });
    // 다시 JSON 으로 가도 other 가 남는다.
    expect(JSON.parse(draftToJson(fields, form.draft).raw)).toEqual({ sql: "y", other: 1 });
  });

  it("refuses to switch to the form while the JSON is broken", () => {
    const result = draftToForm(fields, { ...newDraft(fields), mode: "json", raw: "{oops" });
    expect(result.ok).toBe(false);
  });

  it("reset clears inputs but keeps the mode", () => {
    const reset = resetDraft(fields, { ...newDraft(fields), mode: "json", raw: '{"sql":"x"}', extra: { a: 1 } });
    expect(reset).toEqual({ mode: "json", values: { sql: "", max_rows: "", tags: "" }, raw: "{}", extra: {} });
  });
});
