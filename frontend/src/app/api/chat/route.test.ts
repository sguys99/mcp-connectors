// Phase 5-3 Route Handler 통합 테스트.
// 외부 의존(MCP server / LLM SDK)을 vi.mock 으로 격리. 실제 LLM API 호출 금지.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MCPClient } from "@/lib/mcp/client";
import type { ToolMeta } from "@/lib/mcp/types";
import type { WireEvent } from "@/lib/chat/events";
import type { ChatTurnInput, LLMAdapter, LLMEvent } from "@/lib/llm/adapter";

// ---------- 모킹 ---------- //

const mcpMocks = vi.hoisted(() => {
  return {
    listTools: vi.fn(),
    callTool: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    createMCPClient: vi.fn(),
  };
});

vi.mock("@/lib/mcp/client", () => ({
  createMCPClient: mcpMocks.createMCPClient,
}));

const adapterMocks = vi.hoisted(() => {
  return {
    anthropic: vi.fn(),
    openai: vi.fn(),
    openrouter: vi.fn(),
  };
});

vi.mock("@/lib/llm/anthropic", () => ({
  createAnthropicAdapter: adapterMocks.anthropic,
}));
vi.mock("@/lib/llm/openai", () => ({
  createOpenAIAdapter: adapterMocks.openai,
}));
vi.mock("@/lib/llm/openrouter", () => ({
  createOpenRouterAdapter: adapterMocks.openrouter,
}));

// ---------- helpers ---------- //

const SAMPLE_TOOLS: ToolMeta[] = [
  { name: "list_repositories", description: "list", inputSchema: { type: "object" } },
];

const unused = () => Promise.reject(new Error("not used in chat tests"));

function buildMCPClient(overrides: Partial<MCPClient> = {}): MCPClient {
  return {
    listTools: mcpMocks.listTools,
    callTool: mcpMocks.callTool,
    // Chat 은 도구만 쓴다. 나머지 프리미티브 메서드는 쓰이면 바로 드러나도록 던진다.
    getServerInfo: unused,
    listResources: unused,
    listResourceTemplates: unused,
    readResource: unused,
    listPrompts: unused,
    getPrompt: unused,
    ping: mcpMocks.ping,
    close: mcpMocks.close,
    ...overrides,
  };
}

function buildAdapter(events: LLMEvent[]): LLMAdapter {
  return {
    async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
      for (const e of events) {
        // tool_use 이벤트 직전엔 onToolCall 을 한 번 호출해 실제 MCP 브릿지를 시증.
        if (e.type === "tool_use") {
          yield e;
          const result = await input.onToolCall(e.name, e.input);
          yield {
            type: "tool_result",
            toolUseId: e.id,
            content: result.content,
            isError: result.isError,
          };
        } else {
          yield e;
        }
      }
    },
  };
}

async function collectEvents(response: Response): Promise<WireEvent[]> {
  expect(response.body).not.toBeNull();
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: WireEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      events.push(JSON.parse(line.slice(5).trim()));
    }
  }
  return events;
}

