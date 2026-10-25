// @vitest-environment node
// MCP 프록시 Route Handler 단위 테스트. upstream fetch 는 vi.stubGlobal 로 대체한다.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "./route";

const REGISTRY = `
servers:
  - name: stdio-one
    transport: stdio
    command: ["python", "-m", "x"]
  - name: http-one
    transport: streamable_http
    url: http://localhost:8001/mcp
    internalUrl: http://http-one:8001/mcp
`;

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

function ctx(server: string) {
  return { params: Promise.resolve({ server }) };
}

function rpcRequest(method: string, init: RequestInit = {}): Request {
  return new Request("http://localhost:3000/api/mcp/http-one", {
    method,
    ...init,
    headers: { host: "localhost:3000", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-test-"));
  const file = join(dir, "servers.yaml");
  writeFileSync(file, REGISTRY, "utf8");
  process.env.MCP_REGISTRY_PATH = file;
  process.env.MCP_API_KEY = "server-secret";
  delete process.env.MCP_USE_INTERNAL_URL;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("MCP proxy — allow list", () => {
  it("returns 404 for servers not in the registry (no open proxy)", async () => {
    const res = await POST(rpcRequest("POST", { body: "{}" }), ctx("evil.example.com"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toContain("Unknown MCP server");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for stdio servers", async () => {
    const res = await POST(rpcRequest("POST", { body: "{}" }), ctx("stdio-one"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser requests", async () => {
    const res = await POST(
      rpcRequest("POST", { body: "{}", headers: { origin: "http://attacker.test" } }),
      ctx("http-one"),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MCP proxy — forwarding", () => {
  it("attaches X-MCP-API-Key server-side and forwards session headers", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
      }),
    );

    const res = await POST(
      rpcRequest("POST", {
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-session-id": "sess-1",
          "mcp-protocol-version": "2025-06-18",
          // 브라우저가 보낸 키와 쿠키는 버려야 한다
          "x-mcp-api-key": "browser-supplied",
          cookie: "a=b",
        },
      }),
      ctx("http-one"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("sess-1");
    expect(await res.text()).toContain('"result"');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8001/mcp");
    const sent = init.headers as Headers;
    expect(sent.get("x-mcp-api-key")).toBe("server-secret");
    expect(sent.get("mcp-session-id")).toBe("sess-1");
    expect(sent.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(sent.get("cookie")).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toContain("tools/list");
  });

  it("uses internalUrl when MCP_USE_INTERNAL_URL is set", async () => {
    process.env.MCP_USE_INTERNAL_URL = "true";
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const res = await POST(rpcRequest("POST", { body: "{}" }), ctx("http-one"));
    expect(res.status).toBe(202);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://http-one:8001/mcp");
  });

  it("does not send a key header when MCP_API_KEY is unset", async () => {
    delete process.env.MCP_API_KEY;
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await POST(rpcRequest("POST", { body: "{}" }), ctx("http-one"));
    expect((fetchMock.mock.calls[0]![1].headers as Headers).has("x-mcp-api-key")).toBe(false);
  });

  it("streams SSE bodies through for GET and disables buffering", async () => {
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("event: message\ndata: {}\n\n"));
        c.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const res = await GET(
      rpcRequest("GET", { headers: { accept: "text/event-stream", "mcp-session-id": "s" } }),
      ctx("http-one"),
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await res.text()).toContain("data: {}");
    expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined();
  });

  it("forwards DELETE (session termination) and upstream error statuses", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const res = await DELETE(rpcRequest("DELETE", { headers: { "mcp-session-id": "s" } }), ctx("http-one"));
    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("returns 502 when the upstream is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await POST(rpcRequest("POST", { body: "{}" }), ctx("http-one"));
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("unreachable");
  });
});

describe("MCP proxy — Server-Timing", () => {
  const encoder = new TextEncoder();

  function metric(header: string | null, name: string): { dur: number; desc?: string } | null {
    const entry = (header ?? "").split(",").map((s) => s.trim()).find((s) => s.startsWith(`${name};`));
    if (!entry) return null;
    const dur = /dur=([\d.]+)/.exec(entry)?.[1];
    const desc = /desc="([^"]*)"/.exec(entry)?.[1];
    return { dur: Number(dur), desc };
  }

  it("adds proxy, upstream and headers metrics to a JSON response", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await POST(rpcRequest("POST", { body: '{"id":1}' }), ctx("http-one"));
    const header = res.headers.get("server-timing");
    expect(header).toMatch(/^proxy;dur=\d+\.\d, upstream;dur=\d+\.\d;desc="headers", headers;dur=\d+\.\d$/);
    expect(await res.text()).toContain('"result"');
  });

  it("measures the upstream wait until the first body byte for a POST SSE response", async () => {
    // 헤더는 바로 오고 첫 청크는 80ms 뒤에 온다 (FastMCP 가 도구 실행 중인 상황).
    let sent = 0;
    const upstreamBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === 0) {
          await new Promise((r) => setTimeout(r, 80));
          controller.enqueue(encoder.encode("event: message\n"));
        } else if (sent === 1) {
          controller.enqueue(encoder.encode('data: {"id":2}\n\n'));
        } else {
          controller.close();
        }
        sent += 1;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const res = await POST(rpcRequest("POST", { body: '{"id":2}' }), ctx("http-one"));
    const header = res.headers.get("server-timing");
    const upstream = metric(header, "upstream");
    expect(upstream?.desc).toBe("first-byte");
    expect(upstream!.dur).toBeGreaterThanOrEqual(70);
    expect(metric(header, "headers")!.dur).toBeLessThan(upstream!.dur);
    expect(metric(header, "proxy")!.dur).toBeLessThan(upstream!.dur);
    // 읽어 둔 첫 청크가 본문 맨 앞에 그대로 남아 있어야 한다.
    expect(await res.text()).toBe('event: message\ndata: {"id":2}\n\n');
  });

  it("keeps streaming: later chunks are passed through as they arrive", async () => {
    let resolveSecond: (() => void) | undefined;
    const gate = new Promise<void>((r) => (resolveSecond = r));
    let step = 0;
    const upstreamBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (step === 0) controller.enqueue(encoder.encode("one\n"));
        else if (step === 1) {
          await gate;
          controller.enqueue(encoder.encode("two\n"));
        } else controller.close();
        step += 1;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const res = await POST(rpcRequest("POST", { body: "{}" }), ctx("http-one"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe("one\n");
    // 두 번째 청크는 upstream 이 내보낼 때까지 도착하지 않는다.
    const pending = reader.read();
    const raced = await Promise.race([pending.then(() => "arrived"), new Promise((r) => setTimeout(() => r("waiting"), 30))]);
    expect(raced).toBe("waiting");
    resolveSecond!();
    expect(decoder.decode((await pending).value)).toBe("two\n");
  });

  it("does not wait for a first byte on GET streams", async () => {
    // 서버 알림용 GET 스트림은 한참 조용할 수 있다. 헤더만으로 바로 응답해야 한다.
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    fetchMock.mockResolvedValue(
      new Response(silent, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const res = await Promise.race([
      GET(rpcRequest("GET", { headers: { accept: "text/event-stream" } }), ctx("http-one")),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ]);
    expect(res).not.toBeNull();
    expect(metric(res!.headers.get("server-timing"), "upstream")?.desc).toBe("headers");
    await res!.body!.cancel();
  });

  it("handles an empty 202 notification response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const res = await POST(rpcRequest("POST", { body: '{"method":"notifications/cancelled"}' }), ctx("http-one"));
    expect(res.status).toBe(202);
    expect(res.headers.get("server-timing")).toContain("upstream;dur=");
  });
});
