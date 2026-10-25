// Phase 5-4: Chat UI 상태 모델 + adapter ChatMessage[] 직렬화 + LLMEvent reducer.
//
// 핵심 아이디어:
//   - 페이지 UI 는 turn 단위 (ChatTurn[]) 로 상태를 관리해 카드 렌더가 간단.
//   - adapter 의 ChatMessage[] 는 1 iteration = 1 assistant message 분리 → tool_result 메시지가 그 사이에 끼는 형식.
//   - 두 표현 사이 변환을 본 파일이 책임진다.
//
// 의존: adapter.ts 의 type-only import 만 사용 (server-only 우회).

import type { ChatMessage, ChatToolUse } from "@/lib/llm/adapter";
import { parseTokenUsage, type TokenUsage } from "@/lib/llm/usage";

import type { WireEvent } from "./events";

// ---------- UI-friendly types ---------- //

// 수동 승인 모드에서 도구 호출 하나의 승인 상태. 모든 시각은 같은 시계(실행 시작이 0인 서버 측 ms, 승인 대기 시간을 포함한 절대값)다.
export interface ToolApproval {
  // pending 사용자 결정 전, approved 승인함(아직 안 돌았을 수 있음), denied 거부함(실행하지 않음)
  state: "pending" | "approved" | "denied";
  // 대기를 시작한 시각과 결정한 시각. 둘의 차이가 승인 대기 시간이고 도구 실행 시간에 들어가지 않는다.
  waitStartT: number;
  decidedT?: number;
  // 이 대화의 "항상 허용" 목록 때문에 묻지 않고 승인됨
  auto?: boolean;
  // 이 카드에서 "항상 허용"을 함께 골라 승인함
  always?: boolean;
  // 대기를 시작한 브라우저 시각 (performance.now). 대기 타이머 표시에만 쓰고 저장하거나 다른 곳에 옮기지 않는다.
  waitStartClient?: number;
}

export interface ChatToolUseWithResult {
  id: string;
  // LLM 이 부른 이름. 서버가 여러 개면 `server__tool` 이다. 다음 요청의 히스토리에는 이 이름을 그대로 돌려보낸다.
  name: string;
  input: Record<string, unknown>;
  // null = adapter 가 onToolCall 결과를 아직 yield 하지 않음 (MCP 호출 진행 중).
  result: { content: string; isError: boolean } | null;
  // 화면 표시용: 서버 이름과 서버 쪽 원래 도구 이름 (서버가 알려 줄 때만).
  server?: string;
  tool?: string;
  // 서버 측 시각(ms, 실행 시작이 0). startT 는 호출을 시작한 시점, endT 는 결과가 나온 시점이다.
  startT?: number;
  endT?: number;
  // 수동 승인 모드에서만 있다. 자동 모드의 호출에는 없다.
  approval?: ToolApproval;
}

export interface AssistantIteration {
  text: string;
  toolUses: ChatToolUseWithResult[];
  // 제공자가 알려 준 이 LLM 호출의 토큰 사용량. null 은 응답은 끝났는데 알려 주지 않음("보고되지 않음"), undefined 는 아직 진행 중이다.
  usage?: TokenUsage | null;
  // LLM 요청을 시작한 시각(iteration 이벤트)과 응답이 끝난 시각(첫 tool_use 또는 done).
  startT?: number;
  llmEndT?: number;
}

export type AssistantTurn = {
  // React key 용 안정 id (MessageList). initStreamingState 가 발급해 done 시 그대로 옮긴다.
  id: string;
  role: "assistant";
  iterations: AssistantIteration[];
  // aborted = 사용자가 Stop 으로 멈춤. 서버는 done 을 보내지 못하므로 화면이 직접 만든다.
  // awaiting_approval = 수동 승인 모드에서 도구 호출의 사용자 결정을 기다리는 중 (awaiting 에 이어서 요청할 정보가 있다)
  stopReason: "end_turn" | "max_iterations" | "error" | "aborted" | "awaiting_approval";
  error?: string;
  awaiting?: AwaitingApproval;
  // 이 turn 에 적용된 도구 호출 최대 횟수 (max_iterations 알림 표시용).
  maxIterations?: number;
  // 응답한 모델 이름 (메시지 머리와 LLM 스팬 이름).
  model?: string;
  // 실행을 시작한 시각 (epoch ms, 서버 시계). 메시지 머리의 시각 표시용.
  startedAt?: number;
  // 실행이 끝난 서버 측 시각(ms). 없으면 아직 진행 중이다.
  endT?: number;
  // 저장된 대화를 다시 열었을 때 승인 대기가 만료됨 (서명 토큰은 프로세스마다, 30분마다 무효). 호출은 실행되지 않았다 (P5-7).
  expired?: boolean;
};

