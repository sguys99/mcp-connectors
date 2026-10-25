// @vitest-environment node
// 런타임 서버 프록시 단위 테스트. 기본 꺼짐, 스킴 거부, 헤더 전달, 서버 키 비누출, 한도를 확인한다. 값은 모두 가짜(_test_fixture)다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_HEADERS_HEADER,
  RUNTIME_TARGET_HEADER,
  encodeRuntimeHeaders,
} from "@/lib/runtime/guards";

import { DELETE, GET, POST } from "./route";

const fetchMock = vi.fn();
const savedEnv = { ...process.env };

function req(init: { method?: string; target?: string | null; headers?: Record<string, string>; body?: string; extra?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...(init.extra ?? {}) };
  if (init.target !== null) headers[RUNTIME_TARGET_HEADER] = init.target ?? "http://localhost:9999/mcp";
  if (init.headers) headers[RUNTIME_HEADERS_HEADER] = encodeRuntimeHeaders(init.headers);
  return new Request("http://localhost:3000/api/mcp-runtime", {
    method: init.method ?? "POST",
    headers,
    body: init.body ?? (init.method === "GET" || init.method === "DELETE" ? undefined : "{}"),
  });
}

beforeEach(() => {
  process.env.MCP_API_KEY = "server_secret_test_fixture";
  delete process.env.MCP_ALLOW_RUNTIME_PROXY;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("runtime proxy gate", () => {
  it("is disabled by default: 403 for every method and no fetch", async () => {
    for (const handler of [GET, POST, DELETE]) {
      const res = await handler(req({ method: handler === GET ? "GET" : handler === DELETE ? "DELETE" : "POST" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toContain("MCP_ALLOW_RUNTIME_PROXY");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled for values that are not truthy", async () => {
    process.env.MCP_ALLOW_RUNTIME_PROXY = "false";
    expect((await POST(req())).status).toBe(403);
    process.env.MCP_ALLOW_RUNTIME_PROXY = "";
    expect((await POST(req())).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runtime proxy enabled", () => {
  beforeEach(() => {
    process.env.MCP_ALLOW_RUNTIME_PROXY = "true";
  });

  it("rejects non-http(s) schemes without fetching", async () => {
    for (const target of ["file:///etc/passwd", "ftp://example.com/mcp", "javascript:alert(1)", "gopher://x/", "ws://localhost:1/mcp"]) {
      const res = await POST(req({ target }));
      expect(res.status, target).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed and credentialed targets", async () => {
    expect((await POST(req({ target: null }))).status).toBe(400);
    expect((await POST(req({ target: "not a url" }))).status).toBe(400);
    expect((await POST(req({ target: "http://user:pw_test_fixture@localhost:9/mcp" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses link-local and cloud metadata targets with 403 without fetching (loopback stays allowed)", async () => {
    for (const target of ["http://169.254.169.254/latest/meta-data", "http://[fe80::1]:8001/mcp", "http://metadata.google.internal/mcp"]) {
      const res = await POST(req({ target }));
      expect(res.status, target).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser requests", async () => {
    const res = await POST(req({ extra: { origin: "https://evil.example.com" } }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only user-supplied headers and never attaches the server API key", async () => {
    const res = await POST(
      req({
        headers: { "X-Custom": "value_test_fixture" },
        extra: { cookie: "session=browser_cookie_test_fixture", authorization: "Bearer browser_test_fixture", "x-mcp-api-key": "browser_key_test_fixture", "mcp-session-id": "abc" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("s1");
    expect(res.headers.get("server-timing")).toContain("upstream;dur=");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:9999/mcp");
    const sent = init.headers as Headers;
    expect(sent.get("x-custom")).toBe("value_test_fixture");
    expect(sent.get("mcp-session-id")).toBe("abc");
    expect(sent.get("x-mcp-api-key")).toBeNull();
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get(RUNTIME_TARGET_HEADER)).toBeNull();
    expect(sent.get(RUNTIME_HEADERS_HEADER)).toBeNull();
    expect(JSON.stringify([...sent.entries()])).not.toContain("server_secret_test_fixture");
    expect(init.redirect).toBe("manual");
  });

  it("rejects reserved or malformed user headers", async () => {
    const bad: Record<string, string>[] = [{ Host: "evil" }, { "Content-Length": "1" }, { "bad name": "x" }, { "X-A": "line\r\nbreak" }];
    for (const headers of bad) {
      const res = await POST(req({ headers }));
      expect(res.status, JSON.stringify(headers)).toBe(400);
    }
    const garbage = new Request("http://localhost:3000/api/mcp-runtime", {
      method: "POST",
      body: "{}",
      headers: { host: "localhost:3000", [RUNTIME_TARGET_HEADER]: "http://localhost:9/mcp", [RUNTIME_HEADERS_HEADER]: "%%%not-base64" },
    });
    expect((await POST(garbage)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the target is unreachable and 504 on timeout", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("localhost:9999");

    process.env.MCP_RUNTIME_PROXY_TIMEOUT_MS = "20";
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const slow = await POST(req());
    expect(slow.status).toBe(504);
  });

  it("enforces the request and response size limits", async () => {
    process.env.MCP_RUNTIME_PROXY_MAX_BYTES = "10";
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(100), { status: 200, headers: { "content-type": "application/json", "content-length": "100" } }));
    const declared = await POST(req());
    expect(declared.status).toBe(502);

    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("y".repeat(50))); c.close(); } }), { status: 200, headers: { "content-type": "application/json" } }));
    const streamed = await POST(req());
    await expect(streamed.text()).rejects.toThrow();

    const big = await POST(req({ body: "z".repeat(2 * 1024 * 1024 + 1) }));
    expect(big.status).toBe(413);
  });
});
