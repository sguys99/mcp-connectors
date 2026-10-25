// Chat Route Handler (Phase 5-3).
// LLM 어댑터 + MCP 직결 클라이언트를 묶어 tool-use 루프를 SSE 로 흘려보낸다.
//
// 책임 (PRD §3.6.2):
//   1. POST body zod 검증.
//   2. registry (configs/mcp_servers.yaml) 에서 server 조회 + streamable_http 만 허용.
//      serverNames 로 여러 서버를 한 번에 노출할 수 있다 (둘 이상이면 도구 이름에 `server__` 접두, lib/llm/tool-names.ts).
//      MCP 호출은 서버 측에서 resolveUpstream() 의 실제 주소 (Docker 에서는 internalUrl) 와
//      인증 헤더 (MCP_API_KEY) 로 직접 한다.
//   2-0. runtimeServers (프록시 방식으로 추가한 런타임 서버) 는 MCP_ALLOW_RUNTIME_PROXY=true 일 때만 받는다 (lib/runtime/chat-servers.ts).
//        사용자가 입력한 URL 과 헤더만 쓰고 서버의 MCP_API_KEY 는 붙이지 않는다.
//   2-1. apiKey 가 body 에 없으면 서버 env (ANTHROPIC_API_KEY 등) 로 대체.
//   3. MCP listTools → toolDefinitions 블록 렌더.
//   4. systemPromptOverride 우선 적용 (없으면 chat_system.md 템플릿 치환).
//   5. provider 별 adapter 선택 → chatWithTools 호출 → onToolCall 콜백에서 MCP callTool.
//   6. AsyncIterable<LLMEvent> → SSE wire format 으로 stream. 모든 이벤트에 서버 측 경과 시간 t(ms)를 붙이고,
//      도구 이벤트에는 server/tool 이름을 붙인다 (lib/chat/events.ts). 실행 맨 앞에는 run_start 를 보낸다.
//   7. 클라이언트가 fetch 를 abort 하면 request.signal 이 LLM SDK 호출과 진행 중인 MCP 도구 호출(notifications/cancelled)
//      까지 전파되어 서버도 멈춘다.
//
//   CHAT_MOCK_LLM=1 이면 LLM 대신 가짜 어댑터(lib/llm/mock.ts)를 쓴다. e2e 전용이며 기본은 꺼져 있다.
//
// 참조:
//   * adapter.ts:38-58 (ChatTurnInput / LLMEvent / DEFAULT_MAX_ITERATIONS=5)
//   * mcp/client.ts (MCPClient — listTools/callTool/close)
//   * mcp/registry.ts (findServer, resolveUpstream)
//   * Next.js 16 route handlers/streaming docs (POST 는 기본 캐시 비활성)

import { z } from "zod";

import { signApproval } from "@/lib/chat/approval-token";
import { checkChatRequestOrigin } from "@/lib/chat/request-guard";
import type { ApprovalCall, WireEvent } from "@/lib/chat/events";
import { checkResume, denialMessage } from "@/lib/chat/resume";
import { createMCPClient } from "@/lib/mcp/client";
import { findServer, loadRegistry, resolveUpstream } from "@/lib/mcp/registry";
import { RUNTIME_TOOL_RESULT_MAX_CHARS, parseChatRuntimeServers } from "@/lib/runtime/chat-servers";
import type { MCPClient } from "@/lib/mcp/client";
import type { ToolMeta } from "@/lib/mcp/types";

import {
  DEFAULT_MAX_ITERATIONS,
  toMessage,
  type ChatMessage,
  type LLMAdapter,
} from "@/lib/llm/adapter";
import { MAX_ITERATIONS, MIN_ITERATIONS } from "@/lib/llm/constants";
import { createAnthropicAdapter } from "@/lib/llm/anthropic";
import { createOpenAIAdapter } from "@/lib/llm/openai";
import { createMockAdapter, isMockLlmEnabled } from "@/lib/llm/mock";
import { createOpenRouterAdapter } from "@/lib/llm/openrouter";
import { renderSystemPrompt } from "@/lib/llm/prompt";
import { getServerApiKey } from "@/lib/llm/serverKeys";
import { encodeEvent } from "@/lib/llm/sse";
import { exposeTools, ToolNameError, type ToolTarget } from "@/lib/llm/tool-names";

