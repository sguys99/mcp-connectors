import { describe, expect, it } from "vitest";

import { suggestionKeys } from "./suggestions";

describe("suggestionKeys", () => {
  it("returns nothing when no known server is exposed", () => {
    expect(suggestionKeys([])).toEqual([]);
    expect(suggestionKeys(["custom-server"])).toEqual([]);
  });

  it("returns only the questions that fit the exposed servers", () => {
    expect(suggestionKeys(["nl2sql-mcp-http"])).toEqual(["chat.sugFilmsJuly", "chat.sugPaymentTables", "chat.sugFilmColumns"]);
    expect(suggestionKeys(["mock-repo-mcp"])).toEqual(["chat.sugRepos"]);
  });

  it("combines groups and caps the list", () => {
    const keys = suggestionKeys(["starter-mcp-http", "mock-repo-mcp", "nl2sql-mcp-http"]);
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe("chat.sugFilmsJuly");
  });
});
