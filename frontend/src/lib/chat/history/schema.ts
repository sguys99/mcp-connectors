// 저장하는 대화의 모양(스키마), 저장 전 정리(크기 상한), 불러올 때 되살리기. 순수 함수 모듈이라 브라우저 API 에 의존하지 않는다.
//
// 저장 범위: 메시지(도구 호출과 결과 포함), 워터폴을 다시 그리는 데 필요한 시각 정보(startT, endT, approval 의 시각), 토큰 사용량,
//   제공자와 모델, 노출한 서버 이름, 승인 방식, 시각. 런타임 서버는 이름만 담고 URL 과 헤더 값은 어디에도 담지 않는다.
// 담지 않는 것: 승인 서명 토큰(awaiting), 브라우저 시계 값(waitStartClient), API 키.
//
// 스키마 버전: StoredConversation.v. 모르는 버전의 기록은 읽지 않는다 (upgradeRecord 가 null 을 돌려준다).

import { z } from "zod";

import { conversationUsage } from "@/lib/chat/usage";
import type { AssistantIteration, AssistantTurn, ChatToolUseWithResult, ChatTurn } from "@/lib/chat/serialize";
import type { TokenUsage } from "@/lib/llm/usage";

export const CONVERSATION_SCHEMA_VERSION = 1;

// ----- 크기 상한 ----- //

// 도구 결과 하나의 글자 수 상한 (이 값을 넘으면 앞부분만 남기고 표시를 붙인다). 대화 전체가 상한을 넘으면 더 줄인다.
export const MAX_RESULT_CHARS = 100_000;
export const RESULT_CHAR_STEPS = [MAX_RESULT_CHARS, 20_000, 4_000, 1_000, 200] as const;
// 한 대화의 저장 크기 상한 (JSON 글자 수 기준)
export const MAX_CONVERSATION_CHARS = 4 * 1024 * 1024;
export const MAX_SEARCH_TEXT = 20_000;
export const MAX_TITLE_CHARS = 120;
export const AUTO_TITLE_CHARS = 60;

// 도구 결과를 가장 작게 줄여도 넘으면 본문(질문, 답변, 오류 문구)을 이 단계로 줄인다.
export const TEXT_CHAR_STEPS = [20_000, 4_000, 1_000, 200] as const;
// 한 대화의 턴 수 상한 (storedConversationSchema 와 같다. 넘으면 오래된 턴부터 뺀다)
export const MAX_TURNS = 5000;

export function truncationMarker(omitted: number): string {
  return `\n[... truncated when saving: ${omitted} characters omitted ...]`;
}

export function droppedTurnsMarker(omitted: number): string {
  return `[... truncated when saving: ${omitted} earlier turns omitted ...]`;
}

// ----- 모양 ----- //

export type ApprovalSetting = "auto" | "manual";
export type ProviderId = "anthropic" | "openai" | "openrouter";

export interface StoredConversation {
  v: typeof CONVERSATION_SCHEMA_VERSION;
  id: string;
  title: string;
  // true 면 첫 질문에서 자동으로 만든 제목이다. 사용자가 이름을 바꾸면 false.
  titleAuto: boolean;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  maxIterations: number;
  approval: ApprovalSetting;
  // 모델에 노출한 서버 이름들. 그중 런타임 서버의 이름은 runtimeServers 에도 있다 (이름만).
  servers: string[];
  runtimeServers: string[];
  allowedTools: string[];
  turns: ChatTurn[];
  usage: TokenUsage | null;
  // 크기 상한 때문에 도구 결과, 본문을 자르거나 오래된 턴을 빼고 저장했는지
  truncated?: boolean;
}

// 목록에 필요한 요약. 본문을 열지 않고 목록, 검색, 크기 합계를 만든다.
export interface ConversationMeta {
  id: string;
  title: string;
  titleAuto: boolean;
  createdAt: number;
  updatedAt: number;
  provider: ProviderId;
  model: string;
  messageCount: number;
  tokens: number;
  // 저장했을 때 승인 대기 중이었음 (다시 열면 만료된 상태로 보인다)
  pending: boolean;
  truncated: boolean;
  // 저장 크기 (JSON 글자 수, 근사치)
  size: number;
  // 검색용 소문자 본문 (제목, 질문, 답변, 도구 이름과 인자)
  searchText: string;
}

// ----- zod 스키마 (가져오기와 읽기 검증) ----- //

