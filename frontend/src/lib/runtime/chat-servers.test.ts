import { describe, expect, it } from "vitest";

import { parseChatRuntimeServers } from "./chat-servers";

const ON = { MCP_ALLOW_RUNTIME_PROXY: "true" };
const base = { registryNames: ["starter-mcp-http"] };

describe("parseChatRuntimeServers", () => {
  it("accepts nothing without touching the gate", () => {
    expect(parseChatRuntimeServers(undefined, { ...base, env: {} })).toEqual({ ok: true, servers: new Map() });
    expect(parseChatRuntimeServers([], { ...base, env: {} })).toEqual({ ok: true, servers: new Map() });
  });

  it("is forbidden unless the runtime proxy is enabled", () => {
    const r = parseChatRuntimeServers([{ name: "ext", url: "http://localhost:1/mcp" }], { ...base, env: {} });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("validates url, headers and names when enabled", () => {
    const ok = parseChatRuntimeServers([{ name: "ext", url: "http://localhost:1/mcp", headers: { "X-K": "v_test_fixture" } }], { ...base, env: ON });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.servers.get("ext")).toEqual({ name: "ext", url: "http://localhost:1/mcp", headers: { "X-K": "v_test_fixture" } });
    expect(parseChatRuntimeServers([{ name: "ext", url: "file:///etc/passwd" }], { ...base, env: ON })).toMatchObject({ ok: false, status: 400 });
    expect(parseChatRuntimeServers([{ name: "ext", url: "http://x/mcp", headers: { Host: "evil" } }], { ...base, env: ON })).toMatchObject({ ok: false, status: 400 });
    expect(parseChatRuntimeServers([{ name: "starter-mcp-http", url: "http://x/mcp" }], { ...base, env: ON })).toMatchObject({ ok: false, status: 400 });
    expect(
      parseChatRuntimeServers([{ name: "a", url: "http://x/mcp" }, { name: "a", url: "http://y/mcp" }], { ...base, env: ON }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects link-local and cloud metadata targets with 403 even when the proxy is enabled", () => {
    for (const url of ["http://169.254.169.254/mcp", "http://metadata.google.internal/mcp", "http://[fe80::1]/mcp"]) {
      const r = parseChatRuntimeServers([{ name: "ext", url }], { ...base, env: ON });
      expect(r).toMatchObject({ ok: false, status: 403 });
    }
    expect(parseChatRuntimeServers([{ name: "ext", url: "http://127.0.0.1:9/mcp" }], { ...base, env: ON }).ok).toBe(true);
  });
});
