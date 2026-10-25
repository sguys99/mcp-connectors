import { afterEach, describe, expect, it, vi } from "vitest";

import type { WireEvent } from "./events";

import { runChatStream, type ChatStreamRequest } from "./runChatStream";

const encoder = new TextEncoder();

function encodeEvent(ev: WireEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

function streamFromEvents(events: WireEvent[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(encodeEvent(ev)));
      controller.close();
    },
  });
}

function makeRequest(): ChatStreamRequest {
  return {
    provider: "anthropic",
    apiKey: "sk-test",
    model: "claude-sonnet-4-6",
    serverNames: ["starter-mcp-http"],
    messages: [{ role: "user", content: "ping" }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runChatStream", () => {
  it("happy path: yields all events and resolves with ok", async () => {
    const events: WireEvent[] = [
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "ping" },
      { type: "done", stopReason: "end_turn" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamFromEvents(events))),
    );

    const received: WireEvent[] = [];
    const outcome = await runChatStream(
      makeRequest(),
      new AbortController().signal,
      (ev) => received.push(ev),
    );

    expect(outcome).toEqual({ kind: "ok" });
    expect(received).toEqual(events);
  });

  it("tool_use cycle: forwards every event in order", async () => {
    const events: WireEvent[] = [
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
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamFromEvents(events))),
    );

    const received: WireEvent[] = [];
    const outcome = await runChatStream(
      makeRequest(),
      new AbortController().signal,
      (ev) => received.push(ev),
    );

    expect(outcome).toEqual({ kind: "ok" });
    expect(received).toEqual(events);
  });

  it("HTTP 400 with JSON body surfaces error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "apiKey is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const outcome = await runChatStream(
      makeRequest(),
      new AbortController().signal,
      () => {
        throw new Error("onEvent must not fire on http_error");
      },
    );

    expect(outcome).toEqual({
      kind: "http_error",
      status: 400,
      message: "apiKey is required",
    });
  });

  it("AbortError during fetch returns abort outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );

    const outcome = await runChatStream(
      makeRequest(),
      new AbortController().signal,
      () => undefined,
    );

    expect(outcome).toEqual({ kind: "abort" });
  });

  it("non-Abort fetch rejection becomes exception outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const outcome = await runChatStream(
      makeRequest(),
      new AbortController().signal,
      () => undefined,
    );

    expect(outcome).toEqual({ kind: "exception", message: "network down" });
  });
});
