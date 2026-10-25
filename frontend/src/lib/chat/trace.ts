// Chat 한 턴(assistant turn)을 워터폴 스팬으로 바꾸는 변환 계층 (순수 함수).
//
// 입력은 SSE 이벤트를 모아 만든 AssistantTurn 이다. 이벤트마다 서버가 잰 시각(t, ms, 실행 시작이 0)이 붙어 있고,
// 여기서는 그 실측 시각만 쓴다 (추정이나 가짜 값은 만들지 않는다).
//
//   LLM 스팬   반복(iteration)마다 하나. 시작은 iteration 이벤트, 끝은 같은 반복의 첫 tool_use 또는 done.
//              LLM 요청 시작부터 응답 전체(스트리밍 포함)를 다 받을 때까지의 시간이다. 토큰 수는 제공자가 알려 준 실측값만 detail 에 담는다.
//   도구 스팬  tool_use 이벤트가 시작, tool_result 이벤트가 끝. 서버와 도구 이름, 입력과 결과는 detail 로 따로 돌려준다.
//   승인 스팬  수동 승인 모드에서 도구 호출마다 하나. 대기 시작(approval_required)부터 사용자가 결정한 시각까지이고,
//              도구 스팬은 승인 뒤 실제 실행부터 시작하므로 대기 시간이 도구 시간에 들어가지 않는다. 거부한 호출은 도구 스팬이 없다.
//
// 상태: 결과가 오면 ok 또는 error(isError), 아직 안 왔고 턴이 진행 중이면 running, 턴이 끝났는데 결과가 없으면
// (Stop 이나 LLM 오류로 멈춤) cancelled. 진행 중인 스팬의 길이는 opts.now(실행 시작 이후 경과 ms)까지로 잡는다.

import type { SpanStatus, TraceSpan } from "@/lib/trace/spans";

import { sumUsage, type TokenUsage, type UsageTotal } from "@/lib/llm/usage";

import type { AssistantTurn, ChatToolUseWithResult } from "./serialize";

export function llmSpanId(turnId: string, index: number): string {
  return `${turnId}:llm:${index}`;
}

export function toolSpanId(turnId: string, toolUseId: string): string {
  return `${turnId}:tool:${toolUseId}`;
}

export function waitSpanId(turnId: string, toolUseId: string): string {
  return `${turnId}:wait:${toolUseId}`;
}

export type SpanDetail =
  | {
      kind: "llm";
      model: string;
      // 몇 번째 반복인지 (1부터)
      iteration: number;
      // 이 반복이 도구 호출로 이어졌는지(tool_use), 답변으로 끝났는지(end_turn), 오류로 끝났는지(error)
      outcome: "tool_use" | "end_turn" | "error" | "cancelled" | "running";
      // 첫 글자가 나올 때까지의 시간은 서버가 재지 않아 없다. 대신 이 반복이 부른 도구 수를 보여 준다.
      toolCalls: number;
      // 제공자가 알려 준 토큰 사용량. null 은 알려 주지 않음, undefined 는 아직 진행 중
      usage: TokenUsage | null | undefined;
    }
  | {
      kind: "wait";
      server: string | null;
      tool: string;
      // 사용자의 결정. pending 은 아직 기다리는 중
      decision: "pending" | "approved" | "denied";
      auto: boolean;
      always: boolean;
    }
  | {
      kind: "tool";
      server: string | null;
      tool: string;
      toolUse: ChatToolUseWithResult;
    };

export interface TurnSummary {
  iterations: number;
  toolCalls: number;
  // 실행 시작부터 끝(또는 지금)까지, ms
  elapsedMs: number;
  running: boolean;
  // 사용자 승인을 기다리는 중 (스트림은 끝났고 결정을 기다린다)
  awaiting: boolean;
  // 승인 대기에 쓴 시간 합계 (ms). 도구 시간과 따로 센다.
  waitMs: number;
  // 제공자가 알려 준 토큰 사용량의 합 (이 턴의 모든 LLM 호출)
  usage: UsageTotal;
}

export interface TurnTrace {
  spans: TraceSpan[];
  // 스팬 id -> 상세 (상세 패널과 카드 연결에 쓴다)
  details: Map<string, SpanDetail>;
  summary: TurnSummary;
}

export interface BuildTraceOptions {
  // 진행 중인 턴일 때 실행 시작 이후의 경과 시간(ms). 턴이 끝났으면 쓰지 않는다.
  now?: number;
  // LLM 스팬 이름으로 쓸 모델 이름. 없으면 turn.model, 그것도 없으면 "LLM".
  model?: string;
  // 승인 스팬의 행 이름 (화면 언어에 맞춘 문구). 기본 "approval".
  approvalLabel?: string;
}

const nonNegative = (n: number) => (n > 0 ? n : 0);

