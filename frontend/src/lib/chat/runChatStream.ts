// Phase 5-4: fetch + SSE 디코딩의 순수 비동기 코어.
// hook (useChatStream) 의 React state 의존을 분리해 단위 테스트가 가능하게 한다.

import type { ChatMessage } from "@/lib/llm/adapter";

import type { WireEvent } from "./events";

import { parseSSEStream } from "./parseSSE";

export interface ChatStreamRequest {
  provider: "anthropic" | "openai" | "openrouter";
  apiKey?: string;
  model: string;
  // 모델에 노출할 서버들. 둘 이상이면 서버가 도구 이름에 `server__` 접두를 붙여 충돌을 피한다.
  serverNames: string[];
  // 프록시 방식 런타임 서버의 정의 (serverNames 에 있는 것만). 서버가 MCP_ALLOW_RUNTIME_PROXY=true 일 때만 받는다.
  runtimeServers?: { name: string; url: string; headers: Record<string, string> }[];
  messages: ChatMessage[];
  systemPromptOverride?: string | null;
  maxIterations?: number;
  // 수동 승인 모드 (생략하면 auto)와 "항상 허용" 도구 이름
  approval?: "auto" | "manual";
  allowTools?: string[];
  // 승인 뒤 이어서 실행: approval_required 에서 받은 토큰과 호출별 결정. messages 는 승인 대기 중인 assistant 메시지로 끝나야 한다.
  resume?: { token: string; decisions: { toolUseId: string; decision: "approve" | "deny" }[] };
}

export type ChatStreamOutcome =
  | { kind: "ok" }
  | { kind: "http_error"; status: number; message: string }
  | { kind: "abort" }
  | { kind: "exception"; message: string };

const CHAT_API_PATH = "/api/chat";

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// /api/chat 으로 POST + SSE 응답 디코드. 각 WireEvent 를 onEvent 콜백으로 전달.
// 어떤 분기에서도 throw 하지 않는다 — 모든 종료 경로를 ChatStreamOutcome 으로 보고.
export async function runChatStream(
  request: ChatStreamRequest,
  signal: AbortSignal,
  onEvent: (ev: WireEvent) => void,
): Promise<ChatStreamOutcome> {
  let response: Response;
  try {
    response = await fetch(CHAT_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) return { kind: "abort" };
    return { kind: "exception", message: toMessage(err) };
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await response.json()) as { error?: string };
        if (typeof body.error === "string" && body.error.length > 0) {
          message = body.error;
        }
      } catch {
        // JSON parse 실패 → 그대로 status text 유지.
      }
    } else {
      try {
        const text = await response.text();
        if (text.length > 0) message = text;
      } catch {
        // text 읽기 실패 → 그대로 status text 유지.
      }
    }
    return { kind: "http_error", status: response.status, message };
  }

  if (!response.body) {
    return { kind: "exception", message: "Response has no body stream" };
  }

  try {
    for await (const ev of parseSSEStream(response.body)) {
      onEvent(ev);
    }
    return { kind: "ok" };
  } catch (err) {
    if (isAbortError(err)) return { kind: "abort" };
    return { kind: "exception", message: toMessage(err) };
  }
}
