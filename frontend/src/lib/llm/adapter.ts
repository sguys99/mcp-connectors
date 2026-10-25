// LLM 어댑터 공용 타입/인터페이스 (Phase 5-2).
// Anthropic / OpenAI / OpenRouter 의 SDK 차이를 흡수하고, 5-3 Route Handler 가
// 프로바이더 분기 없이 tool-use 루프를 실행할 수 있게 한다.
//
// PRD §3.6 (F-5 Chat) · §7.3 (tool 변환 규칙) 정본.

import "server-only";

import type { ToolMeta } from "@/lib/mcp/types";

import type { TokenUsage } from "./usage";

// 통합 히스토리. 프로바이더 무관.
// - anthropic tool_use.input 은 object 그대로
// - openai tool_calls[].function.arguments 는 JSON string
// → 통합은 object 로 보관하고, openai 측이 직렬화 시 JSON.stringify.
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolUses?: ChatToolUse[] }
  | { role: "tool_result"; toolUseId: string; content: string; isError: boolean };

export interface ChatToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// 통합 streaming event. 5-3 Route Handler 가 SSE 로 직렬화.
export type LLMEvent =
  | { type: "iteration"; index: number }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  // 제공자가 알려 준 이번 LLM 호출의 토큰 사용량. 알려 주지 않으면 이벤트를 내지 않는다 ("보고되지 않음").
  | { type: "usage"; usage: TokenUsage }
  // 수동 승인 모드: 이번 반복의 도구 호출들을 실행하지 않고 멈춘다. iterationsUsed 는 지금까지 쓴 반복 수(이번 포함)이고,
  // 이어서 요청할 때 이 값부터 반복을 센다. 바로 뒤에 done(awaiting_approval) 이 온다.
  | { type: "approval_required"; calls: ChatToolUse[]; iterationsUsed: number }
  | {
      type: "done";
      stopReason: "end_turn" | "max_iterations" | "error" | "awaiting_approval";
      error?: string;
    };

export interface ChatTurnInput {
  // 5-3 가 chat_system.md 템플릿 치환 후 전달하는 완성된 system prompt.
  system: string;
  // 직전 turn 까지 누적된 히스토리. 마지막 메시지는 user 여야 한다.
  messages: ChatMessage[];
  // MCP list_tools 결과를 그대로 사용 (PRD §7.3).
  tools: ToolMeta[];
  // 5-3 의 MCP call_tool 브릿지. content 는 직렬화된 결과 (JSON.stringify 권장).
  onToolCall: (
    name: string,
    args: unknown,
  ) => Promise<{ content: string; isError: boolean }>;
  // 기본 5 (PRD §3.6.2 step 3c).
  maxIterations?: number;
  // 이미 쓴 반복 수. 승인 뒤에 이어서 실행할 때 같은 턴의 반복 한도를 이어 센다 (iteration 이벤트의 index 도 이 값부터 시작).
  iterationOffset?: number;
  // 수동 승인 모드에서 쓴다. true 를 돌려주면 그 반복의 도구를 실행하지 않고 approval_required 로 멈춘다.
  requireApproval?: (calls: ChatToolUse[]) => boolean;
  // 5-3 의 ReadableStream cancel 시 전파.
  signal?: AbortSignal;
}

export interface LLMAdapter {
  chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent>;
}

// 5-2-3/2-4 가 공유하는 에러 → 문자열 변환 (mcp/client.ts:67 패턴).
export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// 기본 max iterations (PRD §3.6.2 step 3c). 정본은 constants.ts (클라이언트도 사용).
export { DEFAULT_MAX_ITERATIONS } from "./constants";
