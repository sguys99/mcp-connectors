import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolMeta } from "@/lib/mcp/types";

import type { ChatMessage, LLMEvent } from "./adapter";

// SDK mock — vi.mock hoists to top. The mock must be a real class so that
// `new Anthropic({apiKey})` works (arrow-function mockImplementation can't be newed).
const streamMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class AnthropicMock {
    messages = { stream: streamMock };
  }
  return { default: AnthropicMock };
});

// Import AFTER vi.mock so the mocked SDK is in effect.
const {
  toAnthropicTools,
  toAnthropicMessages,
  createAnthropicAdapter,
} = await import("./anthropic");

// Helper: build a fake MessageStream — async-iterable + finalMessage().
function fakeStream(opts: {
  events?: unknown[];
  finalText?: string;
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason?: "end_turn" | "tool_use";
  throwOnIterate?: unknown;
  usage?: unknown;
}) {
  const events = opts.events ?? [];
  if (events.length === 0 && opts.finalText && opts.finalText.length > 0) {
    events.push({
      type: "content_block_delta",
      delta: { type: "text_delta", text: opts.finalText },
    });
  }
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          if (opts.throwOnIterate) throw opts.throwOnIterate;
          if (i >= events.length) return { done: true, value: undefined };
          return { done: false, value: events[i++] };
        },
      };
    },
    finalMessage: async () => ({
      ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
      stop_reason: opts.stopReason ?? "end_turn",
      content: [
        ...(opts.finalText ? [{ type: "text", text: opts.finalText }] : []),
        ...(opts.toolUses ?? []).map((tu) => ({
          type: "tool_use",
          id: tu.id,
          name: tu.name,
          input: tu.input,
        })),
      ],
    }),
  };
}

async function collect(it: AsyncIterable<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const TOOLS: ToolMeta[] = [
  {
    name: "echo",
    description: "echoes text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
];

beforeEach(() => {
  streamMock.mockReset();
});

describe("toAnthropicTools", () => {
  it("maps ToolMeta to { name, description, input_schema }", () => {
    expect(toAnthropicTools(TOOLS)).toEqual([
      {
        name: "echo",
        description: "echoes text",
        input_schema: TOOLS[0].inputSchema,
      },
    ]);
  });
});

describe("toAnthropicMessages", () => {
  it("converts text-only user/assistant messages", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ];
    expect(toAnthropicMessages(msgs)).toEqual([
      { role: "user", content: [{ type: "text", text: "ping" }] },
      { role: "assistant", content: [{ type: "text", text: "pong" }] },
    ]);
  });

  it("merges text + tool_uses into a single assistant message", () => {
    const msgs: ChatMessage[] = [
      {
        role: "assistant",
        content: "calling echo",
        toolUses: [{ id: "t1", name: "echo", input: { text: "hi" } }],
      },
    ];
    expect(toAnthropicMessages(msgs)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling echo" },
          { type: "tool_use", id: "t1", name: "echo", input: { text: "hi" } },
        ],
      },
    ]);
  });

  it("groups consecutive tool_result blocks into one user message", () => {
    const msgs: ChatMessage[] = [
      {
        role: "tool_result",
        toolUseId: "t1",
        content: '{"r":1}',
        isError: false,
      },
      {
        role: "tool_result",
        toolUseId: "t2",
        content: '{"r":2}',
        isError: false,
      },
    ];
    const result = toAnthropicMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: '{"r":1}',
          is_error: false,
        },
        {
          type: "tool_result",
          tool_use_id: "t2",
          content: '{"r":2}',
          is_error: false,
        },
      ],
    });
  });
});

