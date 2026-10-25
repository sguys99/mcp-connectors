import { beforeEach, describe, expect, it } from "vitest";

import { loadPrimitivesCache, parsePrimitivesCache, savePrimitivesCache } from "./primitives-cache";

const info = { serverInfo: { name: "s", version: "1" }, protocolVersion: "2025-11-25", capabilities: { resources: {} } };

describe("primitives cache", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("saves and loads per server", () => {
    savePrimitivesCache(
      "a",
      { info, resources: [{ uri: "u://1", name: "one" }], templates: [{ uriTemplate: "u://{x}", name: "t" }], prompts: [{ name: "p", arguments: [] }] },
      1000,
    );
    expect(loadPrimitivesCache("a")).toMatchObject({ at: 1000, info, resources: [{ uri: "u://1" }], templates: [{ uriTemplate: "u://{x}" }], prompts: [{ name: "p" }] });
    expect(loadPrimitivesCache("b")).toBeNull();
  });

  it("rejects broken entries and drops malformed items", () => {
    expect(parsePrimitivesCache("nope")).toBeNull();
    expect(parsePrimitivesCache('{"at":"x"}')).toBeNull();
    expect(parsePrimitivesCache(null)).toBeNull();
    const cache = parsePrimitivesCache(JSON.stringify({ at: 1, info: { bad: true }, resources: [{ nope: 1 }, { uri: "u://ok", name: "ok" }], templates: "x", prompts: [{ name: "p" }] }));
    expect(cache).toMatchObject({ info: null, resources: [{ uri: "u://ok" }], templates: [], prompts: [{ name: "p", arguments: [] }] });
  });
});
