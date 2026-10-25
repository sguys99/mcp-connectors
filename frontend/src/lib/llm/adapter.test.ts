import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ITERATIONS,
  toMessage,
  type ChatMessage,
  type LLMEvent,
} from "./adapter";

describe("adapter — types and helpers", () => {
  it("DEFAULT_MAX_ITERATIONS is 5 per PRD §3.6.2", () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(5);
  });

  it("toMessage extracts string from Error and falls back to String() otherwise", () => {
    expect(toMessage(new Error("boom"))).toBe("boom");
    expect(toMessage("plain")).toBe("plain");
    expect(toMessage(42)).toBe("42");
  });

  it("LLMEvent discriminated union supports exhaustive switch", () => {
    // Compile-time exhaustiveness check via a function that must handle every variant.
    function describeEvent(ev: LLMEvent): string {
      switch (ev.type) {
        case "iteration":
          return `iter:${ev.index}`;
        case "text_delta":
          return `text:${ev.text}`;
        case "tool_use":
          return `tu:${ev.name}`;
        case "tool_result":
          return `tr:${ev.toolUseId}`;
        case "usage":
          return `usage:${ev.usage.input}/${ev.usage.output}`;
        case "approval_required":
          return `approval:${ev.calls.length}`;
        case "done":
          return `done:${ev.stopReason}`;
        default: {
          const _: never = ev;
          return _;
        }
      }
    }
    expect(describeEvent({ type: "iteration", index: 0 })).toBe("iter:0");
    expect(describeEvent({ type: "text_delta", text: "hi" })).toBe("text:hi");
    expect(
      describeEvent({ type: "tool_use", id: "t1", name: "echo", input: {} }),
    ).toBe("tu:echo");
    expect(
      describeEvent({
        type: "tool_result",
        toolUseId: "t1",
        content: "x",
        isError: false,
      }),
    ).toBe("tr:t1");
    expect(describeEvent({ type: "done", stopReason: "end_turn" })).toBe(
      "done:end_turn",
    );
  });

  it("ChatMessage round-trips through JSON without loss", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "ping" },
      {
        role: "assistant",
        content: "pong",
        toolUses: [{ id: "t1", name: "echo", input: { text: "hi" } }],
      },
      {
        role: "tool_result",
        toolUseId: "t1",
        content: '{"result":"hi"}',
        isError: false,
      },
    ];
    expect(JSON.parse(JSON.stringify(messages))).toEqual(messages);
  });
});
