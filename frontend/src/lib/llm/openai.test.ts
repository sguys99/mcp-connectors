import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolMeta } from "@/lib/mcp/types";

import type { ChatMessage, LLMEvent } from "./adapter";

// OpenAI SDK mock — class form (arrow mockImplementation can't be `new`'d).
const createMock = vi.fn();
const OpenAIConstructorSpy = vi.fn();
vi.mock("openai", () => {
  class OpenAIMock {
    chat = { completions: { create: createMock } };
    constructor(opts: unknown) {
      OpenAIConstructorSpy(opts);
    }
  }
  return { default: OpenAIMock };
});

const {
  toOpenAITools,
  toOpenAIMessages,
  createOpenAIAdapter,
} = await import("./openai");

// Build a fake streaming response: async-iterable of ChatCompletionChunk-like.
function fakeChunkStream(chunks: unknown[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[i++] };
        },
      };
    },
  };
}

function textChunk(text: string, finish: string | null = null) {
  return {
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: finish,
      },
    ],
  };
}

function toolCallChunk(opts: {
  index: number;
  id?: string;
  name?: string;
  argsDelta?: string;
  finish?: string | null;
}) {
  return {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: opts.index,
              ...(opts.id ? { id: opts.id } : {}),
              function: {
                ...(opts.name ? { name: opts.name } : {}),
                ...(opts.argsDelta !== undefined
                  ? { arguments: opts.argsDelta }
                  : {}),
              },
            },
          ],
        },
        finish_reason: opts.finish ?? null,
      },
    ],
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
  createMock.mockReset();
  OpenAIConstructorSpy.mockReset();
});

describe("toOpenAITools", () => {
  it("maps ToolMeta to { type:'function', function:{ name, description, parameters } }", () => {
    expect(toOpenAITools(TOOLS)).toEqual([
      {
        type: "function",
        function: {
          name: "echo",
          description: "echoes text",
          parameters: TOOLS[0].inputSchema,
        },
      },
    ]);
  });
});

describe("toOpenAIMessages", () => {
  it("prepends system, passes through user, stringifies assistant tool_calls.arguments", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "ping" },
      {
        role: "assistant",
        content: "calling",
        toolUses: [{ id: "t1", name: "echo", input: { text: "hi" } }],
      },
      {
        role: "tool_result",
        toolUseId: "t1",
        content: '{"ok":true}',
        isError: false,
      },
    ];
    expect(toOpenAIMessages("sys", msgs)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "ping" },
      {
        role: "assistant",
        content: "calling",
        tool_calls: [
          {
            id: "t1",
            type: "function",
            function: { name: "echo", arguments: '{"text":"hi"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "t1", content: '{"ok":true}' },
    ]);
  });

  it("uses null content when assistant has empty text + tool_calls", () => {
    const msgs: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolUses: [{ id: "t1", name: "echo", input: {} }],
      },
    ];
    expect(toOpenAIMessages("sys", msgs)[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "t1",
          type: "function",
          function: { name: "echo", arguments: "{}" },
        },
      ],
    });
  });
});

