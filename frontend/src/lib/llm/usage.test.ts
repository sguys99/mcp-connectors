import { describe, expect, it } from "vitest";

import { addUsage, contextWindow, normalizeAnthropicUsage, normalizeOpenAIUsage, parseTokenUsage, sumUsage } from "./usage";

describe("normalizeAnthropicUsage", () => {
  it("adds cache reads and writes to the input (Anthropic's input_tokens excludes cached tokens)", () => {
    expect(
      normalizeAnthropicUsage({ input_tokens: 12, output_tokens: 30, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }),
    ).toEqual({ input: 1212, output: 30, cacheRead: 1000, cacheWrite: 200 });
  });
  it("leaves cache fields out when the provider did not send them (null counts as absent)", () => {
    expect(normalizeAnthropicUsage({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: null })).toEqual({ input: 5, output: 6 });
  });
  it.each([undefined, null, {}, { input_tokens: 1 }, { input_tokens: "1", output_tokens: 2 }, { input_tokens: -1, output_tokens: 2 }])(
    "returns null (not reported) for %j",
    (usage) => {
      expect(normalizeAnthropicUsage(usage)).toBeNull();
    },
  );
});

describe("normalizeOpenAIUsage", () => {
  it("keeps prompt_tokens as the input and reads cached tokens", () => {
    expect(normalizeOpenAIUsage({ prompt_tokens: 80, completion_tokens: 20, total_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } })).toEqual({
      input: 80,
      output: 20,
      cacheRead: 64,
    });
  });
  it("returns null when either count is missing", () => {
    expect(normalizeOpenAIUsage({ prompt_tokens: 80 })).toBeNull();
    expect(normalizeOpenAIUsage(null)).toBeNull();
  });
});

describe("sumUsage", () => {
  it("sums reported iterations, counts unreported ones, and skips in-progress ones", () => {
    const total = sumUsage([{ input: 10, output: 1, cacheRead: 4 }, null, { input: 5, output: 2 }, undefined]);
    expect(total).toEqual({ usage: { input: 15, output: 3, cacheRead: 4 }, reported: 2, total: 3 });
  });
  it("is null when nothing was reported, so the UI can say 'not reported' instead of showing zero", () => {
    expect(sumUsage([null, null])).toEqual({ usage: null, reported: 0, total: 2 });
    expect(sumUsage([])).toEqual({ usage: null, reported: 0, total: 0 });
  });
  it("addUsage keeps cache fields only when one side has them", () => {
    expect(addUsage({ input: 1, output: 1 }, { input: 2, output: 2 })).toEqual({ input: 3, output: 3 });
    expect(addUsage({ input: 1, output: 1, cacheWrite: 5 }, { input: 2, output: 2 })).toEqual({ input: 3, output: 3, cacheWrite: 5 });
  });
});

describe("parseTokenUsage", () => {
  it("accepts a valid wire object and rejects junk", () => {
    expect(parseTokenUsage({ input: 1, output: 2, cacheRead: 3 })).toEqual({ input: 1, output: 2, cacheRead: 3 });
    expect(parseTokenUsage({ input: 1 })).toBeNull();
    expect(parseTokenUsage("x")).toBeNull();
  });
});

describe("contextWindow", () => {
  it("knows the nominal window of the listed models and nothing else (no guessing)", () => {
    expect(contextWindow("anthropic", "claude-sonnet-4-6")).toBe(200_000);
    expect(contextWindow("openai", "gpt-4o")).toBe(128_000);
    expect(contextWindow("openrouter", "anthropic/claude-sonnet-4-6")).toBe(200_000);
    expect(contextWindow("openrouter", "meta-llama/llama-3.1-70b-instruct")).toBeNull();
    expect(contextWindow("openai", "gpt-unknown")).toBeNull();
  });
});