// 승인 대기 중인 턴에 남는 정보. token 은 이어서 요청할 때 그대로 돌려보낸다.
export interface AwaitingApproval {
  token: string;
  // 멈춘 시각 (실행 시작이 0인 절대 시각, ms)과 그때의 브라우저 시각 (performance.now)
  pausedAtT: number;
  clientAt: number;
}

export type UserTurn = { id: string; role: "user"; content: string; at?: number };

// turn id 발급. crypto.randomUUID 가 없는 환경 (비보안 origin 등) 은 카운터로 대체.
let turnCounter = 0;
export function newTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  turnCounter += 1;
  return `turn-${Date.now()}-${turnCounter}`;
}

export type ChatTurn = UserTurn | AssistantTurn;

// ---------- Streaming state ---------- //

export interface StreamingState {
  turnId: string;
  currentText: string;
  currentIterationToolUses: ChatToolUseWithResult[];
  committedIterations: AssistantIteration[];
  iterationIndex: number;
  // 현재 반복의 LLM 시작/종료 시각 (서버 측 ms).
  currentStartT?: number;
  currentLlmEndT?: number;
  // 현재 반복에서 제공자가 알려 준 토큰 사용량
  currentUsage?: TokenUsage;
  // 승인 뒤 이어서 실행하는 요청의 이벤트 시각에 더하는 값 (앞선 구간 + 승인 대기 시간). 처음 요청은 0.
  tOffset: number;
  // approval_required 를 받았으면 그 정보
  awaiting?: AwaitingApproval;
  // 첫 이벤트를 받은 브라우저 시각 (performance.now). 진행 중 스팬의 경과 시간을 재는 기준이다.
  clientT0: number | null;
  startedAt?: number;
  // 지금까지 본 가장 늦은 서버 측 시각
  lastT: number;
}

export function initStreamingState(turnId: string = newTurnId()): StreamingState {
  return {
    turnId,
    currentText: "",
    currentIterationToolUses: [],
    committedIterations: [],
    iterationIndex: 0,
    clientT0: null,
    lastT: 0,
    tOffset: 0,
  };
}

// 현재 반복의 사용량: 알려 준 값이 있으면 그것, 응답이 끝났는데 없으면 null(보고되지 않음), 진행 중이면 undefined.
function currentIterationUsage(state: StreamingState, ended: boolean): TokenUsage | null | undefined {
  if (state.currentUsage) return state.currentUsage;
  return ended ? null : undefined;
}

// ---------- Reducer ---------- //

export type ReducerResult =
  | { kind: "streaming"; next: StreamingState }
  | { kind: "done"; turn: AssistantTurn };

// 이벤트에 서버 시각(t)이 없으면 (예전 서버) 브라우저가 받은 시각으로 대신한다.
// 서버 시각은 이 요청이 시작한 때가 0이라 승인 뒤 이어서 실행한 요청이면 앞선 구간(tOffset)을 더해 한 시계로 맞춘다.
function eventTime(state: StreamingState, event: WireEvent, now: number): { t: number; clientT0: number } {
  const clientT0 = state.clientT0 ?? now;
  const t = typeof event.t === "number" ? event.t + state.tOffset : Math.max(0, now - clientT0);
  return { t, clientT0 };
}

