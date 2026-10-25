import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  resetSettings,
  saveSettings,
} from "./settings";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSettings — defaults & recovery", () => {
  it("returns DEFAULT_SETTINGS when key is absent", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("recovers DEFAULT_SETTINGS on corrupt JSON", () => {
    localStorage.setItem(SETTINGS_KEY, "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    warn.mockRestore();
  });

  it("recovers DEFAULT_SETTINGS on type drift", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ llmProvider: 42 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    warn.mockRestore();
  });

  it("merges missing fields with DEFAULT_SETTINGS (forward-compat)", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ llmProvider: "openai" }));
    const loaded = loadSettings();
    expect(loaded.llmProvider).toBe("openai");
    expect(loaded.anthropicModel).toBe(DEFAULT_SETTINGS.anthropicModel);
    expect(loaded.openaiModel).toBe(DEFAULT_SETTINGS.openaiModel);
    expect(loaded.anthropicApiKey).toBe("");
    expect(loaded.selectedServer).toBeNull();
  });

  it("DEFAULT_SETTINGS exposes openrouter fields with expected defaults", () => {
    expect(DEFAULT_SETTINGS.openrouterApiKey).toBe("");
    expect(DEFAULT_SETTINGS.openrouterModel).toBe("anthropic/claude-sonnet-4.6");
  });

  it("moves the old invalid OpenRouter default to the dotted ID, keeps a model the user typed", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ openrouterModel: "anthropic/claude-sonnet-4-6" }));
    expect(loadSettings().openrouterModel).toBe("anthropic/claude-sonnet-4.6");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ openrouterModel: "google/gemini-2.5-pro" }));
    expect(loadSettings().openrouterModel).toBe("google/gemini-2.5-pro");
  });

  it("merges openrouter fields when legacy settings (without them) are loaded", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        llmProvider: "openai",
        anthropicApiKey: "sk-ant",
        openaiApiKey: "sk-oa",
        anthropicModel: "claude-sonnet-4-6",
        openaiModel: "gpt-4o",
      }),
    );
    const loaded = loadSettings();
    expect(loaded.openrouterApiKey).toBe(DEFAULT_SETTINGS.openrouterApiKey);
    expect(loaded.openrouterModel).toBe(DEFAULT_SETTINGS.openrouterModel);
  });
});

describe("saveSettings — round-trip & partial merge", () => {
  it("round-trips a single field, leaving rest at defaults", () => {
    saveSettings({ anthropicApiKey: "sk-x" });
    const loaded = loadSettings();
    expect(loaded.anthropicApiKey).toBe("sk-x");
    expect(loaded.llmProvider).toBe(DEFAULT_SETTINGS.llmProvider);
    expect(loaded.openaiApiKey).toBe(DEFAULT_SETTINGS.openaiApiKey);
  });

  it("accumulates two partial saves without losing earlier fields", () => {
    saveSettings({ anthropicApiKey: "a" });
    saveSettings({ openaiApiKey: "b" });
    const loaded = loadSettings();
    expect(loaded.anthropicApiKey).toBe("a");
    expect(loaded.openaiApiKey).toBe("b");
  });

  it("round-trips selectedServer (form-external write path)", () => {
    saveSettings({ selectedServer: "starter-mcp" });
    expect(loadSettings().selectedServer).toBe("starter-mcp");
  });

  it("round-trips openrouter provider + api key + model", () => {
    saveSettings({
      llmProvider: "openrouter",
      openrouterApiKey: "sk-or-12345",
      openrouterModel: "openai/gpt-4o",
    });
    const loaded = loadSettings();
    expect(loaded.llmProvider).toBe("openrouter");
    expect(loaded.openrouterApiKey).toBe("sk-or-12345");
    expect(loaded.openrouterModel).toBe("openai/gpt-4o");
  });
});

describe("resetSettings", () => {
  it("writes DEFAULT_SETTINGS and returns the same object shape", () => {
    saveSettings({ anthropicApiKey: "sk-x", llmProvider: "openai" });
    const result = resetSettings();
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("SSR safety", () => {
  const realWindow = globalThis.window;
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: realWindow,
      configurable: true,
      writable: true,
    });
  });

  it("loadSettings returns DEFAULT_SETTINGS without throwing when window is undefined", () => {
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("maxIterations (P5-6)", () => {
  it("defaults to 5 and keeps a saved in-range value", () => {
    expect(loadSettings().maxIterations).toBe(5);
    saveSettings({ maxIterations: 12 });
    expect(loadSettings().maxIterations).toBe(12);
  });

  it("falls back to the default for an out-of-range stored value without resetting the other fields", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ llmProvider: "openai", maxIterations: 500 }));
    const loaded = loadSettings();
    expect(loaded.maxIterations).toBe(5);
    expect(loaded.llmProvider).toBe("openai");
  });
});