// ---------- 요청 스키마 ---------- //

const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    toolUses: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          input: z.record(z.string(), z.unknown()),
        }),
      )
      .optional(),
  }),
  z.object({
    role: z.literal("tool_result"),
    toolUseId: z.string(),
    content: z.string(),
    isError: z.boolean(),
  }),
]);

const MAX_SERVERS = 8;

const requestSchema = z.object({
  provider: z.enum(["anthropic", "openai", "openrouter"]),
  // 비우면 서버 env 의 provider 키를 쓴다 (lib/llm/serverKeys.ts).
  apiKey: z.string().optional(),
  // 공백과 제어 문자가 없는 모델 ID. OpenRouter 는 자유 입력이라 문자 집합은 제한하지 않는다.
  model: z
    .string()
    .min(1, "model is required")
    .max(200, "model is too long")
    .regex(/^[^\s\p{Cc}]+$/u, "model must not contain whitespace or control characters"),
  // 모델에 노출할 서버들. serverName 은 예전 요청 형식 (서버 하나)이라 둘 중 하나만 있으면 된다.
  serverNames: z.array(z.string().min(1)).min(1).max(MAX_SERVERS).optional(),
  serverName: z.string().min(1).optional(),
  // 프록시 방식 런타임 서버의 정의 (이름이 serverNames 에 있을 때만 쓴다)
  runtimeServers: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        url: z.string().max(2048),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .max(MAX_SERVERS)
    .optional(),
  messages: z.array(chatMessageSchema).min(1, "messages must be non-empty"),
  systemPromptOverride: z.string().nullable().optional(),
  // 허용 범위 밖의 값은 조용히 줄이지 않고 400 으로 거부한다 (비용이 걸린 한도라서 클라이언트 버그를 드러내는 쪽이 낫다).
  maxIterations: z.number().int().min(MIN_ITERATIONS).max(MAX_ITERATIONS).optional(),
  // 도구 호출 승인 방식. 생략하면 auto (바로 실행). manual 은 도구를 부르려는 반복에서 approval_required 로 멈춘다.
  approval: z.enum(["auto", "manual"]).optional(),
  // manual 에서 "이 대화에서 항상 허용"으로 고른 도구 이름 (모델에게 보이는 이름). 승인 카드를 건너뛴다.
  allowTools: z.array(z.string().min(1).max(256)).max(256).optional(),
  // 승인 뒤에 이어서 실행한다. messages 는 승인 대기 중인 assistant 메시지로 끝나야 한다 (lib/chat/resume.ts 가 검증).
  resume: z
    .object({
      token: z.string().min(1).max(256),
      decisions: z
        .array(z.object({ toolUseId: z.string().min(1).max(256), decision: z.enum(["approve", "deny"]) }))
        .min(1)
        .max(64),
    })
    .optional(),
}).refine((r) => r.serverNames !== undefined || r.serverName !== undefined, {
  message: "serverNames is required",
  path: ["serverNames"],
});

// ---------- 어댑터 팩토리 ---------- //

function selectAdapter(
  provider: "anthropic" | "openai" | "openrouter",
  apiKey: string,
  model: string,
): LLMAdapter {
  switch (provider) {
    case "anthropic":
      return createAnthropicAdapter(apiKey, model);
    case "openai":
      return createOpenAIAdapter(apiKey, model);
    case "openrouter":
      return createOpenRouterAdapter(apiKey, model);
  }
}