const num = z.number().finite();
const usageSchema = z.object({
  input: num.nonnegative(),
  output: num.nonnegative(),
  cacheRead: num.nonnegative().optional(),
  cacheWrite: num.nonnegative().optional(),
});

const approvalSchema = z.object({
  state: z.enum(["pending", "approved", "denied"]),
  waitStartT: num,
  decidedT: num.optional(),
  auto: z.boolean().optional(),
  always: z.boolean().optional(),
});

const toolUseSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  result: z.object({ content: z.string(), isError: z.boolean() }).nullable(),
  server: z.string().optional(),
  tool: z.string().optional(),
  startT: num.optional(),
  endT: num.optional(),
  approval: approvalSchema.optional(),
});

const iterationSchema = z.object({
  text: z.string(),
  toolUses: z.array(toolUseSchema),
  usage: usageSchema.nullable().optional(),
  startT: num.optional(),
  llmEndT: num.optional(),
});

const userTurnSchema = z.object({
  id: z.string(),
  role: z.literal("user"),
  content: z.string(),
  at: num.optional(),
});

const assistantTurnSchema = z.object({
  id: z.string(),
  role: z.literal("assistant"),
  iterations: z.array(iterationSchema),
  stopReason: z.enum(["end_turn", "max_iterations", "error", "aborted", "awaiting_approval"]),
  error: z.string().optional(),
  maxIterations: num.optional(),
  model: z.string().optional(),
  startedAt: num.optional(),
  endT: num.optional(),
  expired: z.boolean().optional(),
});

const turnSchema = z.discriminatedUnion("role", [userTurnSchema, assistantTurnSchema]);

const shortName = z.string().min(1).max(200);

export const storedConversationSchema = z.object({
  v: z.literal(CONVERSATION_SCHEMA_VERSION),
  id: z.string().min(1).max(200),
  title: z.string().max(1000),
  titleAuto: z.boolean(),
  createdAt: num,
  updatedAt: num,
  provider: z.enum(["anthropic", "openai", "openrouter"]),
  model: z.string().max(500),
  maxIterations: num.int().min(1).max(100),
  approval: z.enum(["auto", "manual"]),
  servers: z.array(shortName).max(100),
  runtimeServers: z.array(shortName).max(100),
  allowedTools: z.array(z.string().max(300)).max(500),
  turns: z.array(turnSchema).max(MAX_TURNS),
  usage: usageSchema.nullable(),
  truncated: z.boolean().optional(),
});

// 읽은 기록을 검증하고 현재 모양으로 올린다. 모르는 버전이나 깨진 기록은 null.
export function upgradeRecord(raw: unknown): StoredConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { v?: unknown }).v;
  if (v !== CONVERSATION_SCHEMA_VERSION) return null;
  const parsed = storedConversationSchema.safeParse(raw);
  return parsed.success ? (parsed.data as StoredConversation) : null;
}

// ----- 저장 전 정리 ----- //

function truncateText(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  return { text: `${text.slice(0, max)}${truncationMarker(text.length - max)}`, cut: true };
}

function cleanToolUse(tool: ChatToolUseWithResult, maxChars: number, flags: { cut: boolean }): ChatToolUseWithResult {
  const { approval, result, ...rest } = tool;
  let nextResult = result;
  if (result) {
    const cut = truncateText(result.content, maxChars);
    if (cut.cut) flags.cut = true;
    nextResult = { content: cut.text, isError: result.isError };
  }
  const out: ChatToolUseWithResult = { ...rest, result: nextResult };
  if (approval) {
    // 브라우저 시계(performance.now) 값은 다시 열면 의미가 없으므로 담지 않는다.
    const { waitStartClient: _drop, ...keep } = approval;
    void _drop;
    out.approval = keep;
  }
  return out;
}

function cleanTurn(turn: ChatTurn, maxChars: number, flags: { cut: boolean }): ChatTurn {
  if (turn.role === "user") return turn;
  // 서명 토큰(awaiting)은 담지 않는다. 다시 열면 어차피 만료다.
  const { awaiting: _awaiting, ...rest } = turn;
  void _awaiting;
  const iterations: AssistantIteration[] = rest.iterations.map((it) => ({
    ...it,
    toolUses: it.toolUses.map((tool) => cleanToolUse(tool, maxChars, flags)),
  }));
  return { ...rest, iterations };
}

