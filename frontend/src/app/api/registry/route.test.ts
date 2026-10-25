// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("GET /api/registry", () => {
  it("serves only HTTP entries in browser-safe form", async () => {
    const dir = mkdtempSync(join(tmpdir(), "registry-route-"));
    const file = join(dir, "servers.yaml");
    writeFileSync(
      file,
      `servers:
  - { name: s, transport: stdio, command: ["python", "-m", "s"] }
  - name: h
    transport: streamable_http
    url: http://localhost:8001/mcp
    internalUrl: http://h:8001/mcp
    headers: { X-MCP-API-Key: "\${MCP_API_KEY}" }
`,
      "utf8",
    );
    process.env.MCP_REGISTRY_PATH = file;
    process.env.MCP_API_KEY = "top-secret";

    const res = await GET();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      // externalUrl 은 클라이언트 설정 복사용 (yaml 의 url). internalUrl, headers, 키는 나가지 않는다.
      servers: [{ name: "h", transport: "streamable_http", url: "/api/mcp/h", externalUrl: "http://localhost:8001/mcp" }],
      runtimeProxy: false,
    });
    expect(text).not.toContain("top-secret");
    expect(text).not.toContain("internalUrl");
    expect(text).not.toContain("h:8001");
  });

  it("reports whether the runtime proxy is enabled (default off)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "registry-route-"));
    const file = join(dir, "servers.yaml");
    writeFileSync(file, `servers:\n  - { name: h, transport: streamable_http, url: "http://localhost:1/mcp" }\n`, "utf8");
    process.env.MCP_REGISTRY_PATH = file;
    delete process.env.MCP_ALLOW_RUNTIME_PROXY;
    expect((await (await GET()).json()).runtimeProxy).toBe(false);
    process.env.MCP_ALLOW_RUNTIME_PROXY = "true";
    expect((await (await GET()).json()).runtimeProxy).toBe(true);
  });

  it("returns 500 with a message when the registry cannot be read", async () => {
    process.env.MCP_REGISTRY_PATH = "/nonexistent/servers.yaml";
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Cannot read");
  });
});