describe("createAnthropicAdapter.chatWithTools", () => {
  it("single turn (end_turn) yields iteration, text_delta, done(end_turn)", async () => {
    streamMock.mockReturnValueOnce(
      fakeStream({ finalText: "hello", stopReason: "end_turn" }),
    );
    const adapter = createAnthropicAdapter("sk-x", "claude-sonnet-4-6");
    const events = await collect(
      adapter.chatWithTools({
        system: "you are a bot",
        messages: [{ role: "user", content: "say hi" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(events).toEqual([
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "hello" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("1 tool_use round trip — calls onToolCall once and resolves", async () => {
    streamMock
      .mockReturnValueOnce(
        fakeStream({
          finalText: "calling",
          toolUses: [{ id: "t1", name: "echo", input: { text: "ping" } }],
          stopReason: "tool_use",
        }),
      )
      .mockReturnValueOnce(
        fakeStream({ finalText: "done", stopReason: "end_turn" }),
      );

    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: '{"result":"ping"}', isError: false });

    const adapter = createAnthropicAdapter("sk-x", "claude-sonnet-4-6");
    const events = await collect(
      adapter.chatWithTools({
        system: "sys",
        messages: [{ role: "user", content: "echo ping" }],
        tools: TOOLS,
        onToolCall,
      }),
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith("echo", { text: "ping" });
    expect(events.map((e) => e.type)).toEqual([
      "iteration",
      "text_delta",
      "tool_use",
      "tool_result",
      "iteration",
      "text_delta",
      "done",
    ]);
    expect(events[events.length - 1]).toEqual({
      type: "done",
      stopReason: "end_turn",
    });
  });

  it("multiple tool_use in one turn — onToolCall called per block", async () => {
    streamMock
      .mockReturnValueOnce(
        fakeStream({
          toolUses: [
            { id: "t1", name: "echo", input: { text: "a" } },
            { id: "t2", name: "echo", input: { text: "b" } },
          ],
          stopReason: "tool_use",
        }),
      )
      .mockReturnValueOnce(
        fakeStream({ finalText: "ok", stopReason: "end_turn" }),
      );

    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: "ok", isError: false });
    const adapter = createAnthropicAdapter("sk-x", "claude-sonnet-4-6");
    await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "do both" }],
        tools: TOOLS,
        onToolCall,
      }),
    );
    expect(onToolCall).toHaveBeenCalledTimes(2);
  });

  it("max_iterations hit — yields done(max_iterations) and stops", async () => {
    // Always tool_use → infinite loop without the cap.
    streamMock.mockReturnValue(
      fakeStream({
        toolUses: [{ id: "t1", name: "echo", input: {} }],
        stopReason: "tool_use",
      }),
    );
    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: "{}", isError: false });
    const adapter = createAnthropicAdapter("sk-x", "claude-sonnet-4-6");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "loop" }],
        tools: TOOLS,
        onToolCall,
        maxIterations: 2,
      }),
    );
    expect(onToolCall).toHaveBeenCalledTimes(2);
    const last = events[events.length - 1];
    expect(last).toEqual({ type: "done", stopReason: "max_iterations" });
  });

  it("SDK throw is converted to done(error), no exception leaks", async () => {
    streamMock.mockImplementation(() => {
      throw new Error("network down");
    });
    const adapter = createAnthropicAdapter("sk-x", "claude-sonnet-4-6");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(events[events.length - 1]).toEqual({
      type: "done",
      stopReason: "error",
      error: "network down",
    });
  });
});

describe("createAnthropicAdapter: usage, approval and iteration offset", () => {
  const run = (input: Partial<Parameters<ReturnType<typeof createAnthropicAdapter>["chatWithTools"]>[0]> = {}) =>
    collect(
      createAnthropicAdapter("sk-x", "claude-sonnet-4-6").chatWithTools({
        system: "sys",
        messages: [{ role: "user", content: "go" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "ok", isError: false }),
        ...input,
      }),
    );

  it("reports usage once per request: input includes cache reads and writes", async () => {
    streamMock.mockReturnValueOnce(
      fakeStream({
        finalText: "hi",
        usage: { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 },
      }),
    );
    const events = await run();
    expect(events.map((e) => e.type)).toEqual(["iteration", "text_delta", "usage", "done"]);
    expect(events[2]).toEqual({ type: "usage", usage: { input: 350, output: 7, cacheRead: 300, cacheWrite: 40 } });
  });

  it("emits no usage event when the stream does not report it", async () => {
    streamMock.mockReturnValueOnce(fakeStream({ finalText: "hi" }));
    expect((await run()).map((e) => e.type)).toEqual(["iteration", "text_delta", "done"]);
  });

  it("suspends before running tools when approval is required, without calling onToolCall", async () => {
    streamMock.mockReturnValueOnce(
      fakeStream({ finalText: "calling", toolUses: [{ id: "t1", name: "echo", input: { text: "x" } }], stopReason: "tool_use", usage: { input_tokens: 5, output_tokens: 2 } }),
    );
    const onToolCall = vi.fn();
    const requireApproval = vi.fn().mockReturnValue(true);
    const events = await run({ onToolCall, requireApproval });
    expect(onToolCall).not.toHaveBeenCalled();
    expect(requireApproval).toHaveBeenCalledWith([{ id: "t1", name: "echo", input: { text: "x" } }]);
    expect(events.map((e) => e.type)).toEqual(["iteration", "text_delta", "usage", "approval_required", "done"]);
    expect(events[3]).toEqual({ type: "approval_required", calls: [{ id: "t1", name: "echo", input: { text: "x" } }], iterationsUsed: 1 });
    expect(events[4]).toEqual({ type: "done", stopReason: "awaiting_approval" });
  });

  it("runs tools normally when approval is not required for the calls", async () => {
    streamMock
      .mockReturnValueOnce(fakeStream({ toolUses: [{ id: "t1", name: "echo", input: {} }], stopReason: "tool_use" }))
      .mockReturnValueOnce(fakeStream({ finalText: "done" }));
    const onToolCall = vi.fn().mockResolvedValue({ content: "ok", isError: false });
    const events = await run({ onToolCall, requireApproval: () => false });
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("continues iteration numbers and the limit after an approval (iterationOffset)", async () => {
    streamMock.mockReturnValue(fakeStream({ toolUses: [{ id: "t9", name: "echo", input: {} }], stopReason: "tool_use" }));
    const events = await run({ iterationOffset: 2, maxIterations: 4 });
    // 2, 3 만 돈다 (이미 2번 썼으므로 남은 한도는 2번)
    expect(events.filter((e) => e.type === "iteration")).toEqual([
      { type: "iteration", index: 2 },
      { type: "iteration", index: 3 },
    ]);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "max_iterations" });
    expect(streamMock).toHaveBeenCalledTimes(2);
  });
});
