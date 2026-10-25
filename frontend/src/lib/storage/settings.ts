import { z } from "zod";

import { DEFAULT_MAX_ITERATIONS, MAX_ITERATIONS, MIN_ITERATIONS } from "@/lib/llm/constants";

export const SETTINGS_KEY = "mcp-connectors.settings";
// Inspector 호출 기록(lib/inspector/history.ts)이 쓰는 키. 이름은 예전 recentCalls 를 그대로 둔다.
export const RECENT_CALLS_KEY = "mcp-connectors.recentCalls";

export interface MCPSettings {
  llmProvider: "anthropic" | "openai" | "openrouter";
  anthropicApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  anthropicModel: string;
  openaiModel: string;
  openrouterModel: string;
  selectedServer: string | null;
  systemPromptOverride: string | null;
  // Chat 이 시작할 때 쓰는 최대 도구 반복 횟수. Chat 툴바에서 다음 메시지부터 바꿀 수 있지만 그 값은 저장하지 않는다.
  maxIterations: number;
}

export const DEFAULT_SETTINGS: MCPSettings = {
  llmProvider: "anthropic",
  anthropicApiKey: "",
  openaiApiKey: "",
  openrouterApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  openaiModel: "gpt-4o",
  // OpenRouter 모델 ID 는 점 표기다 (Anthropic API 의 claude-sonnet-4-6 과 다르다).
  openrouterModel: "anthropic/claude-sonnet-4.6",
  selectedServer: null,
  systemPromptOverride: null,
  maxIterations: DEFAULT_MAX_ITERATIONS,
};

const LEGACY_OPENROUTER_DEFAULT = "anthropic/claude-sonnet-4-6";

const settingsSchema = z
  .object({
    llmProvider: z.enum(["anthropic", "openai", "openrouter"]),
    anthropicApiKey: z.string(),
    openaiApiKey: z.string(),
    openrouterApiKey: z.string(),
    anthropicModel: z.string(),
    openaiModel: z.string(),
    openrouterModel: z.string(),
    selectedServer: z.string().nullable(),
    systemPromptOverride: z.string().nullable(),
    // 범위 밖의 값이 저장돼 있으면(손으로 고친 경우 등) 이 필드만 버려 기본값으로 돌아간다.
    maxIterations: z.number().int().min(MIN_ITERATIONS).max(MAX_ITERATIONS).catch(DEFAULT_MAX_ITERATIONS),
  })
  .partial();

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeSet(key: string, value: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`settings: failed to write ${key}`, err);
  }
}

export function loadSettings(): MCPSettings {
  if (!hasWindow()) return { ...DEFAULT_SETTINGS };
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (raw === null) return { ...DEFAULT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("settings: invalid JSON in localStorage, reset to defaults");
    return { ...DEFAULT_SETTINGS };
  }

  const result = settingsSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("settings: validation failed, reset to defaults", result.error);
    return { ...DEFAULT_SETTINGS };
  }
  const merged = { ...DEFAULT_SETTINGS, ...result.data };
  // 예전 기본값 "anthropic/claude-sonnet-4-6" 은 OpenRouter 에 없는 ID 라 요청이 실패한다. 손으로 바꾸지 않은 옛 기본값만 새 기본값으로 옮긴다.
  if (merged.openrouterModel === LEGACY_OPENROUTER_DEFAULT) merged.openrouterModel = DEFAULT_SETTINGS.openrouterModel;
  return merged;
}

export function saveSettings(patch: Partial<MCPSettings>): MCPSettings {
  const next = { ...loadSettings(), ...patch };
  safeSet(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function resetSettings(): MCPSettings {
  const next = { ...DEFAULT_SETTINGS };
  safeSet(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
