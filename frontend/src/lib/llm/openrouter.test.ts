import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolMeta } from "@/lib/mcp/types";

import type { LLMEvent } from "./adapter";

// Same OpenAI SDK mock pattern as openai.test.ts — openrouter.ts goes through
// the same internal helper, so it ends up calling `new OpenAI(...)` too.
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

const { createOpenRouterAdapter } = await import("./openrouter");

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

async function collect(it: AsyncIterable<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const TOOLS: ToolMeta[] = [
  {
    name: "echo",
    description: "echoes text",
    inputSchema: { type: "object", properties: {} },
  },
];

beforeEach(() => {
  createMock.mockReset();
  OpenAIConstructorSpy.mockReset();
});

describe("createOpenRouterAdapter — SDK wiring", () => {
  it("constructs OpenAI client with OpenRouter baseURL", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([
        {
          choices: [
            { index: 0, delta: { content: "ok" }, finish_reason: "stop" },
          ],
        },
      ]),
    );
    const adapter = createOpenRouterAdapter(
      "sk-or-x",
      "anthropic/claude-sonnet-4-6",
    );
    await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(OpenAIConstructorSpy).toHaveBeenCalledTimes(1);
    const opts = OpenAIConstructorSpy.mock.calls[0][0];
    expect(opts.apiKey).toBe("sk-or-x");
    expect(opts.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("includes OpenRouter analytics headers (HTTP-Referer, X-Title)", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([
        {
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "stop" },
          ],
        },
      ]),
    );
    const adapter = createOpenRouterAdapter("sk-or-x", "openai/gpt-4o");
    await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    const opts = OpenAIConstructorSpy.mock.calls[0][0];
    expect(opts.defaultHeaders).toEqual({
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "mcp-connectors",
    });
  });

  it("passes provider/model string verbatim to SDK call", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([
        {
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "stop" },
          ],
        },
      ]),
    );
    const adapter = createOpenRouterAdapter(
      "sk-or-x",
      "anthropic/claude-sonnet-4-6",
    );
    await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "x" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    const [params] = createMock.mock.calls[0];
    expect(params.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("tool_use round-trip works identically to openai adapter", async () => {
    createMock
      .mockResolvedValueOnce(
        fakeChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "t1",
                      function: { name: "echo", arguments: '{"text":"hi"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        fakeChunkStream([
          {
            choices: [
              { index: 0, delta: { content: "done" }, finish_reason: "stop" },
            ],
          },
        ]),
      );
    const onToolCall = vi
      .fn()
      .mockResolvedValue({ content: "hi", isError: false });
    const adapter = createOpenRouterAdapter("sk-or-x", "openai/gpt-4o");
    const events = await collect(
      adapter.chatWithTools({
        system: "",
        messages: [{ role: "user", content: "echo hi" }],
        tools: TOOLS,
        onToolCall,
      }),
    );
    expect(onToolCall).toHaveBeenCalledExactlyOnceWith("echo", { text: "hi" });
    expect(events[events.length - 1]).toEqual({
      type: "done",
      stopReason: "end_turn",
    });
  });
});

describe("createOpenRouterAdapter: usage", () => {
  it("also asks for streamed usage and reports cache write tokens when the provider sends them", async () => {
    createMock.mockResolvedValueOnce(
      fakeChunkStream([
        { choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] },
        {
          choices: [],
          usage: { prompt_tokens: 50, completion_tokens: 4, total_tokens: 54, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 } },
        },
      ]),
    );
    const events = await collect(
      createOpenRouterAdapter("sk-or-x", "anthropic/claude-sonnet-4-6").chatWithTools({
        system: "sys",
        messages: [{ role: "user", content: "go" }],
        tools: TOOLS,
        onToolCall: async () => ({ content: "", isError: false }),
      }),
    );
    expect(createMock.mock.calls[0]![0]).toMatchObject({ stream_options: { include_usage: true } });
    expect(events.find((e) => e.type === "usage")).toEqual({ type: "usage", usage: { input: 50, output: 4, cacheRead: 20, cacheWrite: 10 } });
  });
});
