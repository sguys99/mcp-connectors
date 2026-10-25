// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConfigFile } from "@/lib/config/paths";

import {
  API_KEY_HEADER,
  getBrowserReachableServers,
  getPublicServers,
  loadRegistry,
  parseRegistry,
  registryPath,
  resolveUpstream,
  toPublicServer,
  type RegistryHttpEntry,
} from "./registry";

const SAMPLE = `
servers:
  - name: local-stdio
    transport: stdio
    command: ["uv", "run", "python", "-m", "x.server"]
    description: "stdio one"
    description_ko: "stdio 하나"
  - name: http-one
    transport: streamable_http
    url: http://localhost:8001/mcp
    internalUrl: http://http-one:8001/mcp
    description: "http one"
    description_ko: "http 하나"
    secretish: "should be dropped"
  - name: http-headers
    transport: streamable_http
    url: http://localhost:8009/mcp
    headers:
      Authorization: "Bearer \${TEST_TOKEN}"
      X-Empty: "\${UNSET_VAR}"
`;

function writeRegistry(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
  const file = join(dir, "servers.yaml");
  writeFileSync(file, text, "utf8");
  return file;
}

describe("parseRegistry", () => {
  it("parses stdio and http entries and drops unknown keys", () => {
    const entries = parseRegistry(SAMPLE);
    expect(entries.map((e) => e.name)).toEqual(["local-stdio", "http-one", "http-headers"]);
    expect(entries[1]).not.toHaveProperty("secretish");
  });

  it("rejects malformed registries with a readable message", () => {
    expect(() => parseRegistry("servers: []")).toThrow(/Malformed/);
    expect(() => parseRegistry("servers:\n  - name: a\n    transport: streamable_http\n")).toThrow(
      /url/,
    );
    expect(() => parseRegistry("::: not yaml :::\n\t- [")).toThrow(/registry/);
  });

  it("rejects duplicate names", () => {
    const text = `servers:
  - { name: a, transport: streamable_http, url: "http://localhost:1/mcp" }
  - { name: a, transport: streamable_http, url: "http://localhost:2/mcp" }
`;
    expect(() => parseRegistry(text)).toThrow(/Duplicate server name 'a'/);
  });
});

describe("toPublicServer", () => {
  it("maps http entries to the proxy path without internalUrl or headers", () => {
    const [, http, withHeaders] = parseRegistry(SAMPLE);
    expect(toPublicServer(http!)).toEqual({
      name: "http-one",
      transport: "streamable_http",
      url: "/api/mcp/http-one",
      externalUrl: "http://localhost:8001/mcp",
      description: "http one",
      descriptionKo: "http 하나",
    });
    const pub = toPublicServer(withHeaders!);
    expect(pub).not.toHaveProperty("headers");
    expect(JSON.stringify(pub)).not.toContain("TEST_TOKEN");
  });

  it("omits descriptionKo when description_ko is absent (backwards compatible)", () => {
    const [only] = parseRegistry(
      `servers:
  - { name: a, transport: streamable_http, url: "http://localhost:1/mcp", description: "only en" }
`,
    );
    expect(toPublicServer(only!)).toEqual({
      name: "a",
      transport: "streamable_http",
      url: "/api/mcp/a",
      externalUrl: "http://localhost:1/mcp",
      description: "only en",
    });
  });

  it("keeps the command of stdio entries for the client config copy", () => {
    const [stdio] = parseRegistry(SAMPLE);
    expect(toPublicServer(stdio!)).toEqual({
      name: "local-stdio",
      transport: "stdio",
      command: ["uv", "run", "python", "-m", "x.server"],
      description: "stdio one",
      descriptionKo: "stdio 하나",
    });
  });
});