export function cleanTurnsForStorage(turns: readonly ChatTurn[], maxChars: number = MAX_RESULT_CHARS): { turns: ChatTurn[]; truncated: boolean } {
  const flags = { cut: false };
  const out = turns.map((turn) => cleanTurn(turn, maxChars, flags));
  return { turns: out, truncated: flags.cut };
}

export interface BuildStoredInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  titleAuto: boolean;
  provider: ProviderId;
  model: string;
  maxIterations: number;
  approval: ApprovalSetting;
  servers: readonly string[];
  runtimeServers: readonly string[];
  allowedTools: readonly string[];
  turns: readonly ChatTurn[];
}

// 저장할 기록을 만든다. 크기가 상한을 넘으면 도구 결과를 단계적으로 더 줄인다 (표시를 붙이고 truncated 를 켠다).
export function buildStoredConversation(input: BuildStoredInput): StoredConversation {
  const usage = conversationUsage(input.turns).usage;
  const base = (turns: ChatTurn[], truncated: boolean): StoredConversation => ({
    v: CONVERSATION_SCHEMA_VERSION,
    id: input.id,
    title: input.title.slice(0, MAX_TITLE_CHARS),
    titleAuto: input.titleAuto,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    provider: input.provider,
    model: input.model,
    maxIterations: input.maxIterations,
    approval: input.approval,
    servers: [...input.servers],
    runtimeServers: [...input.runtimeServers],
    allowedTools: [...input.allowedTools],
    turns,
    usage,
    ...(truncated ? { truncated: true } : {}),
  });
  return fitToLimit(base, input.turns);
}

const fits = (record: StoredConversation) => JSON.stringify(record).length <= MAX_CONVERSATION_CHARS;

// 질문, 답변 본문, 오류 문구를 max 글자로 줄인다 (도구 결과는 cleanTurnsForStorage 가 이미 줄였다).
function truncateTexts(turns: readonly ChatTurn[], max: number): ChatTurn[] {
  return turns.map((turn): ChatTurn => {
    if (turn.role === "user") return { ...turn, content: truncateText(turn.content, max).text };
    return {
      ...turn,
      iterations: turn.iterations.map((it) => ({ ...it, text: truncateText(it.text, max).text })),
      ...(turn.error !== undefined ? { error: truncateText(turn.error, max).text } : {}),
    };
  });
}

// turns[start] (질문 턴) 부터 남기고 앞은 뺀다. 뺀 개수는 남긴 첫 질문 앞에 표시로 붙인다 (대화는 질문으로 시작한다).
function dropOldest(turns: readonly ChatTurn[], start: number): ChatTurn[] {
  const first = turns[start];
  if (start === 0 || first?.role !== "user") return [...turns];
  return [{ ...first, content: `${droppedTurnsMarker(start)}\n\n${first.content}` }, ...turns.slice(start + 1)];
}

