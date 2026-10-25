// OpenRouter 어댑터 (Phase 5-2-5).
// OpenAI 호환 엔드포인트이므로 openai.ts 의 헬퍼를 baseURL + 권장 헤더만 바꿔 재사용.
// 모델명은 "provider/model" 형식 (예: anthropic/claude-sonnet-4.6, openai/gpt-4o). OpenRouter 의 Anthropic ID 는 점 표기다.

import "server-only";

import type { LLMAdapter } from "./adapter";
import { createOpenAICompatAdapter } from "./openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter analytics 권장 헤더 (https://openrouter.ai/docs/api-reference/overview).
// MVP 는 localhost 도메인 하드코딩 — 프로덕션 도메인 분기는 향후 env 로.
const DEFAULT_HEADERS = {
  "HTTP-Referer": "http://localhost:3000",
  "X-Title": "mcp-connectors",
};

export function createOpenRouterAdapter(
  apiKey: string,
  model: string,
): LLMAdapter {
  return createOpenAICompatAdapter({
    apiKey,
    model,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: DEFAULT_HEADERS,
  });
}
