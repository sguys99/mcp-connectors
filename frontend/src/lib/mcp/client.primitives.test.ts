// @vitest-environment node
// MCPClient 의 Resources, Prompts, 서버 정보 API. 업스트림은 fetch 를 가짜로 바꿔 최소한의 MCP 서버를 흉내 낸다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMCPClient } from "./client";
import { appendRpc, emptyRpcLog } from "@/lib/inspector/rpc-log";

import type { RpcMessageEvent, RpcTrafficEvent } from "./types";

interface Rpc {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const SERVER = { name: "fake", transport: "streamable_http" as const, url: "http://test.local/api/mcp/fake" };

const calls: Rpc[] = [];
let pages = false;

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

function result(rpc: Rpc): Response {
  const ok = (r: unknown) => json({ jsonrpc: "2.0", id: rpc.id, result: r });
  switch (rpc.method) {
    case "initialize":
      return json(
        {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {}, resources: { listChanged: true }, prompts: {} },
            serverInfo: { name: "fake", version: "1.2.3" },
            instructions: "Be kind.",
          },
        },
        { "mcp-session-id": "sess-1" },
      );
    case "resources/list":
      if (pages && !rpc.params?.cursor) {
        return ok({ resources: [{ uri: "a://1", name: "one" }], nextCursor: "c2" });
      }
      return ok({
        resources: [{ uri: "a://2", name: "two", title: "Two", description: "d", mimeType: "text/plain", size: 5 }],
      });
    case "resources/templates/list":
      return ok({ resourceTemplates: [{ uriTemplate: "a://hello/{name}", name: "hello", mimeType: "text/plain" }] });
    case "resources/read":
      return json(
        { jsonrpc: "2.0", id: rpc.id, result: { contents: [{ uri: String(rpc.params?.uri), mimeType: "text/plain", text: "body" }] } },
        { "server-timing": "proxy;dur=1.0, upstream;dur=2.0" },
      );
    case "prompts/list":
      return ok({ prompts: [{ name: "p", description: "pd", arguments: [{ name: "x", required: true }, { name: "y" }] }] });
    case "prompts/get":
      if (rpc.params?.name === "missing") {
        return json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: "Unknown prompt: missing" } });
      }
      return ok({
        description: "hi",
        messages: [{ role: "user", content: { type: "text", text: `x=${(rpc.params?.arguments as { x?: string })?.x}` } }],
      });
    default:
      return new Response(null, { status: 202 });
  }
}