function buildPostRequest(body: unknown): Request {
  return new Request("http://test.local/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------- import after mocks ---------- //

const { POST } = await import("./route");
const { checkChatRequestOrigin } = await import("@/lib/chat/request-guard");

// ---------- tests ---------- //

beforeEach(() => {
  mcpMocks.listTools.mockReset();
  mcpMocks.callTool.mockReset();
  mcpMocks.ping.mockReset();
  mcpMocks.close.mockReset().mockResolvedValue(undefined);
  mcpMocks.createMCPClient.mockReset();
  adapterMocks.anthropic.mockReset();
  adapterMocks.openai.mockReset();
  adapterMocks.openrouter.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat: 출처와 형식 검사", () => {
  const body = JSON.stringify({ provider: "anthropic", apiKey: "sk-test", serverName: "mock-repo-mcp", messages: [{ role: "user", content: "hi" }] });
  const post = (headers: Record<string, string>) =>
    POST(new Request("http://test.local/api/chat", { method: "POST", headers: { host: "test.local", ...headers }, body }));

  // undici 의 Request 는 Origin, Sec-Fetch-* 같은 금지 헤더를 지우므로 헤더만 가진 요청 모양으로 검사한다.
  const fake = (headers: Record<string, string>) => ({ headers: new Headers({ host: "test.local", ...headers }) }) as unknown as Request;

  it("다른 출처의 Origin 은 403", () => {
    expect(checkChatRequestOrigin(fake({ "content-type": "application/json", origin: "https://evil.example" }))?.status).toBe(403);
  });

  it("Sec-Fetch-Site: cross-site 는 Origin 이 없어도 403", () => {
    expect(checkChatRequestOrigin(fake({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });

  it("같은 출처의 JSON 요청은 통과", () => {
    expect(checkChatRequestOrigin(fake({ "content-type": "application/json", origin: "http://test.local", "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("text/plain 단순 요청은 415", async () => {
    const res = await post({ "Content-Type": "text/plain", Origin: "http://test.local" });
    expect(res.status).toBe(415);
    expect(mcpMocks.createMCPClient).not.toHaveBeenCalled();
  });

  it("Content-Type 이 없으면 415", async () => {
    const res = await POST(new Request("http://test.local/api/chat", { method: "POST", body: new Blob([body]) }));
    expect(res.status).toBe(415);
  });

  it("같은 출처의 JSON 요청은 다음 단계(본문 검증)로 넘어간다", async () => {
    const res = await post({ "Content-Type": "application/json; charset=utf-8", Origin: "http://test.local", "Sec-Fetch-Site": "same-origin" });
    expect([403, 415]).not.toContain(res.status);
  });
});

describe("POST /api/chat — validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(
      new Request("http://test.local/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 400 when messages array is empty", async () => {
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
  });

  it("returns 400 when provider is unknown", async () => {
    const res = await POST(
      buildPostRequest({
        provider: "foo",
        apiKey: "sk-test",
        model: "x",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat — server lookup", () => {
  it("returns 400 for unknown server", async () => {
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "does-not-exist",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unknown server 'does-not-exist'");
  });

  it("returns 400 with explicit message for stdio servers", async () => {
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "starter-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("streamable_http");
    expect(json.error).toContain("starter-mcp");
    expect(json.error).toContain("stdio");
  });
});

describe("POST /api/chat — happy path", () => {
  it("streams SSE events for an end_turn-only conversation", async () => {
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.anthropic.mockImplementation(() =>
      buildAdapter([
        { type: "iteration", index: 0 },
        { type: "text_delta", text: "Hi" },
        { type: "text_delta", text: " there" },
        { type: "done", stopReason: "end_turn" },
      ]),
    );

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const events = await collectEvents(res);
    expect(events.map((e) => e.type)).toEqual([
      "run_start",
      "iteration",
      "text_delta",
      "text_delta",
      "done",
    ]);
    expect(mcpMocks.close).toHaveBeenCalledTimes(1);
  });

  it("dispatches onToolCall through MCP client during tool-use loop", async () => {
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.callTool.mockResolvedValue({
      content: { repositories: [{ name: "repo-alpha" }] },
      isError: false,
      durationMs: 12,
    });
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.openai.mockImplementation(() =>
      buildAdapter([
        { type: "iteration", index: 0 },
        {
          type: "tool_use",
          id: "tu-1",
          name: "list_repositories",
          input: {},
        },
        // adapter wrapper 가 tool_result 를 자동 emit 함.
        { type: "iteration", index: 1 },
        { type: "text_delta", text: "Found 1 repo" },
        { type: "done", stopReason: "end_turn" },
      ]),
    );

    const res = await POST(
      buildPostRequest({
        provider: "openai",
        apiKey: "sk-test",
        model: "gpt-4o",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "list repos" }],
      }),
    );

    const events = await collectEvents(res);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "run_start",
      "iteration",
      "tool_use",
      "tool_result",
      "iteration",
      "text_delta",
      "done",
    ]);
    expect(mcpMocks.callTool).toHaveBeenCalledWith("list_repositories", {}, { signal: expect.any(AbortSignal) });

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === "tool_result") {
      // 객체 응답은 JSON.stringify 됨.
      expect(toolResult.content).toContain("repo-alpha");
      expect(toolResult.isError).toBe(false);
    }
  });
});

describe("POST /api/chat — failure modes", () => {
  it("returns 502 when listTools throws (and closes MCP client)", async () => {
    mcpMocks.listTools.mockRejectedValue(new Error("ECONNREFUSED"));
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("ECONNREFUSED");
    expect(mcpMocks.close).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/chat — server-side keys and upstream", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to the server env LLM key when apiKey is omitted", async () => {
    process.env.CHAT_ALLOW_SERVER_KEYS = "true";
    process.env.ANTHROPIC_API_KEY = "sk-env";
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.anthropic.mockImplementation(() =>
      buildAdapter([{ type: "done", stopReason: "end_turn" }]),
    );

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(200);
    await collectEvents(res);
    expect(adapterMocks.anthropic).toHaveBeenCalledWith("sk-env", "claude-sonnet-4-6");
  });

  it("ignores the server env LLM key unless CHAT_ALLOW_SERVER_KEYS is true", async () => {
    delete process.env.CHAT_ALLOW_SERVER_KEYS;
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(adapterMocks.anthropic).not.toHaveBeenCalled();
  });

  it("returns 400 when neither the body nor the server env has a key", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(
      buildPostRequest({
        provider: "openai",
        model: "gpt-4o",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("apiKey is required");
    expect(mcpMocks.createMCPClient).not.toHaveBeenCalled();
  });

  it("connects to internalUrl with the MCP API key when running in Docker", async () => {
    process.env.MCP_USE_INTERNAL_URL = "true";
    process.env.MCP_API_KEY = "mcp-secret";
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.anthropic.mockImplementation(() =>
      buildAdapter([{ type: "done", stopReason: "end_turn" }]),
    );

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "starter-mcp-http",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    await collectEvents(res);
    expect(mcpMocks.createMCPClient).toHaveBeenCalledWith({
      name: "starter-mcp-http",
      transport: "streamable_http",
      url: "http://starter-mcp:8001/mcp",
      headers: { "X-MCP-API-Key": "mcp-secret" },
    });
  });
});

describe("POST /api/chat: runtime servers (proxy mode)", () => {
  afterEach(() => {
    delete process.env.MCP_ALLOW_RUNTIME_PROXY;
  });

  it("connects to a runtime server without following redirects", async () => {
    process.env.MCP_ALLOW_RUNTIME_PROXY = "true";
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.anthropic.mockImplementation(() => buildAdapter([{ type: "done", stopReason: "end_turn" }]));
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverNames: ["ext"],
        runtimeServers: [{ name: "ext", url: "http://127.0.0.1:9/mcp", headers: { "X-Key": "v_test_fixture" } }],
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    await collectEvents(res);
    expect(mcpMocks.createMCPClient).toHaveBeenCalledWith(
      { name: "ext", transport: "streamable_http", url: "http://127.0.0.1:9/mcp", headers: { "X-Key": "v_test_fixture" } },
      { noRedirects: true },
    );
  });

  it("refuses a cloud metadata target with 403 before connecting", async () => {
    process.env.MCP_ALLOW_RUNTIME_PROXY = "true";
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverNames: ["ext"],
        runtimeServers: [{ name: "ext", url: "http://169.254.169.254/mcp" }],
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(403);
    expect(mcpMocks.createMCPClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — server timing in SSE events", () => {
  it("starts with run_start and stamps every event with a non-decreasing server time", async () => {
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.callTool.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { content: { ok: true }, isError: false, durationMs: 30 };
    });
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    adapterMocks.anthropic.mockImplementation(() =>
      buildAdapter([
        { type: "iteration", index: 0 },
        { type: "tool_use", id: "tu-1", name: "list_repositories", input: {} },
        { type: "iteration", index: 1 },
        { type: "done", stopReason: "end_turn" },
      ]),
    );

    const before = Date.now();
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "list repos" }],
      }),
    );
    const events = await collectEvents(res);

    expect(events[0]).toMatchObject({ type: "run_start", t: 0 });
    const start = events[0] as Extract<WireEvent, { type: "run_start" }>;
    expect(start.startedAt).toBeGreaterThanOrEqual(before);

    const times = events.map((e) => e.t as number);
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    // 도구 시작과 끝 사이는 실제 호출 시간(약 30ms)이다.
    const use = events.find((e) => e.type === "tool_use")!;
    const result = events.find((e) => e.type === "tool_result")!;
    expect(result.t! - use.t!).toBeGreaterThanOrEqual(25);
    // 서버와 도구 이름이 붙는다.
    expect(use).toMatchObject({ server: "mock-repo-mcp", tool: "list_repositories" });
    expect(result).toMatchObject({ server: "mock-repo-mcp", tool: "list_repositories" });
  });
});

describe("POST /api/chat — several servers", () => {
  it("prefixes tool names and routes each call to the owning server", async () => {
    const calls: string[] = [];
    const clients: Record<string, MCPClient> = {
      "starter-mcp-http": buildMCPClient({
        listTools: vi.fn().mockResolvedValue([{ name: "echo", description: "e", inputSchema: { type: "object" } }]),
        callTool: vi.fn(async (name: string) => {
          calls.push(`starter:${name}`);
          return { content: "pong", isError: false, durationMs: 1 };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      "mock-repo-mcp": buildMCPClient({
        listTools: vi.fn().mockResolvedValue(SAMPLE_TOOLS),
        callTool: vi.fn(async (name: string) => {
          calls.push(`repo:${name}`);
          return { content: { repositories: [] }, isError: false, durationMs: 1 };
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };
    mcpMocks.createMCPClient.mockImplementation((cfg: { name: string }) => clients[cfg.name]);

    let seen: ChatTurnInput | null = null;
    adapterMocks.anthropic.mockImplementation(() => ({
      async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
        seen = input;
        yield { type: "iteration", index: 0 };
        yield { type: "tool_use", id: "a", name: "mock-repo-mcp__list_repositories", input: {} };
        const r = await input.onToolCall("mock-repo-mcp__list_repositories", {});
        yield { type: "tool_result", toolUseId: "a", content: r.content, isError: r.isError };
        yield { type: "tool_use", id: "b", name: "starter-mcp-http__echo", input: { text: "x" } };
        const r2 = await input.onToolCall("starter-mcp-http__echo", { text: "x" });
        yield { type: "tool_result", toolUseId: "b", content: r2.content, isError: r2.isError };
        yield { type: "tool_use", id: "c", name: "echo", input: {} };
        const r3 = await input.onToolCall("echo", {});
        yield { type: "tool_result", toolUseId: "c", content: r3.content, isError: r3.isError };
        yield { type: "done", stopReason: "end_turn" };
      },
    }));

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverNames: ["starter-mcp-http", "mock-repo-mcp"],
        messages: [{ role: "user", content: "go" }],
      }),
    );
    expect(res.status).toBe(200);
    const events = await collectEvents(res);

    expect(seen!.tools.map((t) => t.name)).toEqual(["starter-mcp-http__echo", "mock-repo-mcp__list_repositories"]);
    expect(calls).toEqual(["repo:list_repositories", "starter:echo"]);
    const uses = events.filter((e) => e.type === "tool_use");
    expect(uses[0]).toMatchObject({ server: "mock-repo-mcp", tool: "list_repositories" });
    expect(uses[1]).toMatchObject({ server: "starter-mcp-http", tool: "echo" });
    // 접두가 없는 이름은 모르는 도구다.
    const unknown = events.filter((e) => e.type === "tool_result")[2];
    expect(unknown).toMatchObject({ isError: true });
    expect((unknown as { content: string }).content).toContain("Unknown tool 'echo'");
    expect(clients["starter-mcp-http"]!.close).toHaveBeenCalled();
    expect(clients["mock-repo-mcp"]!.close).toHaveBeenCalled();
  });

  it("returns 502 naming the server whose tool list failed and closes every client", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mcpMocks.createMCPClient.mockImplementation((cfg: { name: string }) =>
      buildMCPClient({
        listTools:
          cfg.name === "mock-repo-mcp"
            ? vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
            : vi.fn().mockResolvedValue(SAMPLE_TOOLS),
        close,
      }),
    );
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        serverNames: ["starter-mcp-http", "mock-repo-mcp"],
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("'mock-repo-mcp'");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("requires serverNames or serverName", async () => {
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat — stopping a run", () => {
  it("passes the request signal to the adapter and to the running tool call, and closes the MCP client", async () => {
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    let toolSignal: AbortSignal | undefined;
    mcpMocks.callTool.mockImplementation(
      (_name: string, _params: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          toolSignal = options?.signal;
          options?.signal?.addEventListener("abort", () =>
            resolve({ content: "cancelled", isError: true, durationMs: 1 }),
          );
        }),
    );
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());
    let adapterSignal: AbortSignal | undefined;
    adapterMocks.anthropic.mockImplementation(() => ({
      async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
        adapterSignal = input.signal;
        yield { type: "iteration", index: 0 };
        yield { type: "tool_use", id: "a", name: "list_repositories", input: {} };
        const r = await input.onToolCall("list_repositories", {});
        yield { type: "tool_result", toolUseId: "a", content: r.content, isError: r.isError };
        yield { type: "done", stopReason: "error", error: "aborted" };
      },
    }));

    const controller = new AbortController();
    const res = await POST(
      new Request("http://test.local/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          provider: "anthropic",
          apiKey: "sk-test",
          model: "claude-sonnet-4-6",
          serverName: "mock-repo-mcp",
          messages: [{ role: "user", content: "slow" }],
        }),
      }),
    );

    // 도구 호출이 걸려 있는 동안 Stop (브라우저가 fetch 를 abort 하는 것과 같다)
    await vi.waitFor(() => expect(toolSignal).toBeDefined());
    expect(adapterSignal).toBe(toolSignal);
    controller.abort();
    expect(toolSignal!.aborted).toBe(true);

    // 스트림은 정리되고 MCP 연결은 닫힌다.
    await collectEvents(res).catch(() => undefined);
    await vi.waitFor(() => expect(mcpMocks.close).toHaveBeenCalled());
  });
});

describe("POST /api/chat — mock LLM (CHAT_MOCK_LLM)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is off by default: a missing key is still a 400", async () => {
    delete process.env.CHAT_MOCK_LLM;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("runs the scripted adapter without a key and calls the real MCP bridge", async () => {
    process.env.CHAT_MOCK_LLM = "1";
    mcpMocks.listTools.mockResolvedValue(SAMPLE_TOOLS);
    mcpMocks.callTool.mockResolvedValue({ content: { repositories: [{ name: "alpha" }] }, isError: false, durationMs: 2 });
    mcpMocks.createMCPClient.mockReturnValue(buildMCPClient());

    const res = await POST(
      buildPostRequest({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        serverName: "mock-repo-mcp",
        messages: [{ role: "user", content: "show me the repositories" }],
      }),
    );
    expect(res.status).toBe(200);
    const events = await collectEvents(res);
    expect(adapterMocks.anthropic).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("tool_use");
    expect(mcpMocks.callTool).toHaveBeenCalledWith("list_repositories", {}, expect.anything());
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn" });
  });
});
