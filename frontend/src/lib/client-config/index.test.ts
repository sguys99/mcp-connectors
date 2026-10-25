import { describe, expect, it } from "vitest";

import { CLIENT_IDS, buildClientConfig, fromRegistryServer, fromRuntime, shellQuote, stripUrlSecrets, type ConfigServer } from "./index";

const http = fromRegistryServer({ name: "starter-mcp-http", transport: "streamable_http", externalUrl: "http://localhost:8001/mcp" }, true)!;
const httpNoKey = fromRegistryServer({ name: "starter-mcp-http", transport: "streamable_http", externalUrl: "http://localhost:8001/mcp" }, false)!;
const stdio = fromRegistryServer({ name: "starter-mcp", transport: "stdio", command: ["uv", "run", "python", "-m", "starter_mcp.server"] }, true)!;
const runtime = fromRuntime({
  name: "ext-one",
  url: "https://api.example.com/mcp",
  headers: [
    { name: "Authorization", value: "Bearer real_token_test_fixture" },
    { name: "X-Api-Key", value: "real_key_test_fixture" },
    { name: " ", value: "ignored" },
  ],
});

const CASES: [string, ConfigServer][] = [
  ["registry http with key", http],
  ["registry http without key", httpNoKey],
  ["registry stdio", stdio],
  ["runtime https", runtime],
];

describe("client config snapshots", () => {
  for (const [label, server] of CASES) {
    for (const client of CLIENT_IDS) {
      it(`${client} / ${label}`, () => {
        const out = buildClientConfig(client, server);
        expect(out.blocks.map((b) => `# ${b.id}\n${b.text}`).join("\n\n")).toMatchSnapshot();
      });
    }
  }
});

describe("client config safety and shape", () => {
  it("replaces query-string secrets and userinfo passwords in runtime urls with placeholders", () => {
    expect(stripUrlSecrets("https://api.example.com/mcp?api_key=real_q_test_fixture&region=eu#x")).toBe(
      "https://api.example.com/mcp?api_key=YOUR_API_KEY&region=eu#x",
    );
    expect(stripUrlSecrets("https://bob:pw_test_fixture@api.example.com/mcp?token=t1&sig=s1")).toBe(
      "https://bob:YOUR_PASSWORD@api.example.com/mcp?token=YOUR_TOKEN&sig=YOUR_SIG",
    );
    expect(stripUrlSecrets("http://localhost:8001/mcp")).toBe("http://localhost:8001/mcp");
    const server = fromRuntime({ name: "q", url: "https://api.example.com/mcp?access_token=real_q_test_fixture", headers: [] });
    for (const client of CLIENT_IDS) {
      const text = buildClientConfig(client, server).blocks.map((b) => b.text).join("\n");
      expect(text).not.toContain("real_q_test_fixture");
      expect(text).toContain("access_token=YOUR_ACCESS_TOKEN");
    }
  });

  it("never contains runtime secret values, only references", () => {
    for (const client of CLIENT_IDS) {
      const text = buildClientConfig(client, runtime).blocks.map((b) => b.text).join("\n");
      expect(text).not.toContain("real_token_test_fixture");
      expect(text).not.toContain("real_key_test_fixture");
      expect(text.toLowerCase().replace(/-/g, "_")).toContain("authorization_token");
    }
  });

  it("every JSON block parses", () => {
    for (const [, server] of CASES) {
      for (const client of CLIENT_IDS) {
        for (const block of buildClientConfig(client, server).blocks) {
          if (block.format === "json") expect(() => JSON.parse(block.text)).not.toThrow();
        }
      }
    }
  });

  it("uses the documented top-level keys per client", () => {
    const top = (client: Parameters<typeof buildClientConfig>[0]) => Object.keys(JSON.parse(buildClientConfig(client, http).blocks.find((b) => b.format === "json")!.text));
    expect(top("claude-desktop")).toEqual(["mcpServers"]);
    expect(top("cursor")).toEqual(["mcpServers"]);
    expect(top("claude-code")).toEqual(["mcpServers"]);
    expect(top("vscode")).toEqual(["inputs", "servers"]);
  });

  it("Claude Desktop bridges http with mcp-remote and allows plain http only when needed", () => {
    const local = JSON.parse(buildClientConfig("claude-desktop", http).blocks[0]!.text).mcpServers["starter-mcp-http"];
    expect(local.command).toBe("npx");
    expect(local.args).toEqual(["-y", "mcp-remote", "http://localhost:8001/mcp", "--allow-http", "--header", "X-MCP-API-Key:${MCP_API_KEY}"]);
    expect(local.env).toEqual({ MCP_API_KEY: "<your MCP_API_KEY>" });
    const remote = JSON.parse(buildClientConfig("claude-desktop", runtime).blocks[0]!.text).mcpServers["ext-one"];
    expect(remote.args).not.toContain("--allow-http");
  });

  it("Claude Code CLI keeps env references unexpanded by the shell", () => {
    const cli = buildClientConfig("claude-code", http).blocks[0]!.text;
    expect(cli).toBe("claude mcp add --transport http starter-mcp-http http://localhost:8001/mcp --header 'X-MCP-API-Key: ${MCP_API_KEY}'");
    expect(buildClientConfig("claude-code", httpNoKey).blocks[0]!.text).toBe("claude mcp add --transport http starter-mcp-http http://localhost:8001/mcp");
  });

  it("stdio uses uv --directory with a repo path placeholder", () => {
    const out = buildClientConfig("cursor", stdio);
    expect(out.needs.repoPath).toBe(true);
    expect(JSON.parse(out.blocks[0]!.text).mcpServers["starter-mcp"]).toEqual({
      type: "stdio",
      command: "uv",
      args: ["--directory", "/absolute/path/to/mcp-connectors/src/mcp-servers", "run", "python", "-m", "starter_mcp.server"],
    });
  });

  it("returns null when the registry entry lacks what the config needs", () => {
    expect(fromRegistryServer({ name: "a", transport: "streamable_http" }, true)).toBeNull();
    expect(fromRegistryServer({ name: "a", transport: "stdio" }, true)).toBeNull();
  });

  it("quotes shell words only when needed", () => {
    expect(shellQuote("abc-1")).toBe("abc-1");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("")).toBe("''");
  });
});
