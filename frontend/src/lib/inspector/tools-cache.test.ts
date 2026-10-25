import { beforeEach, describe, expect, it } from "vitest";

import { loadToolsCache, parseCache, saveToolsCache } from "./tools-cache";

const tool = { name: "echo", description: "Echo", inputSchema: {} };

describe("tools cache", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("saves and loads per server", () => {
    saveToolsCache("a", [tool], 1000);
    expect(loadToolsCache("a")).toEqual({ at: 1000, tools: [tool] });
    expect(loadToolsCache("b")).toBeNull();
  });

  it("rejects broken or empty entries", () => {
    expect(parseCache("not json")).toBeNull();
    expect(parseCache('{"at":1,"tools":[]}')).toBeNull();
    expect(parseCache('{"at":"x","tools":[]}')).toBeNull();
    expect(parseCache('{"at":1,"tools":[{"nope":1}]}')).toBeNull();
    expect(parseCache(null)).toBeNull();
  });
});
