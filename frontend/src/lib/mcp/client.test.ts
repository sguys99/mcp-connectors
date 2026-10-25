// @vitest-environment node
// MCPClient.callTool: 결과 분류, Server-Timing 수집, 취소(notifications/cancelled)와 취소 뒤 재호출.
// 업스트림은 fetch 를 가짜로 바꿔 최소한의 MCP 서버(initialize, tools/call)를 흉내 낸다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMCPClient, noRedirectFetch } from "./client";

interface Rpc {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: { name?: string; requestId?: number; reason?: string };
}

const SERVER = { name: "fake", transport: "streamable_http" as const, url: "http://test.local/api/mcp/fake" };

const calls: Rpc[] = [];
let toolHandler: (rpc: Rpc) => Promise<Response> | Response;
// initialize 응답을 늦추는 시간(ms). ping 이 세션 연결 시간을 지연에 넣지 않는지 본다.
let initDelayMs = 0;

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  calls.length = 0;
  initDelayMs = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") return new Response(null, { status: 200 });
      const rpc = JSON.parse(String(init?.body)) as Rpc;
      calls.push(rpc);
      switch (rpc.method) {
        case "initialize":
          if (initDelayMs) await new Promise((r) => setTimeout(r, initDelayMs));
          return json(
            {
              jsonrpc: "2.0",
              id: rpc.id,
              result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } },
            },
            { "mcp-session-id": "s1" },
          );
        case "tools/call":
          return toolHandler(rpc);
        case "tools/list":
          return json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
        default:
          return new Response(null, { status: 202 });
      }
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const okResult = (rpc: Rpc, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "hi" }], ...extra } }, headers);

describe("MCPClient.callTool", () => {
  it("returns detail with the request id, size and the proxy's Server-Timing", async () => {
    toolHandler = (rpc) => okResult(rpc, {}, { "server-timing": 'proxy;dur=1.5, upstream;dur=4.5;desc="first-byte", headers;dur=1.0' });
    const client = createMCPClient(SERVER);
    const result = await client.callTool("echo", { text: "hi" });
    expect(result.isError).toBe(false);
    expect(result.detail).toMatchObject({
      outcome: "ok",
      proxyTiming: { proxyMs: 1.5, upstreamMs: 4.5, headersMs: 1.0 },
      payload: { content: [{ type: "text", text: "hi" }] },
    });
    expect(result.detail?.requestId).toBe(calls.find((c) => c.method === "tools/call")?.id);
    expect(result.detail?.bytes).toBeGreaterThan(10);
    expect(result.detail?.elapsedMs).toBeGreaterThanOrEqual(0);
    await client.close();
  });

  it("has no proxyTiming when the header is missing (direct connection)", async () => {
    toolHandler = (rpc) => okResult(rpc);
    const client = createMCPClient(SERVER);
    expect((await client.callTool("echo", {})).detail?.proxyTiming).toBeUndefined();
    await client.close();
  });

  it("classifies isError results, JSON-RPC errors and transport failures", async () => {
    const client = createMCPClient(SERVER);

    toolHandler = (rpc) => okResult(rpc, { isError: true, content: [{ type: "text", text: "nope [WRITE_BLOCKED]" }] });
    const toolError = await client.callTool("x", {});
    expect(toolError.isError).toBe(true);
    expect(toolError.detail?.outcome).toBe("tool-error");

    toolHandler = (rpc) => json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: "Unknown tool: x" } });
    const rpcError = await client.callTool("x", {});
    expect(rpcError.detail).toMatchObject({ outcome: "rpc-error", errorCode: -32602, errorMessage: "Unknown tool: x" });

    toolHandler = () => Promise.reject(new TypeError("fetch failed"));
    const transport = await client.callTool("x", {});
    expect(transport.detail?.outcome).toBe("transport");
    await client.close();
  });

  it("cancels with notifications/cancelled and keeps the session usable", async () => {
    // 첫 호출은 응답하지 않는 느린 도구, 이후 호출은 바로 응답한다.
    let slow = true;
    toolHandler = (rpc) => (slow ? new Promise<Response>(() => {}) : okResult(rpc));
    const client = createMCPClient(SERVER);
    const controller = new AbortController();

    const pending = client.callTool("slow", {}, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 30));
    controller.abort("User cancelled from Inspector");
    const cancelled = await pending;

    expect(cancelled.detail).toMatchObject({ outcome: "cancelled", cancelNotified: true });
    const call = calls.find((c) => c.method === "tools/call")!;
    const note = calls.find((c) => c.method === "notifications/cancelled");
    expect(note?.params).toMatchObject({ requestId: call.id, reason: "User cancelled from Inspector" });
    expect(cancelled.detail?.requestId).toBe(call.id);

    slow = false;
    const next = await client.callTool("echo", {});
    expect(next.detail?.outcome).toBe("ok");
    // 같은 연결을 재사용했다 (initialize 는 한 번뿐).
    expect(calls.filter((c) => c.method === "initialize")).toHaveLength(1);
    await client.close();
  });

  it("treats an already-aborted signal as cancelled without sending a request", async () => {
    toolHandler = (rpc) => okResult(rpc);
    const client = createMCPClient(SERVER);
    const controller = new AbortController();
    controller.abort("early");
    const result = await client.callTool("echo", {}, { signal: controller.signal });
    expect(result.detail?.outcome).toBe("cancelled");
    expect(calls.some((c) => c.method === "tools/call")).toBe(false);
    await client.close();
  });
});

