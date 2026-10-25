// MCP 클라이언트 어댑터 (F-6). @modelcontextprotocol/sdk 의 Streamable HTTP transport 사용.
//
// 두 가지 경로를 모두 지원한다:
//   * 프록시 경로 (기본): 등록 서버는 url 이 `/api/mcp/<name>` (상대 경로). 브라우저 origin 기준으로
//     풀고, 인증 헤더는 프록시 (app/api/mcp/[server]/route.ts) 가 서버 측에서 붙인다.
//   * 직접 연결: url 이 절대 URL 이면 그대로 접속하고 serverConfig.headers 를 보낸다.
//     서버 측 Chat 호출 (registry.resolveUpstream 결과) 과 Phase 5 런타임 외부 서버가 이 경로를 쓴다.
//
// PRD §3.7.2: 타임아웃 30s, 클라이언트 재시도 없음.
//
// 사용 예:
//   const client = createMCPClient(server); // server: StreamableHttpServer
//   const tools = await client.listTools();
//   const result = await client.callTool("list_repositories", {});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JsonSchemaValidator, jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import type { ToolCallOutput } from "./output-validation";
import { parseServerTiming, pickProxyTiming, type ProxyTiming } from "@/lib/trace/timing";

import type {
  CallResult,
  CallToolPayload,
  GetPromptPayload,
  GetPromptResult,
  PingResult,
  PromptMeta,
  PublicServer,
  ReadResourcePayload,
  ReadResourceResult,
  ResourceMeta,
  ResourceTemplateMeta,
  RpcMessageEvent,
  RpcTrafficEvent,
  ServerConfig,
  ServerInfo,
  ToolMeta,
  ToolResult,
} from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

// 도구 outputSchema 검증기. SDK 기본값은 ajv 이고 서버(Route Handler, SSR)에서는 그대로 쓴다.
// 브라우저는 ajv 를 첫 번들에서 뺐으므로(next.config.ts) SDK 안에서는 검증을 건너뛰는 검증기를 넘기고,
// 같은 검사(누락된 structuredContent, 스키마 불일치)를 callTool 에서 lib/mcp/output-validation.ts 로 늦게 한다.
// 그 모듈이 진짜 ajv 를 별도 청크로 불러온다. 서버 쪽 호출은 SDK 기본 ajv 검증을 그대로 쓴다.
function browserSchemaValidator(): jsonSchemaValidator | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    getValidator<T>(): JsonSchemaValidator<T> {
      return (input) => ({ valid: true, data: input as T, errorMessage: undefined });
    },
  };
}
const CLIENT_INFO = { name: "mcp-connectors-frontend", version: "0.1.0" };

export interface CallToolOptions {
  // abort() 하면 SDK 가 notifications/cancelled 를 보내고, callTool 은 detail.outcome === "cancelled" 로 돌아온다.
  signal?: AbortSignal;
}

export interface CreateClientOptions {
  // 전송 계층을 지나는 JSON-RPC 요청마다 호출된다 (HTTP 상태만 필요할 때. 메시지 원문은 onMessage). 던진 예외는 무시한다.
  onTraffic?: (event: RpcTrafficEvent) => void;
  // transport 를 지나는 JSON-RPC 메시지(요청, 응답, 알림, SSE 로 오는 것 포함) 원문을 시각과 함께 알린다. Inspector 로그가 쓴다.
  // 던진 예외는 무시한다.
  onMessage?: (event: RpcMessageEvent) => void;
  // true 면 리다이렉트를 따라가지 않고 3xx 응답을 오류로 만든다. 서버가 사용자 입력 URL(런타임 서버)에 대신 연결할 때 쓴다
  // (허용한 대상에서 다른 호스트로 넘어가는 것을 막는다).
  noRedirects?: boolean;
}

// 리다이렉트를 따라가지 않는 fetch. 3xx(또는 브라우저의 opaqueredirect)면 던진다.
export function noRedirectFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, { ...init, redirect: "manual" });
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      void res.body?.cancel().catch(() => {});
      throw new Error(`[mcp] redirect (${res.status || "opaque"}) refused: runtime servers must answer at the given URL`);
    }
    return res;
  };
}