// WireEvent 1개를 streaming state 에 반영. done 이벤트만 ChatTurn 으로 마감.
// now 는 브라우저의 performance.now() 로, 첫 이벤트의 기준점과 시각이 없는 이벤트의 대체값에만 쓴다 (테스트에서는 생략 가능).
export function applyLLMEvent(state: StreamingState, event: WireEvent, now: number = 0): ReducerResult {
  const { t, clientT0 } = eventTime(state, event, now);
  const base: StreamingState = { ...state, clientT0, lastT: Math.max(state.lastT, t) };

  switch (event.type) {
    case "run_start": {
      // 이어서 실행하는 요청이면 처음 시작 시각을 유지한다.
      return { kind: "streaming", next: { ...base, startedAt: base.startedAt ?? event.startedAt } };
    }

    case "iteration": {
      const hasCurrent = base.currentText.length > 0 || base.currentIterationToolUses.length > 0;
      if (!hasCurrent) {
        // 첫 iteration (index 0) 이거나 직전 iteration 이 즉시 마감된 경우.
        return {
          kind: "streaming",
          next: { ...base, iterationIndex: event.index, currentStartT: t, currentLlmEndT: undefined, currentUsage: undefined },
        };
      }
      return {
        kind: "streaming",
        next: {
          ...base,
          currentText: "",
          currentIterationToolUses: [],
          committedIterations: [
            ...base.committedIterations,
            {
              text: base.currentText,
              toolUses: base.currentIterationToolUses,
              startT: base.currentStartT,
              llmEndT: base.currentLlmEndT,
              usage: currentIterationUsage(base, base.currentLlmEndT !== undefined),
            },
          ],
          iterationIndex: event.index,
          currentStartT: t,
          currentLlmEndT: undefined,
          currentUsage: undefined,
        },
      };
    }

    case "text_delta": {
      return { kind: "streaming", next: { ...base, currentText: base.currentText + event.text } };
    }

    case "tool_use": {
      // 승인 뒤 이어서 실행하는 요청의 tool_use 는 이미 있는 승인 카드의 실행 시작이다. 새 카드를 만들지 않는다.
      const existing = base.currentIterationToolUses.find((tool) => tool.id === event.id);
      if (existing) {
        return {
          kind: "streaming",
          next: {
            ...base,
            currentIterationToolUses: base.currentIterationToolUses.map((tool) =>
              tool.id === event.id ? { ...tool, startT: t, ...(event.server ? { server: event.server } : {}), ...(event.tool ? { tool: event.tool } : {}) } : tool,
            ),
          },
        };
      }
      return {
        kind: "streaming",
        next: {
          ...base,
          // 어댑터는 LLM 응답을 다 받은 뒤에 tool_use 를 내보내므로, 반복의 첫 tool_use 가 LLM 구간의 끝이다.
          currentLlmEndT: base.currentLlmEndT ?? t,
          currentIterationToolUses: [
            ...base.currentIterationToolUses,
            {
              id: event.id,
              name: event.name,
              input: event.input,
              result: null,
              ...(event.server ? { server: event.server } : {}),
              ...(event.tool ? { tool: event.tool } : {}),
              startT: t,
            },
          ],
        },
      };
    }

    case "usage": {
      const usage = parseTokenUsage(event.usage);
      return { kind: "streaming", next: usage ? { ...base, currentUsage: usage } : base };
    }

    case "approval_required": {
      return {
        kind: "streaming",
        next: {
          ...base,
          currentLlmEndT: base.currentLlmEndT ?? t,
          // 어댑터는 승인을 기다리기 전에 tool_use 를 내보내지 않으므로 이 반복의 호출은 모두 여기서 만든다. 실행 시작(startT)은 승인 뒤에 정해진다.
          currentIterationToolUses: event.calls.map((call) => ({
            id: call.id,
            name: call.name,
            input: call.input,
            result: null,
            ...(call.server ? { server: call.server } : {}),
            ...(call.tool ? { tool: call.tool } : {}),
            approval: call.allowed
              ? { state: "approved" as const, waitStartT: t, decidedT: t, auto: true }
              : { state: "pending" as const, waitStartT: t, waitStartClient: now },
          })),
          awaiting: { token: event.token, pausedAtT: t, clientAt: now },
        },
      };
    }

    case "tool_result": {
      const result = { content: event.content, isError: event.isError };
      const fill = (tool: ChatToolUseWithResult): ChatToolUseWithResult =>
        tool.id === event.toolUseId
          ? {
              ...tool,
              result,
              endT: t,
              ...(tool.server || !event.server ? {} : { server: event.server }),
              ...(tool.tool || !event.tool ? {} : { tool: event.tool }),
              ...(event.denied && tool.approval ? { approval: { ...tool.approval, state: "denied" as const, decidedT: tool.approval.decidedT ?? t } } : {}),
            }
          : tool;
      // 대부분 현재 iteration 에서 발견. 안 보이면 committed 도 훑는다.
      if (base.currentIterationToolUses.some((tool) => tool.id === event.toolUseId)) {
        return { kind: "streaming", next: { ...base, currentIterationToolUses: base.currentIterationToolUses.map(fill) } };
      }
      return {
        kind: "streaming",
        next: {
          ...base,
          committedIterations: base.committedIterations.map((it) => ({ ...it, toolUses: it.toolUses.map(fill) })),
        },
      };
    }

    case "done": {
      const tail: AssistantIteration = {
        text: base.currentText,
        toolUses: base.currentIterationToolUses,
        startT: base.currentStartT,
        // 도구를 부르지 않고 끝난 반복은 done 이 LLM 응답의 끝이다.
        llmEndT: base.currentLlmEndT ?? t,
        usage: currentIterationUsage(base, true),
      };
      // 승인 대기로 끝났는데 approval_required 가 없었다면 이어갈 방법이 없으므로 오류로 마감한다.
      if (event.stopReason === "awaiting_approval" && !base.awaiting) {
        return { kind: "done", turn: finishTurn(base, [...base.committedIterations, tail], "error", t, "The approval request was incomplete.") };
      }
      return { kind: "done", turn: finishTurn(base, [...base.committedIterations, tail], event.stopReason, t, event.error) };
    }
  }
  // 모르는 이벤트 타입 (서버가 앞서 업데이트된 경우)은 상태를 바꾸지 않는다.
  return { kind: "streaming", next: state };
}