// 저장 크기 상한(MAX_CONVERSATION_CHARS)과 턴 수 상한(MAX_TURNS)을 반드시 지킨다. 단계:
//   1) 도구 결과를 RESULT_CHAR_STEPS 로 줄인다  2) 본문을 TEXT_CHAR_STEPS 로 줄인다
//   3) 오래된 턴을 질문 단위로 뺀다 (표시를 붙인다)  4) 그래도 넘으면 표시만 담은 질문 하나만 남긴다.
// 1) 에서 끝나지 않으면 모두 truncated 로 표시한다.
function fitToLimit(build: (turns: ChatTurn[], truncated: boolean) => StoredConversation, source: readonly ChatTurn[]): StoredConversation {
  let cleaned: ChatTurn[] = [...source];
  for (const step of RESULT_CHAR_STEPS) {
    const result = cleanTurnsForStorage(source, step);
    cleaned = result.turns;
    if (cleaned.length > MAX_TURNS) break;
    const record = build(cleaned, result.truncated);
    if (fits(record)) return record;
  }

  let texts = cleaned;
  if (cleaned.length <= MAX_TURNS) {
    for (const step of TEXT_CHAR_STEPS) {
      texts = truncateTexts(cleaned, step);
      const record = build(texts, true);
      if (fits(record)) return record;
    }
  }

  // 남길 수 있는 시작점: 질문 턴의 위치. 뒤로 갈수록 작아지므로 맞는 가장 앞 시작점을 이분 탐색한다.
  const starts = texts.flatMap((turn, i) => (i > 0 && turn.role === "user" && texts.length - i <= MAX_TURNS ? [i] : []));
  let lo = 0;
  let hi = starts.length - 1;
  let best: StoredConversation | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const record = build(dropOldest(texts, starts[mid]!), true);
    if (fits(record)) {
      best = record;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (best) return best;

  const marker: ChatTurn = { id: "truncated", role: "user", content: droppedTurnsMarker(source.length) };
  return build([marker], true);
}

// 가져온 기록에도 같은 상한을 적용한다 (키 모양 검증을 통과한 뒤).
export function fitImported(record: StoredConversation): StoredConversation {
  return fitToLimit((turns, truncated) => ({ ...record, turns, ...(truncated || record.truncated ? { truncated: true } : {}) }), record.turns);
}

// ----- 제목, 요약, 검색 ----- //

// 첫 질문에서 제목을 만든다: 공백을 하나로 줄이고 길면 말줄임표. 질문이 없으면 빈 문자열 (화면에서 "제목 없음").
export function autoTitle(turns: readonly ChatTurn[]): string {
  const first = turns.find((turn) => turn.role === "user");
  if (!first || first.role !== "user") return "";
  const flat = first.content.replace(/\s+/g, " ").trim();
  return flat.length > AUTO_TITLE_CHARS ? `${flat.slice(0, AUTO_TITLE_CHARS - 1)}…` : flat;
}

function turnText(turn: ChatTurn): string[] {
  if (turn.role === "user") return [turn.content];
  const out: string[] = [];
  for (const it of turn.iterations) {
    if (it.text) out.push(it.text);
    for (const tool of it.toolUses) {
      out.push(`${tool.server ?? ""} ${tool.tool ?? tool.name}`);
      try {
        out.push(JSON.stringify(tool.input));
      } catch {
        /* 직렬화할 수 없는 인자는 검색에서 뺀다 */
      }
    }
  }
  return out;
}

export function searchTextOf(title: string, turns: readonly ChatTurn[]): string {
  const joined = [title, ...turns.flatMap(turnText)].join("\n").toLowerCase();
  return joined.length > MAX_SEARCH_TEXT ? joined.slice(0, MAX_SEARCH_TEXT) : joined;
}

export function isAwaiting(turns: readonly ChatTurn[]): boolean {
  const last = turns[turns.length - 1];
  return last?.role === "assistant" && last.stopReason === "awaiting_approval";
}

export function deriveMeta(record: StoredConversation, size: number): ConversationMeta {
  return {
    id: record.id,
    title: record.title,
    titleAuto: record.titleAuto,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    provider: record.provider,
    model: record.model,
    messageCount: record.turns.length,
    tokens: record.usage ? record.usage.input + record.usage.output : 0,
    pending: isAwaiting(record.turns),
    truncated: record.truncated === true,
    size,
    searchText: searchTextOf(record.title, record.turns),
  };
}

// 제목과 본문에서 모든 검색어(공백으로 구분)가 들어 있는지. 빈 검색어는 모두 일치.
export function matchesQuery(meta: Pick<ConversationMeta, "searchText">, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => meta.searchText.includes(term));
}

// ----- 불러오기: 승인 대기 만료 ----- //

// 저장된 대화를 화면에 올린다. 승인 대기였던 턴은 서명 토큰이 프로세스마다, 30분마다 무효이므로 이어갈 수 없다.
// 결정하지 않은 호출의 승인 정보를 지우면 카드는 "취소됨"으로 보이고, 턴에는 expired 표시가 붙어 다시 물어 보라는 안내가 뜬다.
export function restoreTurns(turns: readonly ChatTurn[]): ChatTurn[] {
  return turns.map((turn): ChatTurn => {
    if (turn.role !== "assistant" || turn.stopReason !== "awaiting_approval") return turn;
    const last = turn.iterations.length - 1;
    const iterations = turn.iterations.map((it, i) =>
      i !== last
        ? it
        : {
            ...it,
            toolUses: it.toolUses.map((tool) => {
              if (tool.result !== null || tool.approval?.state !== "pending") return tool;
              const { approval: _approval, ...rest } = tool;
              void _approval;
              return rest;
            }),
          },
    );
    const { awaiting: _awaiting, ...rest } = turn;
    void _awaiting;
    const next: AssistantTurn = { ...rest, iterations, stopReason: "aborted", expired: true };
    return next;
  });
}

export function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
