import { describe, expect, it } from "vitest";

import {
  expandUriTemplate,
  isDeclared,
  promptFields,
  shortMime,
  templateFields,
  templateVariables,
} from "./primitives";

describe("isDeclared", () => {
  it("treats a present capability key, even {}, as declared", () => {
    expect(isDeclared({ tools: {}, resources: { listChanged: true } }, "resources")).toBe(true);
    expect(isDeclared({ tools: {} }, "tools")).toBe(true);
  });
  it("is false when missing, null or false", () => {
    expect(isDeclared({ tools: {} }, "prompts")).toBe(false);
    expect(isDeclared({ prompts: null }, "prompts")).toBe(false);
    expect(isDeclared({ prompts: false }, "prompts")).toBe(false);
    expect(isDeclared(null, "tools")).toBe(false);
  });
});

describe("templateVariables", () => {
  it("reads simple and operator variables once each", () => {
    expect(templateVariables("starter://greeting/{name}")).toEqual(["name"]);
    expect(templateVariables("f://{+path}/x{?page,size}{&page}")).toEqual(["path", "page", "size"]);
    expect(templateVariables("f://{id*}/{ver:3}")).toEqual(["id", "ver"]);
    expect(templateVariables("starter://logo.png")).toEqual([]);
  });
});

describe("expandUriTemplate", () => {
  it("encodes simple variables", () => {
    expect(expandUriTemplate("starter://greeting/{name}", { name: "Ada Lovelace/ß" })).toBe(
      "starter://greeting/Ada%20Lovelace%2F%C3%9F",
    );
  });
  it("keeps reserved characters for {+var}", () => {
    expect(expandUriTemplate("file://{+path}", { path: "a/b c.txt" })).toBe("file://a/b%20c.txt");
  });
  it("builds query strings and skips empty optional variables", () => {
    expect(expandUriTemplate("x://r{?page,size}", { page: "2", size: "" })).toBe("x://r?page=2");
    expect(expandUriTemplate("x://r{?page}", {})).toBe("x://r");
    expect(expandUriTemplate("x://r?a=1{&b}", { b: "2" })).toBe("x://r?a=1&b=2");
  });
  it("supports path and label expansion", () => {
    expect(expandUriTemplate("x://r{/a,b}", { a: "1", b: "2" })).toBe("x://r/1/2");
    expect(expandUriTemplate("x://r{.fmt}", { fmt: "json" })).toBe("x://r.json");
  });
});

describe("fields", () => {
  it("makes template variables required strings, query variables optional", () => {
    const fields = templateFields({ uriTemplate: "x://{id}{?page}", name: "t" });
    expect(fields).toMatchObject([
      { name: "id", kind: "string", required: true },
      { name: "page", kind: "string", required: false },
    ]);
  });
  it("maps prompt arguments to string fields", () => {
    const fields = promptFields({
      name: "p",
      arguments: [
        { name: "tool_name", description: "Tool", required: true },
        { name: "audience", required: false },
      ],
    });
    expect(fields).toMatchObject([
      { name: "tool_name", kind: "string", required: true, description: "Tool" },
      { name: "audience", kind: "string", required: false },
    ]);
  });
});

describe("shortMime", () => {
  it("shortens to the subtype", () => {
    expect(shortMime("text/markdown")).toBe("markdown");
    expect(shortMime("application/json; charset=utf-8")).toBe("json");
    expect(shortMime("image/png")).toBe("png");
    expect(shortMime(undefined)).toBeNull();
  });
});
