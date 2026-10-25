// LLM 제공자와 선택 가능한 모델 목록. 설정 화면과 Chat 툴바가 함께 쓴다 (클라이언트 안전 모듈).
//
// OpenRouter 는 모델 ID 를 자유롭게 입력하므로 목록이 없다.

export type LLMProvider = "anthropic" | "openai" | "openrouter";

export const ANTHROPIC_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;
export const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini"] as const;

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

// 툴바 선택값. OpenRouter 는 모델이 입력칸에 따로 있어 제공자 이름만 값이다.
export function choiceValue(provider: LLMProvider, model: string): string {
  return provider === "openrouter" ? "openrouter" : `${provider}:${model}`;
}

export function parseChoice(value: string): { provider: LLMProvider; model: string | null } | null {
  if (value === "openrouter") return { provider: "openrouter", model: null };
  const at = value.indexOf(":");
  if (at === -1) return null;
  const provider = value.slice(0, at);
  if (provider !== "anthropic" && provider !== "openai") return null;
  return { provider, model: value.slice(at + 1) };
}

// 설정에 저장된 모델이 목록에 없으면(예전 값) 맨 앞에 더해 선택 상태가 사라지지 않게 한다.
export function modelOptions(provider: "anthropic" | "openai", current: string): string[] {
  const base: readonly string[] = provider === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
  return base.includes(current) || current.length === 0 ? [...base] : [current, ...base];
}
