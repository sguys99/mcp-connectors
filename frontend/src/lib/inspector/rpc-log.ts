// Inspector 하단 도킹 패널의 JSON-RPC 원본 로그. 순수 모듈이라 단위 테스트로 고정한다.
//
//   * transport 를 지나는 메시지(요청, 응답, 알림)를 순서대로 쌓는다. 응답은 id 로 요청과 짝을 지어 소요 시간을 잰다.
//   * 상태: pending(응답 대기), ok, error(JSON-RPC 오류 또는 isError), cancelled(notifications/cancelled 를 보낸 요청), info(알림).
//   * 링 버퍼: RPC_LOG_MAX 건을 넘으면 오래된 것부터 버린다 (dropped 에 개수를 센다).
//   * 저장하는 메시지는 비밀을 가린 복사본이다 (redact.ts). 크기는 가리기 전 원문 기준이다.

import type { RpcMessageEvent } from "@/lib/mcp/types";

import { redactDeep } from "./redact";

export const RPC_LOG_MAX = 500;

export type RpcKind = "request" | "response" | "notification";
export type RpcStatus = "pending" | "ok" | "error" | "cancelled" | "info";

export interface RpcLogEntry {
  seq: number;
  // 벽시계 시각 (epoch ms)과 단조 시계 (소요 시간 계산용)
  at: number;
  t: number;
  dir: "out" | "in";
  kind: RpcKind;
  // 응답은 짝이 되는 요청의 메서드 (짝을 모르면 빈 문자열)
  method: string;
  rpcId?: number | string;
  status: RpcStatus;
  // 응답에만: 요청을 보낸 뒤 응답이 올 때까지
  durationMs?: number;
  bytes: number;
  detail: string;
  // 비밀을 가린 JSON-RPC 메시지
  message: unknown;
}

export interface RpcLog {
  entries: RpcLogEntry[];
  seq: number;
  dropped: number;
}

export const emptyRpcLog = (): RpcLog => ({ entries: [], seq: 0, dropped: 0 });

interface Envelope {
  kind: RpcKind;
  method?: string;
  id?: number | string;
  error?: { code?: unknown; message?: unknown };
  result?: unknown;
  params?: unknown;
}

function classify(message: unknown): Envelope | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const m = message as Record<string, unknown>;
  const id = typeof m.id === "number" || typeof m.id === "string" ? m.id : undefined;
  if (typeof m.method === "string") {
    return { kind: id === undefined ? "notification" : "request", method: m.method, id, params: m.params };
  }
  if (id !== undefined && ("result" in m || "error" in m)) {
    return { kind: "response", id, result: m.result, error: m.error && typeof m.error === "object" ? (m.error as Envelope["error"]) : undefined };
  }
  return null;
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

const str = (v: unknown, max = 60): string => {
  const s = typeof v === "string" ? v : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// 요청 한 줄 요약: 어떤 도구, 리소스, 프롬프트를 부르는지
export function describeRequest(method: string, params: unknown): string {
  const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  switch (method) {
    case "tools/call":
    case "prompts/get":
      return str(p.name);
    case "resources/read":
      return str(p.uri, 80);
    case "initialize": {
      const info = p.clientInfo && typeof p.clientInfo === "object" ? (p.clientInfo as Record<string, unknown>) : {};
      return str(info.name);
    }
    case "notifications/cancelled":
      return p.requestId !== undefined ? `requestId ${String(p.requestId)}` : "";
    default:
      return "";
  }
}

// 응답 한 줄 요약 (목록은 개수, 오류는 코드와 문구)
function describeResponse(method: string, env: Envelope): { status: RpcStatus; detail: string } {
  if (env.error) {
    const code = env.error.code !== undefined ? String(env.error.code) : "";
    return { status: "error", detail: `${code} ${str(env.error.message, 80)}`.trim() };
  }
  const r = env.result && typeof env.result === "object" ? (env.result as Record<string, unknown>) : {};
  const count = (key: string, noun: string) => (Array.isArray(r[key]) ? `${(r[key] as unknown[]).length} ${noun}` : "");
  switch (method) {
    case "tools/list":
      return { status: "ok", detail: count("tools", "tools") };
    case "resources/list":
      return { status: "ok", detail: count("resources", "resources") };
    case "resources/templates/list":
      return { status: "ok", detail: count("resourceTemplates", "templates") };
    case "prompts/list":
      return { status: "ok", detail: count("prompts", "prompts") };
    case "initialize": {
      const info = r.serverInfo && typeof r.serverInfo === "object" ? (r.serverInfo as Record<string, unknown>) : {};
      return { status: "ok", detail: `${str(info.name)} ${str(info.version)}`.trim() };
    }
    case "tools/call":
      return r.isError === true ? { status: "error", detail: "isError" } : { status: "ok", detail: count("content", "blocks") };
    case "resources/read":
      return { status: "ok", detail: count("contents", "contents") };
    case "prompts/get":
      return { status: "ok", detail: count("messages", "messages") };
    default:
      return { status: "ok", detail: "" };
  }
}

function findPending(entries: RpcLogEntry[], dir: "out" | "in", id: number | string): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]!;
    if (e.kind === "request" && e.dir === dir && e.rpcId === id && e.status === "pending") return i;
  }
  return -1;
}