// ---------- onToolCall (adapter ↔ MCP 브릿지) ---------- //

function buildOnToolCall(
  clients: ReadonlyMap<string, MCPClient>,
  index: ReadonlyMap<string, ToolTarget>,
  signal: AbortSignal,
  runtimeNames: ReadonlySet<string>,
) {
  return async (name: string, args: unknown): Promise<{ content: string; isError: boolean }> => {
    const target = index.get(name);
    const client = target ? clients.get(target.server) : undefined;
    if (!target || !client) return { content: `Unknown tool '${name}'`, isError: true };
    const params = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    // signal: 사용자가 Stop 을 누르면 진행 중인 도구 호출도 notifications/cancelled 로 취소한다.
    const result = await client.callTool(target.tool, params, { signal });
    let content =
      typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    // 런타임 서버는 신뢰 경계 밖이라 결과 크기를 제한한다
    if (runtimeNames.has(target.server) && content.length > RUNTIME_TOOL_RESULT_MAX_CHARS) {
      content = `${content.slice(0, RUNTIME_TOOL_RESULT_MAX_CHARS)}\n[truncated: runtime server result exceeded ${RUNTIME_TOOL_RESULT_MAX_CHARS} characters]`;
    }
    return { content, isError: result.isError };
  };
}

// 실행 시작(t0) 기준 경과 시간. 0.1ms 단위로 반올림한다.
function elapsedSince(t0: number): number {
  return Math.round((performance.now() - t0) * 10) / 10;
}

// ---------- SSE 헤더 ---------- //

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx 등 reverse proxy 의 응답 버퍼링 차단 (Next.js streaming.md L686).
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
} as const;

// ---------- POST ---------- //