function finishTurn(
  state: StreamingState,
  iterations: AssistantIteration[],
  stopReason: AssistantTurn["stopReason"],
  endT: number,
  error?: string,
): AssistantTurn {
  return {
    id: state.turnId,
    role: "assistant",
    iterations,
    stopReason,
    ...(error ? { error } : {}),
    ...(stopReason === "awaiting_approval" && state.awaiting ? { awaiting: state.awaiting } : {}),
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    endT,
  };
}

// 사용자가 Stop 으로 멈췄을 때: 지금까지 받은 내용을 그대로 turn 으로 확정한다.
// 서버는 done 을 보내지 못하므로 멈춘 시각은 브라우저가 잰 경과 시간(now - clientT0)과 마지막 서버 시각 중 큰 값이다.
export function abortStreaming(state: StreamingState, now: number): AssistantTurn {
  const elapsed = state.clientT0 === null ? state.lastT : Math.max(state.lastT, now - state.clientT0);
  const tail: AssistantIteration = {
    text: state.currentText,
    toolUses: state.currentIterationToolUses,
    startT: state.currentStartT,
    llmEndT: state.currentLlmEndT,
    usage: currentIterationUsage(state, state.currentLlmEndT !== undefined),
  };
  return finishTurn(state, [...state.committedIterations, tail], "aborted", elapsed);
}

// ---------- Serialization to adapter ChatMessage[] ---------- //

// UI ChatTurn[] → adapter ChatMessage[]. 다음 turn 의 POST body 에 사용.
// 미완료 tool 호출 (result === null) 은 tool_use 와 tool_result 를 모두 직렬화하지 않는다
// — adapter 가 매칭 안 되는 toolUse 를 거부하므로 짝이 없는 것은 제거.
//
// keepPendingOf: 승인 뒤 이어서 요청할 때 그 턴의 마지막 반복은 결과 없는 도구 호출(승인 대기 중이던 것)을 그대로 싣는다.
// 서버가 이 호출들을 서명 토큰과 대조해 확인하고 직접 실행한 결과만 붙인다 (lib/chat/resume.ts).
export function serializeToChatMessages(turns: ChatTurn[], keepPendingOf?: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      out.push({ role: "user", content: turn.content });
      continue;
    }
    turn.iterations.forEach((it, index) => {
      // 결과가 없는 도구 호출(Stop 으로 멈춘 것)은 assistant 메시지에서도 뺀다.
      // tool_use 만 있고 tool_result 가 없으면 LLM API 가 요청을 거부한다.
      const keepPending = turn.id === keepPendingOf && index === turn.iterations.length - 1;
      const answered = it.toolUses.filter((t) => t.result !== null);
      const included = keepPending ? it.toolUses : answered;
      const toolUses: ChatToolUse[] = included.map((t) => ({
        id: t.id,
        name: t.name,
        input: t.input,
      }));
      if (it.text.length === 0 && toolUses.length === 0) return;
      out.push({
        role: "assistant",
        content: it.text,
        ...(toolUses.length > 0 ? { toolUses } : {}),
      });
      for (const t of answered) {
        out.push({
          role: "tool_result",
          toolUseId: t.id,
          content: t.result!.content,
          isError: t.result!.isError,
        });
      }
    });
  }
  return out;
}

// ---------- 수동 승인 ---------- //

// 승인 대기 중이고 아직 결정하지 않은 호출들
export function pendingApprovals(turn: AssistantTurn): ChatToolUseWithResult[] {
  const last = turn.iterations[turn.iterations.length - 1];
  return (last?.toolUses ?? []).filter((tool) => tool.result === null && tool.approval?.state === "pending");
}

