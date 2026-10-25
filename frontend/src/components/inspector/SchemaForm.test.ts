import { describe, expect, it } from "vitest";

import { descriptionMentionsDefault } from "./SchemaForm";

describe("descriptionMentionsDefault", () => {
  it("detects a default already written in the tool description", () => {
    expect(descriptionMentionsDefault("Maximum number of rows to return. Default 1000, max 10000.")).toBe(true);
    expect(descriptionMentionsDefault("Defaults to 10")).toBe(true);
    expect(descriptionMentionsDefault("최대 행 수 (기본 1000)")).toBe(true);
  });

  it("is false when the description says nothing about a default", () => {
    expect(descriptionMentionsDefault("Repository name")).toBe(false);
    expect(descriptionMentionsDefault(undefined)).toBe(false);
  });
});
