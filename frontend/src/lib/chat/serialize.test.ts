import { describe, expect, it } from "vitest";

import type { LLMEvent } from "@/lib/llm/adapter";

import {
  applyLLMEvent,
  initStreamingState,
  serializeToChatMessages,
  streamingAsTurnView,
  type AssistantTurn,
  type ChatTurn,
  type ReducerResult,
} from "./serialize";

// Helper: run a sequence of LLMEvents through the reducer.
// Returns the final ReducerResult (and the done turn if produced).
function run(events: Exclude<LLMEvent, { type: "approval_required" }>[]): {
  state: ReturnType<typeof initStreamingState>;
  result: ReducerResult | null;
} {
  let state = initStreamingState();
  let result: ReducerResult | null = null;
  for (const ev of events) {
    result = applyLLMEvent(state, ev);
    if (result.kind === "streaming") state = result.next;
    else break;
  }
  return { state, result };
}

describe("serializeToChatMessages", () => {
  it("serializes a single user turn", () => {
    const turns: ChatTurn[] = [{ id: "u1", role: "user", content: "hello" }];
    expect(serializeToChatMessages(turns)).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("serializes a user + assistant single-iteration turn (text-only)", () => {
    const turn: AssistantTurn = {
      id: "a1",
      role: "assistant",
      iterations: [{ text: "hi there", toolUses: [] }],
      stopReason: "end_turn",
    };
    expect(serializeToChatMessages([{ id: "u1", role: "user", content: "hi" }, turn])).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("emits one assistant + one tool_result per tool use, preserving order", () => {
    const turn: AssistantTurn = {
      id: "a1",
      role: "assistant",
      iterations: [
        {
          text: "calling echo",
          toolUses: [
            {
              id: "t1",
              name: "echo",
              input: { text: "ping" },
              result: { content: '{"result":"ping"}', isError: false },
            },
          ],
        },
        {
          text: "result: ping",
          toolUses: [],
        },
      ],
      stopReason: "end_turn",
    };
    expect(serializeToChatMessages([{ id: "u1", role: "user", content: "go" }, turn])).toEqual([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "calling echo",
        toolUses: [{ id: "t1", name: "echo", input: { text: "ping" } }],
      },
      {
        role: "tool_result",
        toolUseId: "t1",
        content: '{"result":"ping"}',
        isError: false,
      },
      { role: "assistant", content: "result: ping" },
    ]);
  });

  it("omits unanswered tool calls (result === null) so the next request stays valid", () => {
    // Simulates a turn that was aborted mid-tool-call.
    const turn: AssistantTurn = {
      id: "a1",
      role: "assistant",
      iterations: [
        {
          text: "running",
          toolUses: [
            { id: "t1", name: "echo", input: { text: "x" }, result: null },
          ],
        },
      ],
      stopReason: "error",
      error: "aborted",
    };
    const msgs = serializeToChatMessages([turn]);
    expect(msgs.filter((m) => m.role === "tool_result")).toEqual([]);
    // tool_use 만 있고 tool_result 가 없으면 LLM API 가 거부하므로 tool_use 도 뺀다.
    expect(msgs.find((m) => m.role === "assistant")).toEqual({ role: "assistant", content: "running" });
  });

  it("drops an assistant message that has neither text nor answered tool calls", () => {
    const turn: AssistantTurn = {
      id: "a2",
      role: "assistant",
      iterations: [{ text: "", toolUses: [{ id: "t1", name: "echo", input: {}, result: null }] }],
      stopReason: "aborted",
    };
    expect(serializeToChatMessages([{ id: "u", role: "user", content: "hi" }, turn])).toEqual([{ role: "user", content: "hi" }]);
  });

  it("keeps the answered calls of a stopped turn and drops the pending one", () => {
    const turn: AssistantTurn = {
      id: "a3",
      role: "assistant",
      iterations: [
        {
          text: "",
          toolUses: [
            { id: "t1", name: "echo", input: {}, result: { content: "ok", isError: false } },
            { id: "t2", name: "add", input: {}, result: null },
          ],
        },
      ],
      stopReason: "aborted",
    };
    expect(serializeToChatMessages([turn])).toEqual([
      { role: "assistant", content: "", toolUses: [{ id: "t1", name: "echo", input: {} }] },
      { role: "tool_result", toolUseId: "t1", content: "ok", isError: false },
    ]);
  });
});

describe("applyLLMEvent reducer", () => {
  it("accumulates text deltas across one iteration and commits on done(end_turn)", () => {
    const { result } = run([
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "done", stopReason: "end_turn" },
    ]);
    expect(result?.kind).toBe("done");
    expect(result!.kind === "done" && result!.turn).toMatchObject({
      id: expect.any(String),
      role: "assistant",
      iterations: [{ text: "Hello", toolUses: [] }],
      stopReason: "end_turn",
    });
  });

  it("preserves iteration boundary when tool_use → tool_result → iteration:1 fires", () => {
    const { result } = run([
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "calling" },
      { type: "tool_use", id: "t1", name: "echo", input: { text: "ping" } },
      {
        type: "tool_result",
        toolUseId: "t1",
        content: '"ping"',
        isError: false,
      },
      { type: "iteration", index: 1 },
      { type: "text_delta", text: "got ping" },
      { type: "done", stopReason: "end_turn" },
    ]);
    expect(result?.kind).toBe("done");
    if (result?.kind !== "done") throw new Error("expected done");
    expect(result.turn.iterations).toHaveLength(2);
    expect(result.turn.iterations[0]).toMatchObject({
      text: "calling",
      toolUses: [
        {
          id: "t1",
          name: "echo",
          input: { text: "ping" },
          result: { content: '"ping"', isError: false },
        },
      ],
    });
    expect(result.turn.iterations[1]).toMatchObject({
      text: "got ping",
      toolUses: [],
    });
  });

  it("matches tool_result to current iteration tool_use by toolUseId", () => {
    const { state } = run([
      { type: "iteration", index: 0 },
      { type: "tool_use", id: "t1", name: "echo", input: {} },
      { type: "tool_use", id: "t2", name: "add", input: { a: 1, b: 2 } },
      {
        type: "tool_result",
        toolUseId: "t2",
        content: "3",
        isError: false,
      },
    ]);
    // After the events above, current iteration has both tools; t2 has result, t1 still null.
    const t1 = state.currentIterationToolUses.find((t) => t.id === "t1");
    const t2 = state.currentIterationToolUses.find((t) => t.id === "t2");
    expect(t1?.result).toBeNull();
    expect(t2?.result).toEqual({ content: "3", isError: false });
  });

  it("preserves stopReason and error on done(error)", () => {
    const { result } = run([
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "partial" },
      { type: "done", stopReason: "error", error: "network down" },
    ]);
    expect(result?.kind === "done" && result.turn).toMatchObject({
      id: expect.any(String),
      role: "assistant",
      iterations: [{ text: "partial", toolUses: [] }],
      stopReason: "error",
      error: "network down",
    });
  });

  it("streamingAsTurnView exposes in-flight state as an assistant-shaped turn", () => {
    let state = initStreamingState();
    for (const ev of [
      { type: "iteration", index: 0 } as const,
      { type: "text_delta", text: "hi" } as const,
      { type: "tool_use", id: "t1", name: "echo", input: {} } as const,
    ]) {
      const r = applyLLMEvent(state, ev);
      if (r.kind === "streaming") state = r.next;
    }
    const view = streamingAsTurnView(state);
    expect(view.role).toBe("assistant");
    expect(view.iterations).toHaveLength(1);
    expect(view.iterations[0].text).toBe("hi");
    expect(view.iterations[0].toolUses).toHaveLength(1);
    expect(view.iterations[0].toolUses[0].result).toBeNull();
  });
});

describe("turn ids", () => {
  it("carries the streaming turnId into the committed assistant turn", () => {
    let state = initStreamingState("fixed-id");
    const r1 = applyLLMEvent(state, { type: "iteration", index: 0 });
    if (r1.kind === "streaming") state = r1.next;
    const r2 = applyLLMEvent(state, { type: "text_delta", text: "a" });
    if (r2.kind === "streaming") state = r2.next;
    const r3 = applyLLMEvent(state, { type: "iteration", index: 1 });
    if (r3.kind === "streaming") state = r3.next;
    const done = applyLLMEvent(state, { type: "done", stopReason: "end_turn" });
    expect(done.kind === "done" && done.turn.id).toBe("fixed-id");
  });

  it("issues distinct ids per streaming state", () => {
    expect(initStreamingState().turnId).not.toBe(initStreamingState().turnId);
  });
});
