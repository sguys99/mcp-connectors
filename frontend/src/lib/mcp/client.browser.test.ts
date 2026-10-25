// 브라우저 경로(window 있음)의 도구 outputSchema 검증. SDK 안의 ajv 는 빠져 있고, callTool 이 늦게 검증한다.
// happy-dom 환경이라 createMCPClient 는 브라우저로 동작한다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMCPClient } from "./client";

const SERVER = { name: "fake", transport: "streamable_http" as const, url: "http://test.local/mcp" };

const OUTPUT_SCHEMA = { type: "object", properties: { n: { type: "integer" } }, required: ["n"] };
let callResult: Record<string, unknown>;

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") return new Response(null, { status: 200 });
      const rpc = JSON.parse(String(init?.body)) as { id?: number; method: string };
      switch (rpc.method) {
        case "initialize":
          return json(
            { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } },
            { "mcp-session-id": "s1" },
          );
        case "tools/list":
          return json({
            jsonrpc: "2.0",
            id: rpc.id,
            result: { tools: [{ name: "count", inputSchema: { type: "object" }, outputSchema: OUTPUT_SCHEMA }] },
          });
        case "tools/call":
          return json({ jsonrpc: "2.0", id: rpc.id, result: callResult });
        default:
          return new Response(null, { status: 202 });
      }
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function call() {
  const client = createMCPClient(SERVER);
  await client.listTools();
  return client.callTool("count", {});
}

describe("browser callTool output validation", () => {
  it("passes matching structuredContent", async () => {
    callResult = { content: [{ type: "text", text: "{}" }], structuredContent: { n: 3 } };
    const r = await call();
    expect(r.detail?.outcome).toBe("ok");
  });

  it("flags structuredContent that does not match the outputSchema", async () => {
    callResult = { content: [{ type: "text", text: "{}" }], structuredContent: { n: "three" } };
    const r = await call();
    expect(r.isError).toBe(true);
    expect(r.detail?.outcome).toBe("rpc-error");
    expect(r.detail?.errorMessage).toContain("Structured content does not match the tool's output schema");
  });

  it("flags a declared outputSchema with no structuredContent", async () => {
    callResult = { content: [{ type: "text", text: "hi" }] };
    const r = await call();
    expect(r.detail?.outcome).toBe("rpc-error");
    expect(r.detail?.errorMessage).toContain("has an output schema but did not return structured content");
  });

  it("does not flag an isError result without structuredContent", async () => {
    callResult = { content: [{ type: "text", text: "boom" }], isError: true };
    const r = await call();
    expect(r.detail?.outcome).toBe("tool-error");
  });
});
