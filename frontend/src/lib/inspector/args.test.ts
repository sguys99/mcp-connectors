import { describe, expect, it } from "vitest";

import {
  buildArgs,
  emptyValues,
  fieldsFromSchema,
  missingRequired,
  parseRawArgs,
  stringifyArgs,
  valuesFromArgs,
} from "./args";

const SCHEMA = {
  type: "object",
  properties: {
    sql: { type: "string", description: "A single SELECT" },
    max_rows: { type: "integer", default: 1000 },
    tags: { type: "array", items: { type: "string" } },
    ids: { type: "array", items: { type: "integer" } },
    dry_run: { type: "boolean" },
    level: { type: "string", enum: ["a", "b"] },
    opts: { type: "object" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    title: { type: "string" },
  },
  required: ["sql"],
};

describe("fieldsFromSchema", () => {
  const fields = fieldsFromSchema(SCHEMA);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  it("maps kinds, required flags and type labels", () => {
    expect(byName.sql).toMatchObject({ kind: "string", required: true, typeLabel: "string", multiline: true });
    expect(byName.max_rows).toMatchObject({ kind: "integer", required: false, defaultValue: 1000 });
    expect(byName.tags).toMatchObject({ kind: "array", typeLabel: "string[]", multiline: true });
    expect(byName.dry_run?.kind).toBe("boolean");
    expect(byName.level).toMatchObject({ kind: "enum", enumValues: ["a", "b"] });
    expect(byName.opts?.kind).toBe("json");
    // FastMCP 의 Optional[str] 은 anyOf 로 온다.
    expect(byName.note).toMatchObject({ kind: "string", typeLabel: "string" });
  });

  it("uses a single line for short plain strings and multiline for sql/query names", () => {
    expect(byName.title?.multiline).toBe(false);
    const q = fieldsFromSchema({ properties: { query: { type: "string" }, name: { type: "string", maxLength: 500 } } });
    expect(q.map((f) => f.multiline)).toEqual([true, true]);
  });

  it("handles missing or odd schemas", () => {
    expect(fieldsFromSchema(undefined)).toEqual([]);
    expect(fieldsFromSchema({ properties: { x: null } })[0]?.kind).toBe("string");
  });
});

describe("buildArgs", () => {
  const fields = fieldsFromSchema(SCHEMA);

  it("converts values by type and omits blank optional fields", () => {
    const values = {
      ...emptyValues(fields),
      sql: "SELECT 1",
      max_rows: " 25 ",
      tags: "a\n\n  b  \n",
      ids: "1\n2",
      dry_run: true,
      level: "b",
    };
    expect(buildArgs(fields, values)).toEqual({
      args: { sql: "SELECT 1", max_rows: 25, tags: ["a", "b"], ids: [1, 2], dry_run: true, level: "b" },
      errors: {},
    });
  });

  it("reports required, integer, number, enum and json errors", () => {
    const base = emptyValues(fields);
    expect(buildArgs(fields, base).errors).toEqual({ sql: "required" });
    expect(buildArgs(fields, { ...base, sql: "x", max_rows: "1.5" }).errors).toEqual({ max_rows: "integer" });
    expect(buildArgs(fields, { ...base, sql: "x", max_rows: "abc" }).errors).toEqual({ max_rows: "number" });
    expect(buildArgs(fields, { ...base, sql: "x", level: "z" }).errors).toEqual({ level: "enum" });
    expect(buildArgs(fields, { ...base, sql: "x", opts: "{bad" }).errors).toEqual({ opts: "json" });
  });

  it("keeps invalid text in lenient mode so nothing is lost on the way to JSON", () => {
    const { args, errors } = buildArgs(fields, { ...emptyValues(fields), sql: "x", max_rows: "12a" }, { lenient: true });
    expect(args.max_rows).toBe("12a");
    expect(errors.max_rows).toBe("number");
  });

  it("does not send an unchecked optional boolean but always sends a required one", () => {
    const f = fieldsFromSchema({ properties: { a: { type: "boolean" }, b: { type: "boolean" } }, required: ["b"] });
    expect(buildArgs(f, emptyValues(f)).args).toEqual({ b: false });
  });

  it("keeps SQL text exactly as typed", () => {
    const sql = "SELECT *\n  FROM film\n WHERE film_id < 3\n";
    expect(buildArgs(fields, { ...emptyValues(fields), sql }).args.sql).toBe(sql);
  });
});

describe("valuesFromArgs", () => {
  const fields = fieldsFromSchema(SCHEMA);

  it("round-trips form values through arguments", () => {
    const values = { ...emptyValues(fields), sql: "SELECT 1", max_rows: "5", tags: "x\ny", dry_run: true, opts: '{\n  "k": 1\n}' };
    const { args } = buildArgs(fields, values);
    const back = valuesFromArgs(fields, args);
    expect(back.values.sql).toBe("SELECT 1");
    expect(back.values.max_rows).toBe("5");
    expect(back.values.tags).toBe("x\ny");
    expect(back.values.dry_run).toBe(true);
    expect(JSON.parse(back.values.opts as string)).toEqual({ k: 1 });
    expect(back.extra).toEqual({});
  });

  it("returns keys the schema does not know as extra", () => {
    const { values, extra } = valuesFromArgs(fields, { sql: "x", unknown_key: 3 });
    expect(values.sql).toBe("x");
    expect(extra).toEqual({ unknown_key: 3 });
  });

  it("shows array items that are not primitives as JSON", () => {
    const { values } = valuesFromArgs(fields, { tags: [{ a: 1 }] });
    expect(values.tags).toBe('[{"a":1}]');
  });
});

describe("parseRawArgs", () => {
  it("accepts objects and empty text", () => {
    expect(parseRawArgs("")).toEqual({ ok: true, value: {} });
    expect(parseRawArgs('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects invalid JSON and non-objects", () => {
    expect(parseRawArgs("{a:1}")).toMatchObject({ ok: false });
    expect(parseRawArgs("[1]")).toMatchObject({ ok: false, message: expect.stringContaining("object") });
    expect(parseRawArgs("null")).toMatchObject({ ok: false });
  });
});

describe("misc", () => {
  it("stringifyArgs prints {} for empty and indents otherwise", () => {
    expect(stringifyArgs({})).toBe("{}");
    expect(stringifyArgs({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("missingRequired lists absent required keys", () => {
    const fields = fieldsFromSchema(SCHEMA);
    expect(missingRequired(fields, {})).toEqual(["sql"]);
    expect(missingRequired(fields, { sql: "" })).toEqual([]);
  });
});
