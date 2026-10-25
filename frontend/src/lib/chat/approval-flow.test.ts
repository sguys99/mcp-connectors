// 수동 승인 흐름의 클라이언트 상태 (reducer, 결정 기록, 이어서 실행, 직렬화, 토큰 집계, 승인 대기 스팬).
// useChatStream 이 하는 일을 순수 함수로 그대로 따라 한다: 이벤트 -> 멈춘 턴 -> 결정 -> 같은 턴을 이어서 -> 완료.

import { describe, expect, it } from "vitest";

import type { WireEvent } from "./events";
import {
  abortAwaiting,
  applyLLMEvent,
  collectDecisions,
  decideToolUse,
  initStreamingState,
  pendingApprovals,
  resumeOffset,
  resumeStreamingState,
  serializeToChatMessages,
  type AssistantTurn,
  type ChatTurn,
  type StreamingState,
} from "./serialize";
import { buildTurnTrace, llmSpanId, toolSpanId, waitSpanId } from "./trace";
import { conversationUsage, latestUsage, sessionTotal } from "./usage";

const SQL = { sql: "SELECT 1" };

// 첫 요청: 반복 0 에서 호출 두 개를 부르려다 멈춘다. 둘째는 "항상 허용" 목록에 있어 allowed.
const FIRST: WireEvent[] = [
  { type: "run_start", t: 0, startedAt: 1_700_000_000_000 },
  { type: "iteration", index: 0, t: 1 },
  { type: "text_delta", text: "Let me check.", t: 200 },
  { type: "usage", usage: { input: 1000, output: 50 }, t: 400 },
  {
    type: "approval_required",
    t: 410,
    token: "tok",
    iterationsUsed: 1,
    calls: [
      { id: "a", name: "run_sql_query", input: SQL, server: "nl2sql", tool: "run_sql_query", allowed: false },
      { id: "b", name: "list_tables", input: {}, server: "nl2sql", tool: "list_tables", allowed: true },
    ],
  },
  { type: "done", stopReason: "awaiting_approval", t: 411 },
];

function play(events: WireEvent[], start: StreamingState, now = 5000): { state: StreamingState; turn: AssistantTurn | null } {
  let state = start;
  let turn: AssistantTurn | null = null;
  for (const ev of events) {
    const r = applyLLMEvent(state, ev, now);
    if (r.kind === "streaming") state = r.next;
    else turn = r.turn;
  }
  return { state, turn };
}

function pausedTurn(): AssistantTurn {
  const { turn } = play(FIRST, initStreamingState("turn-1"), 1000);
  expect(turn).not.toBeNull();
  return turn!;
}

describe("approval_required -> paused turn", () => {
  it("builds pending and auto-approved tool uses and records where to resume", () => {
    const turn = pausedTurn();
    expect(turn.stopReason).toBe("awaiting_approval");
    expect(turn.awaiting).toEqual({ token: "tok", pausedAtT: 410, clientAt: 1000 });
    const [a, b] = turn.iterations[0]!.toolUses;
    expect(a).toMatchObject({ id: "a", result: null, approval: { state: "pending", waitStartT: 410, waitStartClient: 1000 } });
    expect(a!.startT).toBeUndefined();
    expect(b).toMatchObject({ id: "b", approval: { state: "approved", auto: true, decidedT: 410 } });
    // 사용량은 응답이 끝난 반복에 붙는다
    expect(turn.iterations[0]!.usage).toEqual({ input: 1000, output: 50 });
    expect(pendingApprovals(turn).map((t) => t.id)).toEqual(["a"]);
  });

  it("a done(awaiting_approval) without approval_required becomes an error turn (nothing to resume)", () => {
    const { turn } = play(
      [
        { type: "iteration", index: 0, t: 1 },
        { type: "done", stopReason: "awaiting_approval", t: 2 },
      ],
      initStreamingState("t"),
    );
    expect(turn?.stopReason).toBe("error");
  });
});

describe("deciding and collecting decisions", () => {
  it("records the decision time as paused time plus the wait measured in the browser", () => {
    const decided = decideToolUse(pausedTurn(), "a", "approve", 4000);
    expect(decided.iterations[0]!.toolUses[0]!.approval).toMatchObject({ state: "approved", decidedT: 410 + 3000 });
  });

  it("returns decisions only when every call is decided; allowed calls count as approve", () => {
    const turn = pausedTurn();
    expect(collectDecisions(turn)).toBeNull();
    expect(collectDecisions(decideToolUse(turn, "a", "approve", 2000))).toEqual([
      { toolUseId: "a", decision: "approve" },
      { toolUseId: "b", decision: "approve" },
    ]);
    expect(collectDecisions(decideToolUse(turn, "a", "deny", 2000))).toEqual([
      { toolUseId: "a", decision: "deny" },
      { toolUseId: "b", decision: "approve" },
    ]);
  });

  it("records 'always' only on approvals and ignores a second decision for the same call", () => {
    const first = decideToolUse(pausedTurn(), "a", "approve", 2000, true);
    expect(first.iterations[0]!.toolUses[0]!.approval?.always).toBe(true);
    const again = decideToolUse(first, "a", "deny", 3000);
    expect(again.iterations[0]!.toolUses[0]!.approval?.state).toBe("approved");
    const denied = decideToolUse(pausedTurn(), "a", "deny", 2000, true);
    expect(denied.iterations[0]!.toolUses[0]!.approval?.always).toBeUndefined();
  });
});