describe("loadRegistry / getters (MCP_REGISTRY_PATH)", () => {
  it("reads the file named by MCP_REGISTRY_PATH", async () => {
    const env = { MCP_REGISTRY_PATH: writeRegistry(SAMPLE) };
    expect(registryPath(env)).toBe(env.MCP_REGISTRY_PATH);
    expect((await loadRegistry(env)).length).toBe(3);
    expect((await getPublicServers(env)).length).toBe(3);
    const reachable = await getBrowserReachableServers(env);
    expect(reachable.map((s) => s.name)).toEqual(["http-one", "http-headers"]);
    expect(reachable.every((s) => s.url.startsWith("/api/mcp/"))).toBe(true);
  });

  it("explains a missing file", async () => {
    await expect(loadRegistry({ MCP_REGISTRY_PATH: "/nonexistent/x.yaml" })).rejects.toThrow(
      /Cannot read .*MCP_REGISTRY_PATH/,
    );
  });

  it("finds the repo configs/mcp_servers.yaml by default (cwd = frontend/)", async () => {
    const servers = await loadRegistry({});
    expect(servers.some((s) => s.name === "starter-mcp-http")).toBe(true);
    for (const s of servers) {
      if (s.transport === "streamable_http") expect(s.internalUrl).toMatch(/^http:\/\//);
    }
  });
});

describe("resolveConfigFile", () => {
  it("prefers <cwd>/configs over <cwd>/../configs", () => {
    const root = mkdtempSync(join(tmpdir(), "paths-test-"));
    const app = join(root, "app");
    mkdirSync(join(app, "configs"), { recursive: true });
    mkdirSync(join(root, "configs"), { recursive: true });
    writeFileSync(join(app, "configs", "a.yaml"), "x");
    writeFileSync(join(root, "configs", "a.yaml"), "x");
    expect(resolveConfigFile(undefined, "a.yaml", app)).toBe(join(app, "configs", "a.yaml"));
  });

  it("falls back to <cwd>/../configs and honours the env override", () => {
    const root = mkdtempSync(join(tmpdir(), "paths-test-"));
    const app = join(root, "frontend");
    mkdirSync(app);
    mkdirSync(join(root, "configs"));
    writeFileSync(join(root, "configs", "a.yaml"), "x");
    expect(resolveConfigFile(undefined, "a.yaml", app)).toBe(join(app, "..", "configs", "a.yaml"));
    expect(resolveConfigFile("custom/b.yaml", "a.yaml", app)).toBe(join(app, "custom", "b.yaml"));
  });
});

describe("resolveUpstream", () => {
  const entries = parseRegistry(SAMPLE);
  const httpOne = entries[1] as RegistryHttpEntry;
  const withHeaders = entries[2] as RegistryHttpEntry;

  it("uses url by default and internalUrl when MCP_USE_INTERNAL_URL is set", () => {
    expect(resolveUpstream(httpOne, {}).url).toBe("http://localhost:8001/mcp");
    expect(resolveUpstream(httpOne, { MCP_USE_INTERNAL_URL: "true" }).url).toBe(
      "http://http-one:8001/mcp",
    );
    // internalUrl 이 없으면 url 로 대체
    expect(resolveUpstream(withHeaders, { MCP_USE_INTERNAL_URL: "1" }).url).toBe(
      "http://localhost:8009/mcp",
    );
  });

  it("attaches MCP_API_KEY when the entry has no key header", () => {
    expect(resolveUpstream(httpOne, { MCP_API_KEY: "k-123" }).headers).toEqual({
      [API_KEY_HEADER]: "k-123",
    });
    expect(resolveUpstream(httpOne, {}).headers).toEqual({});
  });

  it("expands ${VAR} in registry headers and drops empty values", () => {
    const { headers } = resolveUpstream(withHeaders, { TEST_TOKEN: "abc", MCP_API_KEY: "k" });
    expect(headers).toEqual({ Authorization: "Bearer abc", [API_KEY_HEADER]: "k" });
  });

  it("lets an explicit X-MCP-API-Key header win over MCP_API_KEY", () => {
    const [entry] = parseRegistry(`servers:
  - name: a
    transport: streamable_http
    url: http://localhost:1/mcp
    headers:
      x-mcp-api-key: "\${OTHER_KEY}"
`) as RegistryHttpEntry[];
    expect(resolveUpstream(entry!, { OTHER_KEY: "o", MCP_API_KEY: "m" }).headers).toEqual({
      "x-mcp-api-key": "o",
    });
  });
});
