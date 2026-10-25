import { describe, expect, it } from "vitest";

import type { WireEvent } from "./events";
import { abortStreaming, applyLLMEvent, initStreamingState, streamingAsTurnView, type AssistantTurn, type StreamingState } from "./serialize";
import { buildTurnTrace, llmSpanId, toolSpanId } from "./trace";

// 이벤트를 reducer 로 흘려 보내 turn 을 만든다 (화면이 하는 일과 같다).
function play(events: WireEvent[], nowAfter = 0): { state: StreamingState; turn: AssistantTurn | null } {
  let state = initStreamingState("turn-1");
  let turn: AssistantTurn | null = null;
  for (const ev of events) {
    const r = applyLLMEvent(state, ev, nowAfter);
    if (r.kind === "streaming") state = r.next;
    else turn = r.turn;
  }
  return { state, turn };
}

const RUN: WireEvent[] = [
  { type: "run_start", t: 0, startedAt: 1_700_000_000_000 },
  { type: "iteration", index: 0, t: 1 },
  { type: "text_delta", text: "Let me check.", t: 300 },
  { type: "tool_use", id: "tu-1", name: "run_sql_query", input: { sql: "SELECT 1" }, server: "nl2sql-mcp-http", tool: "run_sql_query", t: 820.5 },
  { type: "tool_result", toolUseId: "tu-1", content: '{"rows":[]}', isError: false, server: "nl2sql-mcp-http", tool: "run_sql_query", t: 1020.5 },
  { type: "iteration", index: 1, t: 1021 },
  { type: "text_delta", text: "Done.", t: 1500 },
  { type: "done", stopReason: "end_turn", t: 1620 },
];

describe("buildTurnTrace", () => {
  it("turns a finished run into LLM and tool spans from real event times", () => {
    const { turn } = play(RUN);
    const trace = buildTurnTrace(turn!, { model: "claude-sonnet-4-6" });

    expect(trace.spans).toEqual([
      { id: llmSpanId("turn-1", 0), kind: "llm", label: "LLM", sub: "#1", start: 1, dur: 819.5, status: "ok" },
      { id: llmSpanId("turn-1", 1), kind: "llm", label: "LLM", sub: "#2", start: 1021, dur: 599, status: "ok" },
      { id: toolSpanId("turn-1", "tu-1"), kind: "tool", label: "run_sql_query", sub: "nl2sql-mcp-http", start: 820.5, dur: 200, status: "ok" },
    ]);
    // 제공자가 사용량을 알려 주지 않은 두 반복은 "보고되지 않음"으로 센다 (usage 합계는 null).
    expect(trace.summary).toEqual({
      iterations: 2,
      toolCalls: 1,
      elapsedMs: 1620,
      running: false,
      awaiting: false,
      waitMs: 0,
      usage: { usage: null, reported: 0, total: 2 },
    });

    const toolDetail = trace.details.get(toolSpanId("turn-1", "tu-1"));
    expect(toolDetail).toMatchObject({ kind: "tool", server: "nl2sql-mcp-http", tool: "run_sql_query" });
    expect(trace.details.get(llmSpanId("turn-1", 0))).toMatchObject({ kind: "llm", iteration: 1, outcome: "tool_use", toolCalls: 1 });
    expect(trace.details.get(llmSpanId("turn-1", 1))).toMatchObject({ outcome: "end_turn" });
  });

  it("marks isError tool results as error spans", () => {
    const events = RUN.map((e) => (e.type === "tool_result" ? { ...e, isError: true } : e));
    const { turn } = play(events);
    const tool = buildTurnTrace(turn!).spans.find((s) => s.kind === "tool");
    expect(tool?.status).toBe("error");
  });

  it("grows running spans up to now while the turn is in flight", () => {
    const { state } = play(RUN.slice(0, 4)); // tool_use 까지 받음
    const view = streamingAsTurnView(state);
    const trace = buildTurnTrace(view, { now: 1300, model: "m" });
    const llm = trace.spans.find((s) => s.kind === "llm")!;
    const tool = trace.spans.find((s) => s.kind === "tool")!;
    // LLM 은 첫 tool_use 에서 끝났고, 도구는 아직 결과가 없어 지금까지 자란다.
    expect(llm).toMatchObject({ status: "ok", dur: 819.5 });
    expect(tool).toMatchObject({ status: "running", start: 820.5, dur: 479.5 });
    expect(trace.summary).toMatchObject({ running: true, elapsedMs: 1300, toolCalls: 1 });
  });

  it("keeps an LLM span running while the first response is still streaming", () => {
    const { state } = play(RUN.slice(0, 3));
    const trace = buildTurnTrace(streamingAsTurnView(state), { now: 500, model: "m" });
    expect(trace.spans).toEqual([expect.objectContaining({ kind: "llm", status: "running", start: 1, dur: 499 })]);
  });

  it("cancels the open spans of a run the user stopped", () => {
    const { state } = play(RUN.slice(0, 4), 0);
    // 브라우저 기준 1400ms 에 Stop (clientT0 는 첫 이벤트를 받은 시각 0 이라 now 가 곧 경과 시간)
    const turn = abortStreaming(state, 1400);
    expect(turn.stopReason).toBe("aborted");
    const trace = buildTurnTrace(turn, { model: "m" });
    const tool = trace.spans.find((s) => s.kind === "tool")!;
    expect(tool).toMatchObject({ status: "cancelled", dur: 579.5 });
    expect(trace.summary).toMatchObject({ running: false, elapsedMs: 1400 });
  });

  it("marks the LLM span as failed when the run ends with an error", () => {
    const { turn } = play([
      { type: "iteration", index: 0, t: 2 },
      { type: "done", stopReason: "error", error: "rate limited", t: 90 },
    ]);
    const trace = buildTurnTrace(turn!, { model: "m" });
    expect(trace.spans).toEqual([expect.objectContaining({ kind: "llm", status: "error", dur: 88 })]);
    expect(trace.details.get(llmSpanId("turn-1", 0))).toMatchObject({ outcome: "error" });
  });

  it("builds nothing for a legacy stream without server times except what the browser measured", () => {
    // 시각이 없는 예전 이벤트: 브라우저가 받은 시각(now)으로 대신한다.
    let state = initStreamingState("t");
    const feed = (ev: WireEvent, now: number) => {
      const r = applyLLMEvent(state, ev, now);
      if (r.kind === "streaming") state = r.next;
      return r;
    };
    feed({ type: "iteration", index: 0 }, 1000);
    feed({ type: "tool_use", id: "a", name: "echo", input: {} }, 1100);
    feed({ type: "tool_result", toolUseId: "a", content: "x", isError: false }, 1150);
    const trace = buildTurnTrace(streamingAsTurnView(state), { now: 200, model: "m" });
    expect(trace.spans.find((s) => s.kind === "tool")).toMatchObject({ start: 100, dur: 50, status: "ok" });
  });

  it("returns no spans when a turn has no timing at all", () => {
    const turn: AssistantTurn = { id: "x", role: "assistant", iterations: [{ text: "hi", toolUses: [] }], stopReason: "end_turn" };
    const trace = buildTurnTrace(turn);
    expect(trace.spans).toEqual([]);
    expect(trace.summary.iterations).toBe(1);
  });
});