export interface MCPClient {
  listTools(): Promise<ToolMeta[]>;
  callTool(name: string, params: Record<string, unknown>, options?: CallToolOptions): Promise<ToolResult>;
  // initialize 결과 (연결 전이면 연결한다)
  getServerInfo(): Promise<ServerInfo>;
  listResources(): Promise<ResourceMeta[]>;
  listResourceTemplates(): Promise<ResourceTemplateMeta[]>;
  readResource(uri: string, options?: CallToolOptions): Promise<ReadResourceResult>;
  listPrompts(): Promise<PromptMeta[]>;
  getPrompt(name: string, args: Record<string, string>, options?: CallToolOptions): Promise<GetPromptResult>;
  ping(): Promise<PingResult>;
  close(): Promise<void>;
}

// 소요 시간, id, 취소를 추적하는 요청 메서드. 사용자가 실행 버튼으로 보내는 세 가지다.
const TRACED_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);

// 목록 API 쪽수 상한 (nextCursor 가 끝없이 이어지는 서버를 막는다)
const MAX_PAGES = 10;

// 취소 알림이 서버에 닿았는지 확인하려고 기다리는 최대 시간.
const CANCEL_CONFIRM_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class CallTrace {
  requestId?: number | string;
  timing?: ProxyTiming | null;
  cancelNotified?: boolean;
  readonly cancelSettled: Promise<void>;
  settleCancel!: () => void;

  constructor() {
    this.cancelSettled = new Promise<void>((resolve) => {
      this.settleCancel = resolve;
    });
  }
}

// transport 가 보내는 요청 본문(JSON 문자열)에서 method 와 id 만 읽는다. 읽지 못하면 null.
function readRpcEnvelope(body: unknown): { method: string; id?: number | string } | null {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { method, id } = parsed as { method?: unknown; id?: unknown };
    if (typeof method !== "string") return null;
    return { method, id: typeof id === "number" || typeof id === "string" ? id : undefined };
  } catch {
    return null;
  }
}

// nextCursor 를 따라 목록을 모두 모은다 (쪽수 상한 MAX_PAGES).
async function collectPages<Page extends { nextCursor?: string }, Item>(
  fetchPage: (cursor: string | undefined) => Promise<Page>,
  itemsOf: (page: Page) => Item[],
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchPage(cursor);
    items.push(...itemsOf(page));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items;
}

