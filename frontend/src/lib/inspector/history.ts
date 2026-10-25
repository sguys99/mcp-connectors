// Inspector 호출 기록 (도구 호출, 리소스 읽기, 프롬프트 가져오기). 서버마다 최근 순으로 localStorage 에 남긴다.
//
//   * 한 항목에는 다시 실행하거나 시나리오로 내보내는 데 필요한 것만 둔다: 입력(args), 결과 상태, 소요 시간, 시각,
//     그리고 응답을 줄여 둔 observed (내보낼 때 기대값을 만드는 근거).
//   * 입력과 observed 는 비밀을 가려 저장한다 (redact.ts). 가려진 값이 있으면 redacted 로 표시하고, 다시 실행은 막는다.
//   * 상한: 서버당 HISTORY_PER_SERVER_MAX 건, 전체 HISTORY_TOTAL_MAX 건. 넘치면 오래된 것부터 버린다.
//   * 순수 함수 + localStorage 만 쓴다. 키는 settings.ts 의 RECENT_CALLS_KEY (설정 초기화와 같은 그룹으로 지워진다).

import { z } from "zod";

import type { CallMethod, CallPayload } from "@/components/inspector/types";
import type { CallResult } from "@/lib/mcp/types";
import { RECENT_CALLS_KEY } from "@/lib/storage/settings";

import { extractErrorCode, joinText } from "./errors";
import { containsRedacted, redactDeep } from "./redact";

export const HISTORY_KEY = RECENT_CALLS_KEY;
export const HISTORY_PER_SERVER_MAX = 50;
export const HISTORY_TOTAL_MAX = 200;

// 저장하는 응답 요약의 크기 상한 (JSON 문자열 길이)과 문자열 하나의 상한
const OBSERVED_MAX_CHARS = 6000;
export const OBSERVED_STRING_MAX = 200;

export type HistoryKind = "tool" | "resource" | "prompt";
export type HistoryOutcome = "ok" | "tool-error" | "rpc-error" | "transport" | "cancelled";
export type HistoryStatus = "ok" | "error" | "cancelled";

export interface HistoryEntry {
  id: string;
  ts: string;
  server: string;
  kind: HistoryKind;
  // 도구 이름, 읽은 리소스 URI, 프롬프트 이름
  target: string;
  // template 으로 읽은 리소스의 uriTemplate (요청 패널에서 템플릿 폼을 다시 열 때 쓴다)
  template?: string;
  // 도구 인자, template 변수, 프롬프트 인자
  args: Record<string, unknown>;
  outcome: HistoryOutcome;
  status: HistoryStatus;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  // 정규화한 응답 요약 (시나리오 응답 모양: 도구는 structured_content 또는 콘텐츠 블록, 리소스는 {contents}, 프롬프트는 {messages})
  observed?: unknown;
  // 비밀을 가린 값이 입력에 들어 있다
  redacted?: boolean;
}

const entrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  server: z.string(),
  kind: z.enum(["tool", "resource", "prompt"]),
  target: z.string(),
  template: z.string().optional(),
  args: z.record(z.string(), z.unknown()),
  outcome: z.enum(["ok", "tool-error", "rpc-error", "transport", "cancelled"]),
  status: z.enum(["ok", "error", "cancelled"]),
  durationMs: z.number(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  observed: z.unknown().optional(),
  redacted: z.boolean().optional(),
});

export const kindOfMethod = (method: CallMethod): HistoryKind =>
  method === "tools/call" ? "tool" : method === "resources/read" ? "resource" : "prompt";

// ----- 응답 요약 -----

function clip(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > OBSERVED_STRING_MAX ? `${value.slice(0, OBSERVED_STRING_MAX - 1)}…` : value;
  if (value === null || typeof value !== "object" || depth > 8) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clip(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // 이진 데이터는 저장하지 않는다
    out[k] = k === "blob" || k === "data" ? "[omitted]" : clip(v, depth + 1);
  }
  return out;
}

// 응답 패널이 쓰는 content 를 시나리오가 판정하는 응답 모양으로 맞춘다.
export function observedOf(method: CallMethod, result: CallResult<CallPayload>): unknown {
  const payload = result.detail?.payload as Record<string, unknown> | undefined;
  let shaped: unknown;
  if (method === "tools/call") shaped = result.content;
  else if (method === "resources/read") shaped = { contents: payload?.contents ?? [] };
  else shaped = { ...(typeof payload?.description === "string" ? { description: payload.description } : {}), messages: payload?.messages ?? [] };
  const clipped = clip(shaped);
  try {
    return JSON.stringify(clipped).length > OBSERVED_MAX_CHARS ? undefined : clipped;
  } catch {
    return undefined;
  }
}

