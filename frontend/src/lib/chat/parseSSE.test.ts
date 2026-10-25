import { describe, expect, it } from "vitest";

import type { WireEvent } from "./events";

import { parseSSEStream } from "./parseSSE";

const encoder = new TextEncoder();

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function encode(ev: WireEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const ev of parseSSEStream(stream)) out.push(ev);
  return out;
}

describe("parseSSEStream", () => {
  it("decodes a single event from one chunk", async () => {
    const ev: WireEvent = { type: "iteration", index: 0 };
    const stream = makeStream([encode(ev)]);
    expect(await collect(stream)).toEqual([ev]);
  });

  it("decodes multiple events in order from one chunk", async () => {
    const evs: WireEvent[] = [
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "hello " },
      { type: "text_delta", text: "world" },
      { type: "done", stopReason: "end_turn" },
    ];
    const stream = makeStream([evs.map(encode).join("")]);
    expect(await collect(stream)).toEqual(evs);
  });

  it("reassembles events split across chunk boundaries", async () => {
    const evs: WireEvent[] = [
      { type: "iteration", index: 0 },
      { type: "text_delta", text: "ping" },
      { type: "done", stopReason: "end_turn" },
    ];
    const wire = evs.map(encode).join("");
    // 4-byte chunks to maximize boundary crossings.
    const chunks: string[] = [];
    for (let i = 0; i < wire.length; i += 4) chunks.push(wire.slice(i, i + 4));
    expect(await collect(makeStream(chunks))).toEqual(evs);
  });

  it("ignores empty chunks (extra blank lines)", async () => {
    const ev: WireEvent = { type: "text_delta", text: "x" };
    // double delimiter (extra blank "message" between two events).
    const stream = makeStream([encode(ev), "\n\n", encode(ev)]);
    expect(await collect(stream)).toEqual([ev, ev]);
  });

  it("skips malformed JSON lines but keeps subsequent events", async () => {
    const good: WireEvent = { type: "iteration", index: 1 };
    const stream = makeStream([
      "data: {not-json}\n\n",
      "data: missing-prefix\n\n", // no "data: " — parseChunk returns null.
      encode(good),
    ]);
    expect(await collect(stream)).toEqual([good]);
  });

  it("yields done event and terminates on stream close", async () => {
    const done: WireEvent = {
      type: "done",
      stopReason: "error",
      error: "boom",
    };
    const stream = makeStream([encode(done)]);
    const events = await collect(stream);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(done);
  });
});

describe("parseSSEStream with server timing", () => {
  it("passes through run_start and the t/server/tool fields", async () => {
    const evs: WireEvent[] = [
      { type: "run_start", t: 0, startedAt: 1_700_000_000_000 },
      { type: "tool_use", id: "a", name: "p__echo", input: {}, server: "p", tool: "echo", t: 12.3 },
      { type: "tool_result", toolUseId: "a", content: "ok", isError: false, server: "p", tool: "echo", t: 20.1 },
      { type: "done", stopReason: "end_turn", t: 30 },
    ];
    expect(await collect(makeStream([evs.map(encode).join("")]))).toEqual(evs);
  });

  it("still reads events from an older server that sends no times", async () => {
    const old = `data: {"type":"iteration","index":0}\n\ndata: {"type":"done","stopReason":"end_turn"}\n\n`;
    const out = await collect(makeStream([old]));
    expect(out).toEqual([
      { type: "iteration", index: 0 },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("skips events of a type it does not know", async () => {
    const mixed = `data: {"type":"future_event","x":1}\n\ndata: {"type":"done","stopReason":"end_turn"}\n\n`;
    expect(await collect(makeStream([mixed]))).toEqual([{ type: "done", stopReason: "end_turn" }]);
  });
});
