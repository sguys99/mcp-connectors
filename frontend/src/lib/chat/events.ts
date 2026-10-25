// Chat SSE 선(wire) 이벤트 타입. 서버(api/chat)와 브라우저(parseSSE, serialize)가 함께 쓰는 클라이언트 안전 모듈이다.
//
// 어댑터가 내는 LLMEvent 에 서버 측 시각을 더한 것이다. 필드는 모두 선택이라 시각이 없는 예전 스트림도 그대로 읽힌다.
//   t          실행(run) 시작을 0 으로 한 서버 측 경과 시간(ms, 소수 한 자리). 서버가 이벤트를 흘려보내는 순간에 잰다.
//   server     도구를 가진 MCP 서버 이름. 서버가 여러 개면 LLM 에게는 `server__tool` 로 보이지만 여기에는 따로 담는다.
//   tool       서버 쪽 원래 도구 이름
//
// LLM 호출 구간은 별도 이벤트 없이 이 시각으로 만든다. iteration 이벤트가 요청 시작이고, 같은 반복의 첫 tool_use
// (또는 done)가 응답이 끝난 시점이다 (어댑터가 최종 메시지를 받은 뒤에야 tool_use 를 내보내기 때문).

import type { ChatToolUse, LLMEvent } from "@/lib/llm/adapter";

type Timed<E> = E & { t?: number };

export interface RunStartEvent {
  type: "run_start";
  // 항상 0
  t: number;
  // 서버 시계의 실행 시작 시각 (epoch ms). 화면에 시각을 표시할 때만 쓴다.
  startedAt: number;
}

export type IterationWire = Timed<Extract<LLMEvent, { type: "iteration" }>>;
export type TextDeltaWire = Timed<Extract<LLMEvent, { type: "text_delta" }>>;
// resumed: 승인 뒤에 이어서 실행하는 요청의 tool_use 다. 화면에는 승인 대기 카드가 이미 있으므로 새 카드를 만들지 않고 실행 시작만 알린다.
export type ToolUseWire = Timed<Extract<LLMEvent, { type: "tool_use" }>> & { server?: string; tool?: string; resumed?: boolean };
// denied: 사용자가 거부해서 실행하지 않은 호출의 결과다 (content 는 모델에게 간 거부 안내, isError 는 true).
export type ToolResultWire = Timed<Extract<LLMEvent, { type: "tool_result" }>> & { server?: string; tool?: string; denied?: boolean };
export type UsageWire = Timed<Extract<LLMEvent, { type: "usage" }>>;
export type DoneWire = Timed<Extract<LLMEvent, { type: "done" }>>;

// 수동 승인 모드: 이 반복의 도구 호출들이 사용자 결정을 기다린다. 이 이벤트 뒤에 done(awaiting_approval) 로 스트림이 끝난다.
// allowed 는 "이 대화에서 항상 허용" 목록에 있어서 결정이 필요 없는 호출이다. token 은 이어서 요청할 때 그대로 돌려보낸다 (lib/chat/approval-token.ts).
export interface ApprovalCall extends ChatToolUse {
  server?: string;
  tool?: string;
  allowed: boolean;
}
export type ApprovalRequiredWire = Timed<{
  type: "approval_required";
  calls: ApprovalCall[];
  token: string;
  iterationsUsed: number;
}>;

export type WireEvent =
  | RunStartEvent
  | IterationWire
  | TextDeltaWire
  | ToolUseWire
  | ToolResultWire
  | UsageWire
  | ApprovalRequiredWire
  | DoneWire;

// 알려진 이벤트인지 확인한다. 앞으로 서버가 새 이벤트를 더해도 예전 화면이 깨지지 않게 reducer 가 모르는 타입은 무시한다.
const KNOWN = new Set<string>(["run_start", "iteration", "text_delta", "tool_use", "tool_result", "usage", "approval_required", "done"]);

export function isWireEvent(value: unknown): value is WireEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && KNOWN.has(type);
}