beforeEach(() => {
  calls.length = 0;
  pages = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") return new Response(null, { status: 200 });
      const rpc = JSON.parse(String(init?.body)) as Rpc;
      calls.push(rpc);
      return result(rpc);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("MCPClient.getServerInfo", () => {
  it("returns the initialize result: serverInfo, protocol version, capabilities, instructions, session id", async () => {
    const client = createMCPClient(SERVER);
    const info = await client.getServerInfo();
    expect(info).toEqual({
      serverInfo: { name: "fake", version: "1.2.3" },
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: { listChanged: true }, prompts: {} },
      instructions: "Be kind.",
      sessionId: "sess-1",
    });
    await client.close();
  });
});

describe("MCPClient resources", () => {
  it("lists resources, following nextCursor", async () => {
    pages = true;
    const client = createMCPClient(SERVER);
    const list = await client.listResources();
    expect(list.map((r) => r.uri)).toEqual(["a://1", "a://2"]);
    expect(list[1]).toEqual({ uri: "a://2", name: "two", title: "Two", description: "d", mimeType: "text/plain", size: 5 });
    expect(calls.filter((c) => c.method === "resources/list")).toHaveLength(2);
    await client.close();
  });

  it("lists resource templates", async () => {
    const client = createMCPClient(SERVER);
    expect(await client.listResourceTemplates()).toEqual([{ uriTemplate: "a://hello/{name}", name: "hello", mimeType: "text/plain" }]);
    await client.close();
  });

  it("reads a resource with detail (outcome, request id, Server-Timing)", async () => {
    const client = createMCPClient(SERVER);
    const res = await client.readResource("a://hello/world");
    expect(res.isError).toBe(false);
    expect(res.detail).toMatchObject({
      outcome: "ok",
      payload: { contents: [{ uri: "a://hello/world", text: "body" }] },
      proxyTiming: { proxyMs: 1, upstreamMs: 2 },
    });
    expect(res.detail?.requestId).toBe(calls.find((c) => c.method === "resources/read")?.id);
    expect(res.content).toEqual([{ uri: "a://hello/world", mimeType: "text/plain", text: "body" }]);
    await client.close();
  });
});

describe("MCPClient prompts", () => {
  it("lists prompts with required flags", async () => {
    const client = createMCPClient(SERVER);
    expect(await client.listPrompts()).toEqual([
      { name: "p", description: "pd", arguments: [{ name: "x", required: true }, { name: "y", required: false }] },
    ]);
    await client.close();
  });

  it("gets a prompt with arguments", async () => {
    const client = createMCPClient(SERVER);
    const res = await client.getPrompt("p", { x: "1" });
    expect(res.detail?.outcome).toBe("ok");
    expect(res.detail?.payload?.messages?.[0]).toEqual({ role: "user", content: { type: "text", text: "x=1" } });
    expect(calls.find((c) => c.method === "prompts/get")?.params).toMatchObject({ name: "p", arguments: { x: "1" } });
    await client.close();
  });

  it("classifies a JSON-RPC error as rpc-error", async () => {
    const client = createMCPClient(SERVER);
    const res = await client.getPrompt("missing", {});
    expect(res.isError).toBe(true);
    expect(res.detail).toMatchObject({ outcome: "rpc-error", errorCode: -32602, errorMessage: "Unknown prompt: missing" });
    await client.close();
  });
});

describe("MCPClient traffic hook", () => {
  it("reports every JSON-RPC request leaving the transport", async () => {
    const events: RpcTrafficEvent[] = [];
    const client = createMCPClient(SERVER, { onTraffic: (e) => events.push(e) });
    await client.readResource("a://x");
    const out = events.filter((e) => e.dir === "out").map((e) => e.method);
    expect(out).toContain("initialize");
    expect(out).toContain("resources/read");
    const read = events.find((e) => e.dir === "out" && e.method === "resources/read")!;
    expect(JSON.parse(read.body!)).toMatchObject({ method: "resources/read", params: { uri: "a://x" } });
    expect(events.some((e) => e.dir === "in" && e.method === "resources/read" && e.status === 200)).toBe(true);
    await client.close();
  });

  it("ignores errors thrown by the hook", async () => {
    const client = createMCPClient(SERVER, {
      onTraffic: () => {
        throw new Error("boom");
      },
    });
    expect((await client.readResource("a://x")).detail?.outcome).toBe("ok");
    await client.close();
  });
});

describe("MCPClient message hook", () => {
  it("reports full outgoing and incoming JSON-RPC messages, including notifications", async () => {
    const events: RpcMessageEvent[] = [];
    const client = createMCPClient(SERVER, { onMessage: (e) => events.push(e) });
    await client.readResource("a://x");
    const methodOf = (e: RpcMessageEvent) => (e.message as { method?: string }).method;
    const out = events.filter((e) => e.dir === "out").map(methodOf);
    expect(out).toEqual(expect.arrayContaining(["initialize", "notifications/initialized", "resources/read"]));
    const read = events.find((e) => e.dir === "out" && methodOf(e) === "resources/read")!;
    expect(read.message).toMatchObject({ jsonrpc: "2.0", method: "resources/read", params: { uri: "a://x" } });
    const answered = events.filter((e) => e.dir === "in").map((e) => e.message as { id?: number; result?: unknown });
    expect(answered.some((m) => m.id === (read.message as { id: number }).id && m.result !== undefined)).toBe(true);
    expect(read.at).toBeGreaterThan(0);
    expect(read.t).toBeGreaterThan(0);

    // 같은 이벤트로 로그가 요청과 응답을 짝지어 준다
    const log = events.reduce(appendRpc, emptyRpcLog());
    const response = log.entries.find((e) => e.kind === "response" && e.method === "resources/read")!;
    expect(response.status).toBe("ok");
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    await client.close();
  });

  it("does not break calls when the hook throws", async () => {
    const client = createMCPClient(SERVER, {
      onMessage: () => {
        throw new Error("boom");
      },
    });
    expect((await client.readResource("a://x")).detail?.outcome).toBe("ok");
    await client.close();
  });
});