describe("serializing the paused conversation", () => {
  const user: ChatTurn = { id: "u", role: "user", content: "q" };

  it("drops unanswered calls for a normal request, but keeps them for the resume request of that turn", () => {
    const turn = pausedTurn();
    expect(serializeToChatMessages([user, turn])).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "Let me check." },
    ]);
    const kept = serializeToChatMessages([user, turn], "turn-1");
    expect(kept[1]).toMatchObject({
      role: "assistant",
      toolUses: [
        { id: "a", name: "run_sql_query", input: SQL },
        { id: "b", name: "list_tables", input: {} },
      ],
    });
    // 결과는 싣지 않는다 (서버가 실행해서 만든다)
    expect(kept).toHaveLength(2);
  });
});

describe("resuming the same turn", () => {
  function resumed() {
    const decided = decideToolUse(pausedTurn(), "a", "approve", 6000, true);
    const offset = resumeOffset(decided);
    const start = resumeStreamingState(decided, 20_000);
    // 이어서 받은 요청의 서버 시각은 0부터 다시 시작한다
    const events: WireEvent[] = [
      { type: "run_start", t: 0, startedAt: 1_800_000_000_000 },
      { type: "tool_use", id: "a", name: "run_sql_query", input: SQL, server: "nl2sql", tool: "run_sql_query", resumed: true, t: 2 },
      { type: "tool_result", toolUseId: "a", content: '{"rows":[1]}', isError: false, t: 40 },
      { type: "tool_use", id: "b", name: "list_tables", input: {}, resumed: true, t: 41 },
      { type: "tool_result", toolUseId: "b", content: "[]", isError: false, t: 50 },
      { type: "iteration", index: 1, t: 51 },
      { type: "text_delta", text: "Done.", t: 300 },
      { type: "usage", usage: { input: 2000, output: 100, cacheRead: 1500 }, t: 310 },
      { type: "done", stopReason: "end_turn", t: 311 },
    ];
    return { offset, ...play(events, start, 21_000), start };
  }

  it("offsets the new request's times by the paused time plus the approval wait", () => {
    const { offset, start } = resumed();
    expect(offset).toBe(410 + 5000);
    expect(start.tOffset).toBe(offset);
    expect(start.startedAt).toBe(1_700_000_000_000);
  });

  it("fills the existing cards instead of adding new ones, keeps the original start time and numbers iterations on", () => {
    const { turn } = resumed();
    expect(turn?.stopReason).toBe("end_turn");
    expect(turn?.startedAt).toBe(1_700_000_000_000);
    expect(turn?.iterations).toHaveLength(2);
    const [a, b] = turn!.iterations[0]!.toolUses;
    expect(turn!.iterations[0]!.toolUses).toHaveLength(2);
    expect(a).toMatchObject({ id: "a", startT: 5410 + 2, endT: 5410 + 40, result: { content: '{"rows":[1]}', isError: false } });
    expect(b).toMatchObject({ id: "b", result: { content: "[]" } });
    expect(turn!.iterations[1]).toMatchObject({ text: "Done.", startT: 5410 + 51 });
    expect(turn!.endT).toBe(5410 + 311);
  });

  it("splits approval wait time from tool time in the trace", () => {
    const { turn } = resumed();
    const trace = buildTurnTrace(turn!, { approvalLabel: "approval" });
    const wait = trace.spans.find((s) => s.id === waitSpanId("turn-1", "a"))!;
    const tool = trace.spans.find((s) => s.id === toolSpanId("turn-1", "a"))!;
    expect(wait).toMatchObject({ kind: "wait", status: "ok", start: 410, dur: 5000, label: "approval", sub: "run_sql_query" });
    // 도구 스팬은 승인 뒤 실제 실행부터 시작하고 대기 시간을 포함하지 않는다
    expect(tool.start).toBe(5412);
    expect(tool.dur).toBeCloseTo(38);
    expect(tool.start).toBeGreaterThanOrEqual(wait.start + wait.dur);
    // 자동 허용된 호출에는 대기 스팬이 없다
    expect(trace.spans.some((s) => s.id === waitSpanId("turn-1", "b"))).toBe(false);
    expect(trace.summary.waitMs).toBe(5000);
    // LLM 스팬 번호가 이어진다
    expect(trace.spans.find((s) => s.id === llmSpanId("turn-1", 1))).toBeDefined();
    const detail = trace.details.get(waitSpanId("turn-1", "a"));
    expect(detail).toMatchObject({ kind: "wait", decision: "approved", always: true });
  });

  it("aggregates provider-reported usage per iteration, turn and conversation", () => {
    const { turn } = resumed();
    expect(turn!.iterations.map((it) => it.usage)).toEqual([
      { input: 1000, output: 50 },
      { input: 2000, output: 100, cacheRead: 1500 },
    ]);
    const trace = buildTurnTrace(turn!);
    expect(trace.summary.usage).toEqual({ usage: { input: 3000, output: 150, cacheRead: 1500 }, reported: 2, total: 2 });
    expect(conversationUsage([{ role: "user" }, turn!, turn!]).usage).toEqual({ input: 6000, output: 300, cacheRead: 3000 });
    expect(latestUsage([turn!])).toEqual({ input: 2000, output: 100, cacheRead: 1500 });
    expect(sessionTotal({ input: 10, output: 1 }, { input: 5, output: 2 })).toEqual({ input: 15, output: 3 });
    expect(sessionTotal(null, null)).toBeNull();
  });

  it("denied calls get no tool span and no tool_use event, and the card keeps its denied state", () => {
    const decided = decideToolUse(pausedTurn(), "a", "deny", 3000);
    const events: WireEvent[] = [
      { type: "run_start", t: 0, startedAt: 1 },
      { type: "tool_result", toolUseId: "a", content: "The user denied this call", isError: true, denied: true, t: 1 },
      { type: "tool_use", id: "b", name: "list_tables", input: {}, resumed: true, t: 2 },
      { type: "tool_result", toolUseId: "b", content: "[]", isError: false, t: 5 },
      { type: "iteration", index: 1, t: 6 },
      { type: "done", stopReason: "end_turn", t: 20 },
    ];
    const { turn } = play(events, resumeStreamingState(decided, 9000));
    const a = turn!.iterations[0]!.toolUses[0]!;
    expect(a.approval?.state).toBe("denied");
    expect(a.result).toEqual({ content: "The user denied this call", isError: true });
    expect(a.startT).toBeUndefined();
    const trace = buildTurnTrace(turn!);
    expect(trace.spans.some((s) => s.id === toolSpanId("turn-1", "a"))).toBe(false);
    expect(trace.spans.some((s) => s.id === waitSpanId("turn-1", "a"))).toBe(true);
    // 다음 요청의 기록에는 거부 결과가 tool_result(isError)로 들어가 모델이 이어서 반응한다
    const messages = serializeToChatMessages([{ id: "u", role: "user", content: "q" }, turn!]);
    expect(messages.filter((m) => m.role === "tool_result")).toEqual([
      { role: "tool_result", toolUseId: "a", content: "The user denied this call", isError: true },
      { role: "tool_result", toolUseId: "b", content: "[]", isError: false },
    ]);
  });
});