export interface RecordInput {
  server: string;
  method: CallMethod;
  target: string;
  args: Record<string, unknown>;
  result: CallResult<CallPayload>;
  template?: string;
  now?: Date;
}

let counter = 0;

// 끝난 호출 한 건을 기록 항목으로 만든다. outcome 은 detail 이 없으면 isError 로 추정한다.
export function buildHistoryEntry(input: RecordInput): HistoryEntry {
  const { result } = input;
  const detail = result.detail;
  const outcome: HistoryOutcome = detail?.outcome ?? (result.isError ? "tool-error" : "ok");
  const status: HistoryStatus = outcome === "ok" ? "ok" : outcome === "cancelled" ? "cancelled" : "error";
  const now = input.now ?? new Date();

  let errorMessage: string | undefined;
  if (outcome === "tool-error") {
    const payload = detail?.payload as { content?: unknown[] } | undefined;
    errorMessage = joinText(payload?.content) || (typeof result.content === "string" ? result.content : undefined);
  } else if (outcome === "rpc-error" || outcome === "transport") {
    errorMessage = detail?.errorMessage ?? (typeof result.content === "string" ? result.content : undefined);
  }
  const errorCode = errorMessage ? (extractErrorCode(errorMessage) ?? undefined) : undefined;

  const args = redactDeep(input.args);
  const observed = status === "cancelled" || outcome === "transport" ? undefined : redactDeep(observedOf(input.method, result));
  counter += 1;
  return {
    id: `${now.getTime().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: now.toISOString(),
    server: input.server,
    kind: kindOfMethod(input.method),
    target: input.target,
    ...(input.template ? { template: input.template } : {}),
    args,
    outcome,
    status,
    durationMs: Math.round(detail?.elapsedMs ?? result.durationMs),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage: errorMessage.slice(0, 300) } : {}),
    ...(observed !== undefined ? { observed } : {}),
    ...(containsRedacted(args) ? { redacted: true } : {}),
  };
}

// ----- 저장소 -----

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// 읽을 수 없는 항목만 건너뛴다 (예전 형식의 기록은 조용히 사라진다).
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: HistoryEntry[] = [];
  for (const item of data) {
    const parsed = entrySchema.safeParse(item);
    if (parsed.success) out.push(parsed.data as HistoryEntry);
  }
  return out;
}

export function loadHistory(): HistoryEntry[] {
  const s = storage();
  if (!s) return [];
  try {
    return parseHistory(s.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    /* 용량 초과나 차단된 저장소는 기록만 포기한다 */
  }
}

// 새 항목을 맨 앞에 넣고 서버별, 전체 상한을 지킨다. 저장한 목록을 돌려준다.
export function applyCaps(entries: HistoryEntry[]): HistoryEntry[] {
  const perServer = new Map<string, number>();
  const kept: HistoryEntry[] = [];
  for (const e of entries) {
    const n = perServer.get(e.server) ?? 0;
    if (n >= HISTORY_PER_SERVER_MAX) continue;
    perServer.set(e.server, n + 1);
    kept.push(e);
  }
  return kept.slice(0, HISTORY_TOTAL_MAX);
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = applyCaps([entry, ...loadHistory()]);
  saveHistory(next);
  return next;
}

export function removeHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  saveHistory(next);
  return next;
}

// 서버를 주면 그 서버의 기록만, 아니면 전부 지운다.
export function clearHistory(server?: string): HistoryEntry[] {
  const next = server === undefined ? [] : loadHistory().filter((e) => e.server !== server);
  if (next.length === 0) {
    try {
      storage()?.removeItem(HISTORY_KEY);
    } catch {
      /* 무시 */
    }
  } else {
    saveHistory(next);
  }
  return next;
}

// 한 줄 요약: 도구는 인자 JSON, 리소스는 URI, 프롬프트는 인자 JSON
export function summarizeArgs(entry: HistoryEntry): string {
  if (entry.kind === "resource") return entry.target;
  try {
    return JSON.stringify(entry.args);
  } catch {
    return "";
  }
}