describe("createOpenAIAdapter.chatWithTools", () => {
  it("single turn (stop) yields text_delta and done(end_turn)", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([textChunk("hello", "stop")]),
    );
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
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

  it("1 tool_call round trip with delta-accumulated arguments", async () => {
    createMock
      .mockResolvedValueOnce(
        fakeChunkStream([
          toolCallChunk({ index: 0, id: "t1", name: "echo" }),
          toolCallChunk({ index: 0, argsDelta: '{"text":' }),
          toolCallChunk({ index: 0, argsDelta: '"ping"}', finish: "tool_calls" }),
        ]),
      )
      .mockResolvedValueOnce(fakeChunkStream([textChunk("done", "stop")]));

    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: '{"result":"ping"}', isError: false });
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "echo ping" }],
        tools: TOOLS,
        onToolCall,
      }),
    );

    expect(onToolCall).toHaveBeenCalledExactlyOnceWith("echo", {
      text: "ping",
    });
    expect(events.map((e) => e.type)).toEqual([
      "iteration",
      "tool_use",
      "tool_result",
      "iteration",
      "text_delta",
      "done",
    ]);
  });

  it("corrupt JSON arguments — skips onToolCall, yields isError tool_result", async () => {
    createMock
      .mockResolvedValueOnce(
        fakeChunkStream([
          toolCallChunk({
            index: 0,
            id: "t1",
            name: "echo",
            argsDelta: "{not json",
            finish: "tool_calls",
          }),
        ]),
      )
      .mockResolvedValueOnce(fakeChunkStream([textChunk("ok", "stop")]));

    const onToolCall = vi.fn();
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall,
      }),
    );

    expect(onToolCall).not.toHaveBeenCalled();
    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toMatchObject({
      type: "tool_result",
      toolUseId: "t1",
      isError: true,
    });
    if (tr && tr.type === "tool_result") {
      expect(tr.content).toContain("Invalid JSON in tool arguments");
    }
  });

  it("parallel tool_calls — onToolCall called per index, yield order = input order", async () => {
    createMock
      .mockResolvedValueOnce(
        fakeChunkStream([
          toolCallChunk({
            index: 0,
            id: "t1",
            name: "echo",
            argsDelta: '{"text":"a"}',
          }),
          toolCallChunk({
            index: 1,
            id: "t2",
            name: "echo",
            argsDelta: '{"text":"b"}',
            finish: "tool_calls",
          }),
        ]),
      )
      .mockResolvedValueOnce(fakeChunkStream([textChunk("done", "stop")]));

    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: "ok", isError: false });
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "do both" }],
        tools: TOOLS,
        onToolCall,
      }),
    );

    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(onToolCall).toHaveBeenNthCalledWith(1, "echo", { text: "a" });
    expect(onToolCall).toHaveBeenNthCalledWith(2, "echo", { text: "b" });

    const toolUseEvents = events.filter((e) => e.type === "tool_use");
    expect(toolUseEvents.map((e) => (e.type === "tool_use" ? e.id : ""))).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("max_iterations hit yields done(max_iterations)", async () => {
    const buildToolCallStream = () =>
      fakeChunkStream([
        toolCallChunk({
          index: 0,
          id: "t1",
          name: "echo",
          argsDelta: "{}",
          finish: "tool_calls",
        }),
      ]);
    createMock.mockImplementation(() => Promise.resolve(buildToolCallStream()));

    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "loop" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "ok", isError: false }),
        maxIterations: 2,
      }),
    );
    expect(events[events.length - 1]).toEqual({
      type: "done",
      stopReason: "max_iterations",
    });
  });

  it("SDK throw → done(error), no exception leaks", async () => {
    createMock.mockRejectedValueOnce(new Error("rate limited"));
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
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
      error: "rate limited",
    });
  });

  it("createOpenAIAdapter constructs OpenAI without baseURL/defaultHeaders", async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([textChunk("", "stop")]));
    const adapter = createOpenAIAdapter("sk-x", "gpt-4o");
    await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(OpenAIConstructorSpy).toHaveBeenCalledTimes(1);
    const callArg = OpenAIConstructorSpy.mock.calls[0][0];
    expect(callArg.apiKey).toBe("sk-x");
    expect(callArg.baseURL).toBeUndefined();
    expect(callArg.defaultHeaders).toBeUndefined();
  });
});

describe("createOpenAIAdapter: usage, approval and iteration offset", () => {
  const usageChunk = (usage: unknown) => ({ choices: [], usage });
  const run = (input: Partial<Parameters<ReturnType<typeof createOpenAIAdapter>["chatWithTools"]>[0]> = {}) =>
    collect(
      createOpenAIAdapter("sk-x", "gpt-4o").chatWithTools({
        system: "sys",
        messages: [{ role: "user", content: "go" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "ok", isError: false }),
        ...input,
      }),
    );

  it("asks the stream to include usage and reads it from the final chunk with empty choices", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([
        textChunk("hi"),
        textChunk("", "stop"),
        usageChunk({ prompt_tokens: 120, completion_tokens: 9, total_tokens: 129, prompt_tokens_details: { cached_tokens: 100 } }),
      ]),
    );
    const events = await run();
    expect(createMock.mock.calls[0]![0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(events.map((e) => e.type)).toEqual(["iteration", "text_delta", "usage", "done"]);
    expect(events[2]).toEqual({ type: "usage", usage: { input: 120, output: 9, cacheRead: 100 } });
  });

  it("omits the usage event when the stream never sends one (interrupted or unsupported provider)", async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([textChunk("hi"), textChunk("", "stop")]));
    expect((await run()).map((e) => e.type)).toEqual(["iteration", "text_delta", "done"]);
  });

  it("ignores malformed usage objects", async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([textChunk("hi", "stop"), usageChunk({ prompt_tokens: "many" })]));
    expect((await run()).map((e) => e.type)).not.toContain("usage");
  });

  it("suspends tool calls for approval without running them, and numbers iterations after an offset", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([toolCallChunk({ index: 0, id: "c1", name: "echo", argsDelta: '{"text":"x"}', finish: "tool_calls" })]),
    );
    const onToolCall = vi.fn();
    const events = await run({ onToolCall, requireApproval: () => true, iterationOffset: 1 });
    expect(onToolCall).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "iteration", index: 1 },
      { type: "approval_required", calls: [{ id: "c1", name: "echo", input: { text: "x" } }], iterationsUsed: 2 },
      { type: "done", stopReason: "awaiting_approval" },
    ]);
  });
});
