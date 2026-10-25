// 수동 승인 뒤에 이어서 실행하는 요청(resume)의 검증 (서버 전용, 순수 함수).
//
// 클라이언트가 보낸 것은 모두 신뢰하지 않는다. 이어서 실행하기 전에 다음을 모두 확인한다.
//   1. 대화 기록의 마지막이 "도구 호출을 가진 assistant 메시지"다 (그 호출들이 승인 대기 대상이다).
//   2. 대기 호출의 결과를 클라이언트가 먼저 채워 보내지 않았다. 결과는 서버가 승인된 호출을 직접 실행해서 만든 것만 쓴다.
//      기록의 끝이 대기 중인 assistant 메시지여야 하므로 그 호출들의 결과가 뒤에 올 수 없고, 결과를 채워 보낸 요청(끝이 tool_result)은
//      forged_result 로 거부한다. 앞쪽 기록에 같은 id 의 결과가 있어도 거부하지 않는다: 그것은 이전 반복이나 턴의 정상적인 맥락일 뿐
//      서버가 실행하거나 승인하는 근거로 쓰지 않고(id 를 재사용하는 호환 서버가 있다), 승인 토큰이 호출의 id, 이름, 입력을 묶는다.
//   3. 승인 토큰의 서명이 대기 호출의 id, 이름, 입력과 사용한 반복 수에 맞고 만료되지 않았다 (lib/chat/approval-token.ts).
//      호출을 바꾸거나 다른 대화에서 가져온 토큰은 서명이 맞지 않는다.
//   4. 결정은 대기 호출과 정확히 일치한다: 모르는 id 도, 중복도, 빠진 호출도 없다.
//   5. 토큰은 한 번만 받아들인다. 모든 검사를 통과하면 nonce 를 사용 처리하고, 다시 보내면 token_used 로 거부한다.
// 이 이전의 대화 기록(앞선 턴의 도구 결과 등)은 지금처럼 모델에게 줄 맥락일 뿐이고 서버가 실행하거나 승인하는 근거로 쓰지 않는다.

import "server-only";

import type { ChatMessage, ChatToolUse } from "@/lib/llm/adapter";

import { consumeApproval, verifyApproval } from "./approval-token";

export type Decision = "approve" | "deny";

export interface ResumeInput {
  token: string;
  decisions: { toolUseId: string; decision: Decision }[];
}

export type ResumeError = "no_pending" | "forged_result" | "token_invalid" | "token_expired" | "token_used" | "bad_decisions";

export type ResumeCheck =
  | { ok: true; pending: ChatToolUse[]; iterationsUsed: number; decisions: Map<string, Decision> }
  | { ok: false; code: ResumeError; error: string };

const fail = (code: ResumeError, error: string): ResumeCheck => ({ ok: false, code, error });

export function checkResume(messages: readonly ChatMessage[], resume: ResumeInput, now: number = Date.now()): ResumeCheck {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !last.toolUses || last.toolUses.length === 0) {
    // 마지막 도구 호출 묶음 뒤에 그 호출들의 결과가 붙어 있다면 클라이언트가 결과를 채워 보낸 것이다.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role !== "assistant" || !m.toolUses || m.toolUses.length === 0) continue;
      const callIds = new Set(m.toolUses.map((c) => c.id));
      if (messages.slice(i + 1).some((x) => x.role === "tool_result" && callIds.has(x.toolUseId))) {
        return fail("forged_result", "The request supplies results for tool calls that were never executed by the server. Results are produced by the server only.");
      }
      break;
    }
    return fail("no_pending", "Nothing is waiting for approval: the conversation must end with an assistant message that has tool calls.");
  }
  const pending = last.toolUses;
  const ids = new Set(pending.map((c) => c.id));
  if (ids.size !== pending.length) return fail("token_invalid", "The pending tool calls are invalid (duplicate ids).");

  const check = verifyApproval(resume.token, pending, now);
  if (!check.ok) {
    if (check.reason === "expired") return fail("token_expired", "The approval expired. Ask the model to run the tool again.");
    if (check.reason === "used") {
      return fail("token_used", "This approval was already used. Each approval runs once; ask the model to run the tool again.");
    }
    return fail(
      "token_invalid",
      "The approval does not match the pending tool calls. Either the calls were changed, or the server that issued it restarted " +
        "or is a different instance: without CHAT_APPROVAL_SECRET each server process signs with its own random key.",
    );
  }

  const decisions = new Map<string, Decision>();
  for (const d of resume.decisions) {
    if (!ids.has(d.toolUseId) || decisions.has(d.toolUseId)) {
      return fail("bad_decisions", `Unexpected or duplicate decision for '${d.toolUseId}'.`);
    }
    decisions.set(d.toolUseId, d.decision);
  }
  if (decisions.size !== ids.size) return fail("bad_decisions", "Every pending tool call needs a decision.");

  // 모든 검사를 통과한 뒤에만 사용 처리한다 (잘못된 결정으로 거부된 요청은 토큰을 태우지 않는다).
  consumeApproval(check.nonce, check.issuedAt);
  return { ok: true, pending, iterationsUsed: check.iterationsUsed, decisions };
}

// 거부한 호출에 모델이 받는 결과. 모델이 같은 호출을 되풀이하지 않고 사용자에게 방향을 묻게 한다.
export function denialMessage(toolName: string): string {
  return `The user denied this call to '${toolName}', so it was not executed. Do not retry the same call. Tell the user what you could not do and ask how to proceed, or continue without it.`;
}