export async function POST(request: Request): Promise<Response> {
  // --- 0. 출처와 형식 검사 (403, 415). ---
  const rejected = checkChatRequestOrigin(request);
  if (rejected) return rejected;

  // --- 1. body parse + 검증 (pre-stream → JSON 400). ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const req = parsed.data;

  // --- 1-1. 승인 뒤 이어서 실행하는 요청은 MCP 에 연결하기 전에 검증한다 (위조, 만료, 결정 불일치는 400). ---
  let resume: Extract<ReturnType<typeof checkResume>, { ok: true }> | null = null;
  if (req.resume) {
    const check = checkResume(req.messages, req.resume);
    if (!check.ok) return Response.json({ error: check.error, code: check.code }, { status: 400 });
    resume = check;
  }

  // --- 2. server lookup + transport guard. ---
  const serverNames = [...new Set(req.serverNames ?? [req.serverName!])];

  // 2-0. 런타임 서버 (프록시 방식). 꺼져 있으면 아무것도 가져오지 않고 403.
  let registryNames: string[] = [];
  if (req.runtimeServers && req.runtimeServers.length > 0) {
    try {
      registryNames = (await loadRegistry()).map((e) => e.name);
    } catch (err) {
      return Response.json({ error: toMessage(err) }, { status: 500 });
    }
  }
  const runtime = parseChatRuntimeServers(req.runtimeServers, { registryNames });
  if (!runtime.ok) {
    return Response.json({ error: runtime.error }, { status: runtime.status });
  }

  // 모델에 노출할 서버: 이름, 실제 주소, 헤더. 등록 서버는 서버 env 의 키를 붙이고, 런타임 서버는 사용자 헤더만 쓴다.
  const targets: Array<{ name: string; url: string; headers: Record<string, string> }> = [];
  for (const name of serverNames) {
    const rt = runtime.servers.get(name);
    if (rt) {
      targets.push({ name, url: rt.url, headers: rt.headers });
      continue;
    }
    let server;
    try {
      server = await findServer(name);
    } catch (err) {
      return Response.json({ error: toMessage(err) }, { status: 500 });
    }
    if (!server) {
      return Response.json({ error: `Unknown server '${name}'` }, { status: 400 });
    }
    if (server.transport !== "streamable_http") {
      return Response.json(
        { error: `Chat only supports streamable_http servers. '${name}' uses stdio.` },
        { status: 400 },
      );
    }
    const upstream = resolveUpstream(server);
    targets.push({ name, url: upstream.url, headers: upstream.headers });
  }

  // 테스트용 가짜 LLM 은 키가 필요 없다 (CHAT_MOCK_LLM=1 일 때만).
  const mock = isMockLlmEnabled();
  const apiKey = req.apiKey?.trim() || getServerApiKey(req.provider) || (mock ? "mock" : undefined);
  if (!apiKey) {
    return Response.json(
      { error: `apiKey is required (no server-side key configured for '${req.provider}')` },
      { status: 400 },
    );
  }

  // --- 3. MCP 연결 + listTools (pre-stream → JSON 502 on failure). ---
  const clients = new Map<string, MCPClient>();
  const closeAll = () =>
    Promise.allSettled([...clients.values()].map((c) => c.close())).then(() => undefined);
  for (const target of targets) {
    const config = { name: target.name, transport: "streamable_http" as const, url: target.url, headers: target.headers };
    // 런타임 서버(사용자가 준 URL)는 리다이렉트를 따라가지 않는다.
    clients.set(target.name, runtime.servers.has(target.name) ? createMCPClient(config, { noRedirects: true }) : createMCPClient(config));
  }
  const listed = await Promise.all(
    targets.map(async (target): Promise<{ server: string; tools: ToolMeta[]; error?: string }> => {
      try {
        return { server: target.name, tools: await clients.get(target.name)!.listTools() };
      } catch (err) {
        return { server: target.name, tools: [], error: toMessage(err) };
      }
    }),
  );
  const failed = listed.find((l) => l.error !== undefined);
  if (failed) {
    await closeAll();
    return Response.json(
      { error: `Failed to list tools from '${failed.server}': ${failed.error}` },
      { status: 502 },
    );
  }

  // 둘 이상의 서버를 노출하면 도구 이름에 `server__` 접두를 붙인다.
  let tools: ToolMeta[];
  let toolIndex: Map<string, ToolTarget>;
  try {
    const exposed = exposeTools(listed);
    tools = exposed.tools;
    toolIndex = exposed.index;
  } catch (err) {
    await closeAll();
    return Response.json(
      { error: err instanceof ToolNameError ? err.message : toMessage(err) },
      { status: 400 },
    );
  }

  // --- 4. system prompt 렌더. ---
  let system: string;
  try {
    system = await renderSystemPrompt({
      override: req.systemPromptOverride,
      serverName: serverNames.join(", "),
      tools,
    });
  } catch (err) {
    await closeAll();
    return Response.json(
      { error: `Failed to render system prompt: ${toMessage(err)}` },
      { status: 500 },
    );
  }

  // --- 5. adapter + stream. ---
  const adapter = mock ? createMockAdapter() : selectAdapter(req.provider, apiKey, req.model);
  const maxIterations = req.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const allowed = new Set(req.allowTools ?? []);
  // 수동 승인: "항상 허용" 목록에 없는 호출이 하나라도 있으면 그 반복은 실행하지 않고 멈춘다.
  const requireApproval = req.approval === "manual" ? (calls: { name: string }[]) => calls.some((c) => !allowed.has(c.name)) : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 실행 시작을 0 으로 한 경과 시간. MCP 연결과 listTools 같은 준비 시간은 빼고 LLM 호출부터 잰다.
      const t0 = performance.now();
      const toolOwners = new Map<string, ToolTarget>();
      const send = (event: WireEvent) => controller.enqueue(encodeEvent(event));
      try {
        send({ type: "run_start", t: 0, startedAt: Date.now() });
        const onToolCall = buildOnToolCall(clients, toolIndex, request.signal, new Set(runtime.servers.keys()));

        // 승인 뒤 이어서 실행: 승인한 호출은 서버가 직접 실행하고, 거부한 호출은 거부 안내를 결과로 만든다.
        // 결과는 이 서버가 만든 것만 대화 기록에 붙인다 (클라이언트가 보낸 결과는 쓰지 않는다).
        let history: ChatMessage[] = req.messages;
        let iterationOffset = 0;
        if (resume) {
          iterationOffset = resume.iterationsUsed;
          const results: ChatMessage[] = [];
          for (const call of resume.pending) {
            if (request.signal.aborted) return;
            const target = toolIndex.get(call.name);
            const names = target ? { server: target.server, tool: target.tool } : {};
            let result: { content: string; isError: boolean };
            if (resume.decisions.get(call.id) === "approve") {
              send({ type: "tool_use", id: call.id, name: call.name, input: call.input, resumed: true, t: elapsedSince(t0), ...names });
              try {
                result = await onToolCall(call.name, call.input);
              } catch (err) {
                result = { content: toMessage(err), isError: true };
              }
              send({ type: "tool_result", toolUseId: call.id, ...result, t: elapsedSince(t0), ...names });
            } else {
              result = { content: denialMessage(call.name), isError: true };
              send({ type: "tool_result", toolUseId: call.id, ...result, denied: true, t: elapsedSince(t0), ...names });
            }
            results.push({ role: "tool_result", toolUseId: call.id, ...result });
          }
          history = [...req.messages, ...results];
        }

        if (iterationOffset >= maxIterations) {
          // 승인한 도구까지 실행했지만 반복 한도를 다 써서 모델에게 결과를 보여 줄 수 없다 (자동 모드의 마지막 반복과 같다).
          send({ type: "done", stopReason: "max_iterations", t: elapsedSince(t0) });
          return;
        }

        for await (const event of adapter.chatWithTools({
          system,
          messages: history,
          tools,
          onToolCall,
          maxIterations,
          iterationOffset,
          requireApproval,
          signal: request.signal,
        })) {
          const t = elapsedSince(t0);
          if (event.type === "tool_use") {
            const target = toolIndex.get(event.name);
            if (target) toolOwners.set(event.id, target);
            send({ ...event, t, ...(target ? { server: target.server, tool: target.tool } : {}) });
          } else if (event.type === "tool_result") {
            const target = toolOwners.get(event.toolUseId);
            send({ ...event, t, ...(target ? { server: target.server, tool: target.tool } : {}) });
          } else if (event.type === "approval_required") {
            const calls: ApprovalCall[] = event.calls.map((call) => {
              const target = toolIndex.get(call.name);
              return { ...call, ...(target ? { server: target.server, tool: target.tool } : {}), allowed: allowed.has(call.name) };
            });
            send({ type: "approval_required", t, calls, iterationsUsed: event.iterationsUsed, token: signApproval(event.calls, event.iterationsUsed) });
          } else {
            send({ ...event, t });
          }
          if (event.type === "done" || request.signal.aborted) break;
        }
      } catch (err) {
        // adapter 가 내부 try/catch 로 done(error) 를 yield 하므로 여기 도달은 드묾.
        // (예: encodeEvent 의 직렬화 실패, controller.enqueue 가 던지는 BackpressureError 등.)
        try {
          send({ type: "done", stopReason: "error", error: toMessage(err), t: elapsedSince(t0) });
        } catch {
          // controller 가 이미 닫혔으면 무시.
        }
      } finally {
        await closeAll();
        try {
          controller.close();
        } catch {
          // 클라이언트가 먼저 끊어서 이미 닫혔으면 무시.
        }
      }
    },
    async cancel() {
      // 클라이언트가 fetch 를 abort → ReadableStream cancel → MCP 연결 해제.
      // adapter 는 request.signal 을 통해 SDK abort 까지 이미 전파됨.
      await closeAll();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