// 대기 중인 호출 하나의 결정을 기록한다. 결정 시각은 멈춘 시각에 브라우저에서 흐른 시간을 더한 값이다 (승인 대기 시간).
export function decideToolUse(
  turn: AssistantTurn,
  toolUseId: string,
  decision: "approve" | "deny",
  now: number,
  always = false,
): AssistantTurn {
  const awaiting = turn.awaiting;
  if (!awaiting) return turn;
  const decidedT = awaiting.pausedAtT + Math.max(0, now - awaiting.clientAt);
  const lastIndex = turn.iterations.length - 1;
  return {
    ...turn,
    iterations: turn.iterations.map((it, i) =>
      i !== lastIndex
        ? it
        : {
            ...it,
            toolUses: it.toolUses.map((tool) =>
              tool.id === toolUseId && tool.approval?.state === "pending"
                ? {
                    ...tool,
                    approval: {
                      ...tool.approval,
                      state: decision === "approve" ? ("approved" as const) : ("denied" as const),
                      decidedT,
                      ...(always && decision === "approve" ? { always: true } : {}),
                    },
                  }
                : tool,
            ),
          },
    ),
  };
}

// 승인 대기 중인 턴에서 이어서 요청할 결정들 (모든 호출의 결정이 났을 때만 만들 수 있다).
// 자동 허용된 호출과 이 카드에서 승인한 호출은 approve, 거부한 호출은 deny.
export function collectDecisions(turn: AssistantTurn): { toolUseId: string; decision: "approve" | "deny" }[] | null {
  const last = turn.iterations[turn.iterations.length - 1];
  const calls = (last?.toolUses ?? []).filter((tool) => tool.result === null);
  if (calls.length === 0 || calls.some((tool) => !tool.approval || tool.approval.state === "pending")) return null;
  return calls.map((tool) => ({ toolUseId: tool.id, decision: tool.approval!.state === "denied" ? "deny" : "approve" }));
}

// 이어서 실행할 때의 이벤트 시계 기준: 마지막 결정 시각 (이후 도구 실행과 LLM 호출은 이 시각부터 이어진다).
export function resumeOffset(turn: AssistantTurn): number {
  const last = turn.iterations[turn.iterations.length - 1];
  let offset = turn.awaiting?.pausedAtT ?? turn.endT ?? 0;
  for (const tool of last?.toolUses ?? []) offset = Math.max(offset, tool.approval?.decidedT ?? 0);
  return offset;
}

// 승인 대기 중인 턴을 다시 스트리밍 상태로 되돌려 이어서 받은 이벤트를 같은 턴에 쌓는다.
// now 는 이어서 요청을 보내는 순간의 performance.now() 이고, 이 시각이 offset(절대 시각)에 해당한다.
export function resumeStreamingState(turn: AssistantTurn, now: number): StreamingState {
  const offset = resumeOffset(turn);
  const last = turn.iterations[turn.iterations.length - 1];
  const committed = turn.iterations.slice(0, -1);
  return {
    turnId: turn.id,
    currentText: last?.text ?? "",
    currentIterationToolUses: last?.toolUses ?? [],
    committedIterations: committed,
    iterationIndex: committed.length,
    currentStartT: last?.startT,
    currentLlmEndT: last?.llmEndT,
    currentUsage: last?.usage ?? undefined,
    clientT0: now - offset,
    ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
    lastT: offset,
    tOffset: offset,
  };
}

// Stop 으로 승인 대기를 끝낸다. 아직 결과가 없는 호출은 실행되지 않은 채 "취소됨"으로 남고, 다음 요청의 기록에서는 빠진다.
export function abortAwaiting(turn: AssistantTurn, now: number): AssistantTurn {
  const { awaiting, ...rest } = turn;
  const endT = awaiting ? awaiting.pausedAtT + Math.max(0, now - awaiting.clientAt) : (turn.endT ?? 0);
  return { ...rest, stopReason: "aborted", endT };
}

// ---------- Display helpers ---------- //

// 한 assistant turn 의 모든 iteration 의 text 를 1 본문으로 합친다.
// PRD §3.6.4: assistant 메시지 카드 1개 + 그 아래 펼침 패널 1개.
export function joinIterationTexts(turn: AssistantTurn): string {
  return turn.iterations
    .map((it) => it.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
}

// streaming 상태도 동일 헬퍼를 위해 임시 turn view 로 합쳐 노출. endT 가 없으면 진행 중으로 본다.
export function streamingAsTurnView(state: StreamingState): AssistantTurn {
  const tail: AssistantIteration = {
    text: state.currentText,
    toolUses: state.currentIterationToolUses,
    startT: state.currentStartT,
    llmEndT: state.currentLlmEndT,
    usage: currentIterationUsage(state, state.currentLlmEndT !== undefined),
  };
  return {
    id: state.turnId,
    role: "assistant",
    iterations: [...state.committedIterations, tail],
    stopReason: "end_turn", // placeholder — 표시용; 실제 stopReason 은 done 이후에만 의미 있음.
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
  };
}