describe("waiting and stopping", () => {
  it("shows a growing waiting span while the turn waits, with its elapsed time tied to the clock", () => {
    const turn = pausedTurn();
    const trace = buildTurnTrace(turn, { now: 410 + 7000 });
    const wait = trace.spans.find((s) => s.id === waitSpanId("turn-1", "a"))!;
    expect(wait).toMatchObject({ kind: "wait", status: "waiting", start: 410, dur: 7000 });
    expect(trace.summary).toMatchObject({ awaiting: true, running: false, waitMs: 7000 });
  });

  it("Stop while waiting closes the turn as aborted; the unrun calls are cancelled and dropped from the next request", () => {
    const stopped = abortAwaiting(pausedTurn(), 4000);
    expect(stopped.stopReason).toBe("aborted");
    expect(stopped.awaiting).toBeUndefined();
    expect(stopped.endT).toBe(410 + 3000);
    const trace = buildTurnTrace(stopped);
    expect(trace.spans.find((s) => s.id === waitSpanId("turn-1", "a"))?.status).toBe("cancelled");
    expect(serializeToChatMessages([{ id: "u", role: "user", content: "q" }, stopped]).some((m) => m.role === "tool_result")).toBe(false);
  });

  it("an iteration whose provider sent no usage is 'not reported' (null) once it ends, but unknown (undefined) while running", () => {
    const running = play(
      [
        { type: "iteration", index: 0, t: 1 },
        { type: "text_delta", text: "x", t: 2 },
      ],
      initStreamingState("t"),
    );
    expect(running.state.currentUsage).toBeUndefined();
    const ended = play([{ type: "iteration", index: 0, t: 1 }, { type: "done", stopReason: "end_turn", t: 9 }], initStreamingState("t"));
    expect(ended.turn!.iterations[0]!.usage).toBeNull();
  });
});