export function buildTurnTrace(turn: AssistantTurn, options: BuildTraceOptions = {}): TurnTrace {
  const awaiting = turn.stopReason === "awaiting_approval";
  const running = turn.endT === undefined;
  const lastKnown = lastEventTime(turn);
  // 열려 있는 스팬이 이 시각까지 이어진다. 승인을 기다리는 턴은 스트림이 끝났지만 대기 스팬이 계속 자란다.
  const horizon = awaiting ? Math.max(turn.endT ?? 0, options.now ?? 0, lastKnown) : (turn.endT ?? Math.max(options.now ?? 0, lastKnown));
  const model = options.model ?? turn.model ?? "LLM";

  const spans: TraceSpan[] = [];
  const details = new Map<string, SpanDetail>();
  const lastIndex = turn.iterations.length - 1;
  let iterations = 0;
  let toolCalls = 0;

  turn.iterations.forEach((it, i) => {
    toolCalls += it.toolUses.length;
    if (it.startT === undefined) return;
    iterations += 1;

    const closed = it.llmEndT !== undefined;
    const failed = turn.stopReason === "error" && i === lastIndex && it.toolUses.length === 0;
    const aborted = turn.stopReason === "aborted" && i === lastIndex && !closed;
    let status: SpanStatus;
    let outcome: Extract<SpanDetail, { kind: "llm" }>["outcome"];
    if (failed) {
      status = "error";
      outcome = "error";
    } else if (!closed && running) {
      status = "running";
      outcome = "running";
    } else if (!closed && aborted) {
      status = "cancelled";
      outcome = "cancelled";
    } else {
      status = "ok";
      outcome = it.toolUses.length > 0 ? "tool_use" : "end_turn";
    }
    const end = closed ? it.llmEndT! : horizon;
    const id = llmSpanId(turn.id, i);
    spans.push({
      id,
      kind: "llm",
      // 이름 열이 좁아서 모델 이름은 상세 패널에 두고 행에는 "LLM #n" 만 쓴다.
      label: "LLM",
      sub: `#${i + 1}`,
      start: it.startT,
      dur: nonNegative(end - it.startT),
      status,
    });
    details.set(id, { kind: "llm", model, iteration: i + 1, outcome, toolCalls: it.toolUses.length, usage: it.usage });
  });
  const approvalLabel = options.approvalLabel ?? "approval";
  let waitMs = 0;

  for (const it of turn.iterations) {
    for (const tool of it.toolUses) {
      // 승인 대기 스팬: 직접 결정을 기다린 호출만 (자동 허용은 기다리지 않았다).
      const approval = tool.approval;
      if (approval && !approval.auto) {
        const pending = approval.state === "pending";
        // 승인 대기 중에 Stop 으로 멈췄다면 결정이 없는 채로 끝난 것이다.
        const dropped = pending && !awaiting && !running;
        const end = pending ? horizon : (approval.decidedT ?? approval.waitStartT);
        const id = waitSpanId(turn.id, tool.id);
        const name = tool.tool ?? tool.name;
        const dur = nonNegative(end - approval.waitStartT);
        waitMs += dur;
        spans.push({
          id,
          kind: "wait",
          label: approvalLabel,
          sub: name,
          start: approval.waitStartT,
          dur,
          status: pending ? (dropped ? "cancelled" : "waiting") : "ok",
        });
        details.set(id, {
          kind: "wait",
          server: tool.server ?? null,
          tool: name,
          decision: approval.state,
          auto: false,
          always: approval.always === true,
        });
      }
      if (tool.startT === undefined) continue;
      const done = tool.result !== null;
      const end = done ? (tool.endT ?? tool.startT) : horizon;
      let status: SpanStatus;
      if (done) status = tool.result!.isError ? "error" : "ok";
      else status = running ? "running" : "cancelled";
      const id = toolSpanId(turn.id, tool.id);
      const name = tool.tool ?? tool.name;
      spans.push({
        id,
        kind: "tool",
        label: name,
        ...(tool.server ? { sub: tool.server } : {}),
        start: tool.startT,
        dur: nonNegative(end - tool.startT),
        status,
      });
      details.set(id, { kind: "tool", server: tool.server ?? null, tool: name, toolUse: tool });
    }
  }

  return {
    spans,
    details,
    summary: {
      iterations: iterations || turn.iterations.filter((it) => it.text.length > 0 || it.toolUses.length > 0).length,
      toolCalls,
      elapsedMs: awaiting ? horizon : (turn.endT ?? horizon),
      running,
      awaiting,
      waitMs,
      usage: sumUsage(turn.iterations.map((it) => it.usage)),
    },
  };
}

// 이 턴에서 이미 확정된 가장 늦은 서버 측 시각
function lastEventTime(turn: AssistantTurn): number {
  let last = 0;
  for (const it of turn.iterations) {
    last = Math.max(last, it.startT ?? 0, it.llmEndT ?? 0);
    for (const tool of it.toolUses) last = Math.max(last, tool.startT ?? 0, tool.endT ?? 0, tool.approval?.decidedT ?? 0);
  }
  return last;
}
