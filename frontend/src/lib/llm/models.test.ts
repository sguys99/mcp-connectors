import { describe, expect, it } from "vitest";

import { choiceValue, modelOptions, parseChoice } from "./models";

describe("model choices", () => {
  it("round-trips provider and model through the select value", () => {
    expect(choiceValue("anthropic", "claude-sonnet-4-6")).toBe("anthropic:claude-sonnet-4-6");
    expect(parseChoice("anthropic:claude-sonnet-4-6")).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
    expect(parseChoice("openai:gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("uses only the provider for OpenRouter and rejects unknown values", () => {
    expect(choiceValue("openrouter", "anthropic/claude-sonnet-4-6")).toBe("openrouter");
    expect(parseChoice("openrouter")).toEqual({ provider: "openrouter", model: null });
    expect(parseChoice("foo:bar")).toBeNull();
    expect(parseChoice("nonsense")).toBeNull();
  });

  it("keeps a saved model that is not in the list", () => {
    expect(modelOptions("openai", "gpt-4o")).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(modelOptions("openai", "gpt-4-turbo")).toEqual(["gpt-4-turbo", "gpt-4o", "gpt-4o-mini"]);
  });
});