// transport 의 send 와 onmessage 를 감싸 오가는 JSON-RPC 메시지를 알린다. client.connect 보다 먼저 불러야 한다
// (Protocol.connect 가 onmessage 를 덮어쓸 때 setter 가 받아 두었다가 감싼 함수를 돌려준다).
function observeTransport(transport: Transport, report: (event: RpcMessageEvent) => void): void {
  const originalSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    report({ dir: "out", at: Date.now(), t: performance.now(), message });
    try {
      await originalSend(message, options);
    } catch (err) {
      report({
        dir: "out",
        at: Date.now(),
        t: performance.now(),
        message,
        sendError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
  let inner: Transport["onmessage"];
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    enumerable: true,
    get: () =>
      inner
        ? (message: Parameters<NonNullable<Transport["onmessage"]>>[0], extra?: Parameters<NonNullable<Transport["onmessage"]>>[1]) => {
            report({ dir: "in", at: Date.now(), t: performance.now(), message });
            inner?.(message, extra);
          }
        : undefined,
    set: (fn: Transport["onmessage"]) => {
      inner = fn;
    },
  });
}

// 브라우저가 서버에 닿지 못했을 때 fetch 가 던지는 TypeError. CORS 거부도 같은 모양이라 둘을 구분할 수 없다.
export function isBrowserNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(err.message);
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

// 상대 경로 (프록시) 는 브라우저 origin 기준으로 푼다. 서버에서 상대 경로를 쓰면 new URL 이 던진다.
function resolveEndpoint(url: string): URL {
  const base = typeof window !== "undefined" ? window.location.origin : undefined;
  return new URL(url, base);
}

export function createMCPClient(server: ServerConfig | PublicServer, clientOptions: CreateClientOptions = {}): MCPClient {
  if (server.transport !== "streamable_http") {
    throw new Error(
      `[mcp] stdio transport ('${server.name}') is not browser-reachable. ` +
        `Use a streamable_http entry from configs/mcp_servers.yaml.`,
    );
  }

  // 클로저 내에서 narrowing 유지를 위해 별도 변수로 캡처.
  const httpServer = server;
  const extraHeaders = "headers" in httpServer ? httpServer.headers : undefined;

  let connection: Promise<Client> | null = null;
  // 협상된 프로토콜 버전을 읽으려고 transport 를 붙잡아 둔다.
  let activeTransport: StreamableHTTPClientTransport | null = null;

  // callTool 한 건의 부가 정보. 전송 계층(fetch 래퍼)이 알게 되는 값을 호출과 이어 준다.
  // 한 client 에서 동시에 여러 번 호출하지 않는 것이 전제다 (Inspector 는 실행 중 Run 을 막는다).
  // 취소 알림은 callTool 이 돌아온 뒤에 전송될 수 있어서, 다음 호출이 시작될 때까지 참조를 남겨 둔다.
  let currentCall: CallTrace | null = null;

  function emit(event: RpcTrafficEvent) {
    try {
      clientOptions.onTraffic?.(event);
    } catch {
      /* 관측 훅의 오류가 호출을 깨뜨리지 않게 한다 */
    }
  }

  // transport 가 쓰는 fetch. 모든 요청 본문을 읽어 관측 훅에 알리고, 실행 요청(tools/call, resources/read, prompts/get)의
  // id 와 응답의 Server-Timing 을 붙잡고, notifications/cancelled 가 서버에 닿았는지 기록한다. 응답은 그대로 돌려준다.
  const fetch = clientOptions.noRedirects ? noRedirectFetch(globalThis.fetch) : globalThis.fetch;
  const tracedFetch: typeof globalThis.fetch = async (input, init) => {
    const call = currentCall;
    const rpc = readRpcEnvelope(init?.body);
    if (!rpc) return fetch(input, init);
    if (clientOptions.onTraffic) {
      emit({ dir: "out", at: Date.now(), method: rpc.method, id: rpc.id, body: String(init?.body) });
    }
    if (!call) {
      const res = await fetch(input, init);
      if (clientOptions.onTraffic) emit({ dir: "in", at: Date.now(), method: rpc.method, id: rpc.id, status: res.status });
      return res;
    }
    // id 는 응답이 오기 전에 붙잡는다. 응답 전에 취소해도 어떤 요청을 취소했는지 보여 줄 수 있다.
    if (TRACED_METHODS.has(rpc.method)) call.requestId = rpc.id;
    try {
      const res = await fetch(input, init);
      if (TRACED_METHODS.has(rpc.method)) {
        call.timing = pickProxyTiming(parseServerTiming(res.headers.get("server-timing")));
      } else if (rpc.method === "notifications/cancelled") {
        call.cancelNotified = res.ok;
        call.settleCancel();
      }
      if (clientOptions.onTraffic) emit({ dir: "in", at: Date.now(), method: rpc.method, id: rpc.id, status: res.status });
      return res;
    } catch (err) {
      if (rpc.method === "notifications/cancelled") {
        call.cancelNotified = false;
        call.settleCancel();
      }
      throw err;
    }
  };

  // 도구별 outputSchema (브라우저에서만 채워진다. 서버 쪽은 SDK 가 검증한다)
  const outputSchemas = new Map<string, Record<string, unknown>>();

  function getClient(): Promise<Client> {
    if (connection) return connection;
    connection = (async () => {
      const transport = new StreamableHTTPClientTransport(
        resolveEndpoint(httpServer.url),
        {
          requestInit: extraHeaders ? { headers: extraHeaders } : undefined,
          fetch: tracedFetch,
        },
      );
      if (clientOptions.onMessage) {
        observeTransport(transport, (event) => {
          try {
            clientOptions.onMessage?.(event);
          } catch {
            /* 관측 훅의 오류가 호출을 깨뜨리지 않게 한다 */
          }
        });
      }
      const client = new Client(CLIENT_INFO, { jsonSchemaValidator: browserSchemaValidator() });
      await client.connect(transport);
      activeTransport = transport;
      return client;
    })().catch((err) => {
      connection = null; // 다음 시도 때 재연결 가능하도록
      throw err;
    });
    return connection;
  }

  function toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  // 실행 요청 한 건(tools/call, resources/read, prompts/get)을 돌리고 결과를 같은 모양으로 분류한다.
  // withStructured 는 isError 를 읽는 도구 결과에만 쓴다 (resources/prompts 는 isError 가 없다).
  async function runTraced<P>(
    exec: (client: Client, signal: AbortSignal | undefined) => Promise<unknown>,
    contentOf: (payload: P, raw: unknown) => unknown,
    signal: AbortSignal | undefined,
    readsIsError = true,
  ): Promise<CallResult<P>> {
    const call = new CallTrace();
    currentCall = call;
    const started = performance.now();
    try {
      const client = await getClient();
      const result = await exec(client, signal);
      const elapsed = performance.now() - started;
      const payload = result as P;
      const isError = readsIsError && Boolean((payload as { isError?: boolean }).isError);
      return {
        content: contentOf(payload, result),
        isError,
        durationMs: Math.round(elapsed),
        detail: {
          outcome: isError ? "tool-error" : "ok",
          requestId: call.requestId,
          payload,
          bytes: byteLength(result),
          proxyTiming: call.timing ?? undefined,
          elapsedMs: elapsed,
        },
      };
    } catch (err) {
      const elapsed = performance.now() - started;
      const message = toMessage(err);
      if (signal?.aborted) {
        // SDK 가 abort 즉시 notifications/cancelled 를 POST 한다. 서버에 닿았는지 잠깐만 기다려 확인한다.
        await Promise.race([call.cancelSettled, delay(CANCEL_CONFIRM_MS)]);
        return {
          content: message,
          isError: true,
          durationMs: Math.round(elapsed),
          detail: {
            outcome: "cancelled",
            requestId: call.requestId,
            cancelNotified: call.cancelNotified === true,
            elapsedMs: elapsed,
          },
        };
      }
      // 서버가 JSON-RPC 오류로 답한 경우. 연결 끊김과 요청 시간 초과는 전송 오류로 본다.
      const isRpcError =
        err instanceof McpError && err.code !== ErrorCode.ConnectionClosed && err.code !== ErrorCode.RequestTimeout;
      return {
        content: message,
        isError: true,
        durationMs: Math.round(elapsed),
        detail: {
          outcome: isRpcError ? "rpc-error" : "transport",
          requestId: call.requestId,
          errorMessage: isRpcError ? message.replace(/^MCP error -?\d+:\s*/, "") : message,
          errorCode: err instanceof McpError ? err.code : undefined,
          proxyTiming: call.timing ?? undefined,
          elapsedMs: elapsed,
        },
      };
    }
  }

  return {
    async listTools() {
      const client = await getClient();
      const result = await client.listTools(undefined, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      // 브라우저는 SDK 의 출력 검증을 쓰지 않으므로 outputSchema 를 따로 기억해 callTool 이 늦게 검증한다.
      outputSchemas.clear();
      for (const t of result.tools) {
        if (t.outputSchema && typeof window !== "undefined") outputSchemas.set(t.name, t.outputSchema as Record<string, unknown>);
      }
      return result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
        ...(t.annotations
          ? {
              annotations: {
                ...(typeof t.annotations.title === "string" ? { title: t.annotations.title } : {}),
                ...(typeof t.annotations.readOnlyHint === "boolean"
                  ? { readOnlyHint: t.annotations.readOnlyHint }
                  : {}),
              },
            }
          : {}),
      }));
    },

    async callTool(name, params, options) {
      return runTraced<CallToolPayload>(
        async (client, signal) => {
          const result = await client.callTool({ name, arguments: params }, undefined, { timeout: REQUEST_TIMEOUT_MS, signal });
          // SDK 가 하던 outputSchema 검증을 브라우저에서는 여기서 한다. ajv 는 검증이 필요한 첫 호출에서만 불러온다.
          const schema = outputSchemas.get(name);
          if (schema) {
            const { assertToolOutput } = await import("./output-validation");
            assertToolOutput(name, schema, result as ToolCallOutput);
          }
          return result;
        },
        (payload, raw) => payload.structuredContent ?? payload.content ?? raw,
        options?.signal,
      );
    },

    async readResource(uri, options) {
      return runTraced<ReadResourcePayload>(
        (client, signal) => client.readResource({ uri }, { timeout: REQUEST_TIMEOUT_MS, signal }),
        (payload, raw) => payload.contents ?? raw,
        options?.signal,
        false,
      );
    },

    async getPrompt(name, args, options) {
      return runTraced<GetPromptPayload>(
        (client, signal) => client.getPrompt({ name, arguments: args }, { timeout: REQUEST_TIMEOUT_MS, signal }),
        (payload, raw) => payload.messages ?? raw,
        options?.signal,
        false,
      );
    },

    async getServerInfo() {
      const client = await getClient();
      const version = client.getServerVersion();
      return {
        serverInfo: {
          name: version?.name ?? "",
          version: version?.version ?? "",
          ...(typeof version?.title === "string" ? { title: version.title } : {}),
        },
        protocolVersion: activeTransport?.protocolVersion ?? "",
        capabilities: (client.getServerCapabilities() ?? {}) as Record<string, unknown>,
        ...(client.getInstructions() ? { instructions: client.getInstructions() } : {}),
        ...(activeTransport?.sessionId ? { sessionId: activeTransport.sessionId } : {}),
      };
    },

    async listResources() {
      const client = await getClient();
      return collectPages(
        (cursor) => client.listResources(cursor ? { cursor } : undefined, { timeout: REQUEST_TIMEOUT_MS }),
        (page) => page.resources,
      ).then((items) =>
        items.map((r) => ({
          uri: r.uri,
          name: r.name,
          ...(typeof r.title === "string" ? { title: r.title } : {}),
          ...(typeof r.description === "string" ? { description: r.description } : {}),
          ...(typeof r.mimeType === "string" ? { mimeType: r.mimeType } : {}),
          ...(typeof r.size === "number" ? { size: r.size } : {}),
        })),
      );
    },

    async listResourceTemplates() {
      const client = await getClient();
      return collectPages(
        (cursor) => client.listResourceTemplates(cursor ? { cursor } : undefined, { timeout: REQUEST_TIMEOUT_MS }),
        (page) => page.resourceTemplates,
      ).then((items) =>
        items.map((r) => ({
          uriTemplate: r.uriTemplate,
          name: r.name,
          ...(typeof r.title === "string" ? { title: r.title } : {}),
          ...(typeof r.description === "string" ? { description: r.description } : {}),
          ...(typeof r.mimeType === "string" ? { mimeType: r.mimeType } : {}),
        })),
      );
    },

    async listPrompts() {
      const client = await getClient();
      return collectPages(
        (cursor) => client.listPrompts(cursor ? { cursor } : undefined, { timeout: REQUEST_TIMEOUT_MS }),
        (page) => page.prompts,
      ).then((items) =>
        items.map((p) => ({
          name: p.name,
          ...(typeof p.title === "string" ? { title: p.title } : {}),
          ...(typeof p.description === "string" ? { description: p.description } : {}),
          arguments: (p.arguments ?? []).map((a) => ({
            name: a.name,
            ...(typeof a.description === "string" ? { description: a.description } : {}),
            required: a.required === true,
          })),
        })),
      );
    },

    async ping() {
      // 지연은 tools/list 왕복만 잰다. 첫 점검의 세션 연결(initialize 와 initialized 알림)까지 넣으면 첫 값만 1초를 넘겨
      // p50 과 스파크라인이 연결 비용을 지연으로 보이게 된다. 연결이 실패하면 거기까지 걸린 시간을 돌려준다.
      let started = performance.now();
      try {
        const client = await getClient();
        started = performance.now();
        const list = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
        return {
          ok: true,
          latencyMs: Math.round(performance.now() - started),
          toolCount: list.tools.length,
          protocolVersion: activeTransport?.protocolVersion,
        };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - started),
          error: toMessage(err),
          ...(isBrowserNetworkError(err) ? { errorKind: "network" as const } : {}),
        };
      }
    },

    async close() {
      const pending = connection;
      const transport = activeTransport;
      connection = null;
      activeTransport = null;
      if (!pending) return;
      let client: Client;
      try {
        client = await pending;
      } catch {
        // 연결 도중 실패한 경우 (서버 전환 중 offline 서버 등) 닫을 대상이 없다.
        return;
      }
      // 서버 쪽 세션도 끝낸다: Mcp-Session-Id 를 실은 DELETE (MCP Streamable HTTP 의 세션 종료). 서버가 405 로 거절하거나
      // 이미 끊겼으면 무시한다. 닫기만 하고 세션을 남기면 화면을 오갈 때마다 서버에 세션이 쌓인다.
      if (transport?.sessionId) {
        try {
          await transport.terminateSession();
        } catch {
          /* 종료를 지원하지 않거나 이미 끊긴 세션 */
        }
      }
      await client.close();
    },
  };
}