function withStatus(entries: RpcLogEntry[], index: number, patch: Partial<RpcLogEntry>): RpcLogEntry[] {
  const next = entries.slice();
  next[index] = { ...entries[index]!, ...patch };
  return next;
}

// 새 이벤트를 로그에 반영한 새 로그를 돌려준다 (불변).
export function appendRpc(log: RpcLog, event: RpcMessageEvent): RpcLog {
  const env = classify(event.message);
  if (!env) return log;
  let entries = log.entries;

  // 보내기 실패: 새 줄 없이 짝이 되는 대기 요청만 오류로 바꾼다.
  if (event.sendError !== undefined) {
    if (env.kind === "request" && env.id !== undefined) {
      const i = findPending(entries, "out", env.id);
      if (i >= 0) entries = withStatus(entries, i, { status: "error", detail: `transport: ${str(event.sendError, 80)}` });
    }
    return entries === log.entries ? log : { ...log, entries };
  }

  const base = { seq: log.seq + 1, at: event.at, t: event.t, dir: event.dir, bytes: byteLength(event.message), message: redactDeep(event.message) };
  let entry: RpcLogEntry;

  if (env.kind === "request") {
    entry = { ...base, kind: "request", method: env.method!, rpcId: env.id, status: "pending", detail: describeRequest(env.method!, env.params) };
  } else if (env.kind === "notification") {
    entry = { ...base, kind: "notification", method: env.method!, status: "info", detail: describeRequest(env.method!, env.params) };
    // 보낸 취소 알림은 대기 중인 요청을 취소됨으로 표시한다.
    if (env.method === "notifications/cancelled" && event.dir === "out") {
      const p = env.params && typeof env.params === "object" ? (env.params as Record<string, unknown>) : {};
      const rid = p.requestId;
      if (typeof rid === "number" || typeof rid === "string") {
        const i = findPending(entries, "out", rid);
        if (i >= 0) entries = withStatus(entries, i, { status: "cancelled", detail: entries[i]!.detail });
      }
    }
  } else {
    // 응답은 반대 방향에서 나간 요청과 id 로 짝을 짓는다. 취소된 요청에도 늦게 온 응답은 짝을 짓는다.
    const reqDir = event.dir === "in" ? "out" : "in";
    let i = findPending(entries, reqDir, env.id!);
    if (i < 0) {
      for (let k = entries.length - 1; k >= 0; k -= 1) {
        const e = entries[k]!;
        if (e.kind === "request" && e.dir === reqDir && e.rpcId === env.id) {
          i = k;
          break;
        }
      }
    }
    const req = i >= 0 ? entries[i]! : null;
    const method = req?.method ?? "";
    const described = describeResponse(method, env);
    entry = {
      ...base,
      kind: "response",
      method,
      rpcId: env.id,
      status: described.status,
      detail: described.detail,
      ...(req ? { durationMs: Math.max(0, Math.round(event.t - req.t)) } : {}),
    };
    if (req && req.status === "pending") entries = withStatus(entries, i, { status: described.status });
  }

  entries = [...entries, entry];
  let dropped = log.dropped;
  if (entries.length > RPC_LOG_MAX) {
    dropped += entries.length - RPC_LOG_MAX;
    entries = entries.slice(entries.length - RPC_LOG_MAX);
  }
  return { entries, seq: base.seq, dropped };
}

// 메서드, id, 요약, 상태, 메시지 본문에서 검색어(공백으로 나눈 단어가 모두 들어 있어야 함)와 맞는 줄만 남긴다.
export function filterRpc(entries: readonly RpcLogEntry[], query: string): RpcLogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries.slice();
  return entries.filter((e) => {
    const haystack = `${e.method} ${e.rpcId ?? ""} ${e.detail} ${e.status} ${e.kind} ${safeJson(e.message)}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function messageJson(entry: RpcLogEntry): string {
  return JSON.stringify(entry.message, null, 2);
}

// 전체 복사용: 시각, 방향, 상태, 소요 시간과 메시지 원문을 한 배열로
export function exportRpcLog(entries: readonly RpcLogEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      time: new Date(e.at).toISOString(),
      direction: e.dir === "out" ? "client->server" : "server->client",
      kind: e.kind,
      method: e.method || undefined,
      id: e.rpcId,
      status: e.status,
      durationMs: e.durationMs,
      bytes: e.bytes,
      message: e.message,
    })),
    null,
    2,
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} kB`;
}