describe("MCPClient.ping", () => {
  it("measures only the tools/list round trip, not the first session handshake", async () => {
    initDelayMs = 300;
    const client = createMCPClient(SERVER);
    const first = await client.ping();
    expect(first).toMatchObject({ ok: true, toolCount: 1 });
    expect(first.latencyMs).toBeLessThan(200);
    expect(calls.map((c) => c.method)).toContain("initialize");
    await client.close();
  });
});

describe("noRedirectFetch", () => {
  it("asks fetch not to follow redirects and refuses a 3xx response", async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 307, headers: { location: "http://169.254.169.254/" } });
    });
    await expect(noRedirectFetch(base as unknown as typeof fetch)("http://example.test/mcp", { method: "POST" })).rejects.toThrow(/redirect \(307\) refused/);
  });

  it("passes other responses through", async () => {
    const base = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await noRedirectFetch(base as unknown as typeof fetch)("http://example.test/mcp");
    expect(await res.text()).toBe("ok");
  });
});

describe("MCPClient.close", () => {
  it("terminates the server session with DELETE and the Mcp-Session-Id header", async () => {
    const client = createMCPClient(SERVER);
    await client.getServerInfo();
    await client.close();
    const fetchMock = vi.mocked(globalThis.fetch);
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(del).toBeDefined();
    expect(new Headers(del![1]!.headers).get("mcp-session-id")).toBe("s1");
  });

  it("does not throw when the server refuses session termination, and does nothing when never connected", async () => {
    const client = createMCPClient(SERVER);
    await client.getServerInfo();
    const base = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 405 }) : base(url as string, init),
    );
    await expect(client.close()).resolves.toBeUndefined();
    const idle = createMCPClient(SERVER);
    await expect(idle.close()).resolves.toBeUndefined();
  });
});

// MCP Python SDK 1.30 은 30 분 유휴 세션을 닫고, 옛 Mcp-Session-Id 요청에 404 를 돌려준다 (MCP 명세: 새 세션을 시작해야 한다).
describe("MCPClient idle session expiry", () => {
  const sessionIds: string[] = [];

  // 유효한 세션 id 를 정해 두고, 그 밖의 id 로 오는 initialize 이외 요청은 404 로 막는 서버.
  function stubSessionServer(state: { live: string; counter: number; broken?: boolean }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "GET") return new Response(null, { status: 405 });
        if (init?.method === "DELETE") return new Response(null, { status: 200 });
        const rpc = JSON.parse(String(init?.body)) as Rpc;
        calls.push(rpc);
        const sent = new Headers(init?.headers).get("mcp-session-id") ?? "";
        sessionIds.push(`${rpc.method}:${sent}`);
        if (rpc.method === "initialize") {
          state.counter += 1;
          state.live = state.broken ? "never-matches" : `s${state.counter}`;
          return json(
            { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } },
            { "mcp-session-id": `s${state.counter}` },
          );
        }
        if (sent !== state.live) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "server-error", error: { code: -32600, message: "Session not found" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        if (rpc.method === "tools/call") return okResult(rpc);
        if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
        return new Response(null, { status: 202 });
      }),
    );
  }

  beforeEach(() => {
    sessionIds.length = 0;
  });

  it("re-initializes once and retries tools/call after a 404 for the old session", async () => {
    const state = { live: "", counter: 0 };
    stubSessionServer(state);
    const messages: string[] = [];
    const client = createMCPClient(SERVER, {
      onMessage: (e) => {
        const m = e.message as { method?: string };
        if (e.dir === "out" && m.method) messages.push(m.method);
      },
    });
    expect((await client.callTool("echo", {})).isError).toBe(false);
    state.live = "expired"; // 서버가 세션을 닫은 상태를 흉내 낸다
    const result = await client.callTool("echo", {});
    expect(result.isError).toBe(false);
    expect(result.detail?.outcome).toBe("ok");
    expect(state.counter).toBe(2);
    // 두 번째 initialize 가 Inspector 로그(onMessage)에도 보인다
    expect(messages.filter((m) => m === "initialize")).toHaveLength(2);
    // 재시도는 새 세션 id 로 간다
    expect(sessionIds.filter((s) => s.startsWith("tools/call:")).slice(-1)[0]).toBe("tools/call:s2");
    await client.close();
  });

  it("recovers listTools and ping the same way", async () => {
    const state = { live: "", counter: 0 };
    stubSessionServer(state);
    const client = createMCPClient(SERVER);
    expect(await client.listTools()).toHaveLength(1);
    state.live = "expired";
    expect(await client.listTools()).toHaveLength(1);
    state.live = "expired-again";
    const ping = await client.ping();
    expect(ping).toMatchObject({ ok: true, toolCount: 1 });
    expect(state.counter).toBe(3);
    await client.close();
  });

  it("does not loop when the retry also gets a 404", async () => {
    const state = { live: "", counter: 0, broken: false };
    stubSessionServer(state);
    const client = createMCPClient(SERVER);
    await client.listTools();
    state.broken = true; // 새 initialize 로도 맞는 세션을 받지 못하는 서버
    state.live = "expired";
    await expect(client.listTools()).rejects.toMatchObject({ code: 404 });
    expect(state.counter).toBe(2);
    await client.close();
  });
});
