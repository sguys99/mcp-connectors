// 대화 내보내기(Markdown, JSON)와 가져오기(JSON). 순수 함수 모듈이다.
//
// 내보내기는 비밀 값을 가린다 (lib/inspector/redact.ts 의 규칙): 도구 인자와 JSON 결과는 키 이름과 값 모양으로,
// 본문과 일반 텍스트 결과는 Bearer 토큰, sk- 키, JWT, URL userinfo, 쿼리 비밀 모양으로. 런타임 서버는 이름만 담겨 있어 URL 과 헤더 값은 애초에 없다.
// 가져오기는 데이터만 읽는다: 도구 호출을 실행하지 않고, 가져온 승인 대기는 열 때 만료로 처리된다.

import { z } from "zod";

import type { ChatTurn } from "@/lib/chat/serialize";
import { redactDeep, redactInline } from "@/lib/inspector/redact";

import {
  fitImported,
  newConversationId,
  storedConversationSchema,
  type StoredConversation,
} from "./schema";

export const EXPORT_FORMAT = "mcp-connectors.conversations";
export const EXPORT_VERSION = 1;
// 가져올 수 있는 파일 크기 상한 (글자 수가 아니라 바이트)
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_CONVERSATIONS = 500;

// ----- 비밀 가리기 ----- //

// 본문의 비밀은 redact.ts 의 문장 규칙(redactInline)으로 가린다: Bearer 토큰, sk- 키, JWT, URL userinfo, 쿼리의 비밀 값.
export function redactText(text: string): string {
  return redactInline(text);
}

// 도구 결과: JSON 이면 구조를 보고 가린다 (바뀐 곳이 없으면 원문 그대로). 아니면 모양으로 가린다.
export function redactContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(content);
      const redacted = redactDeep(parsed);
      if (JSON.stringify(redacted) !== JSON.stringify(parsed)) return redactText(JSON.stringify(redacted, null, 2));
    } catch {
      /* JSON 이 아니면 아래의 글자 규칙으로 */
    }
  }
  return redactText(content);
}

function redactTurn(turn: ChatTurn): ChatTurn {
  if (turn.role === "user") return { ...turn, content: redactText(turn.content) };
  return {
    ...turn,
    iterations: turn.iterations.map((it) => ({
      ...it,
      text: redactText(it.text),
      toolUses: it.toolUses.map((tool) => ({
        ...tool,
        input: redactDeep(tool.input),
        result: tool.result ? { ...tool.result, content: redactContent(tool.result.content) } : null,
      })),
    })),
    ...(turn.error ? { error: redactText(turn.error) } : {}),
  };
}

export function redactConversation(record: StoredConversation): StoredConversation {
  return { ...record, title: redactText(record.title), turns: record.turns.map(redactTurn) };
}

// ----- JSON ----- //

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  conversations: StoredConversation[];
}

export function buildExport(records: readonly StoredConversation[], now: Date = new Date()): ExportEnvelope {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    conversations: records.map(redactConversation),
  };
}

export function exportJson(records: readonly StoredConversation[], now?: Date): string {
  return `${JSON.stringify(buildExport(records, now), null, 2)}\n`;
}

// ----- Markdown ----- //

// 화면 언어에 맞춘 머리글 문구 (호출하는 쪽이 t() 로 채운다)
export interface MarkdownLabels {
  exported: string;
  model: string;
  servers: string;
  runtimeServers: string;
  approval: string;
  approvalAuto: string;
  approvalManual: string;
  tokens: string;
  tokensInOut: (input: string, output: string) => string;
  tokensNone: string;
  user: string;
  assistant: string;
  toolCall: string;
  arguments: string;
  result: string;
  error: string;
  status: Record<"done" | "error" | "denied" | "cancelled", string>;
  stopped: string;
  stoppedMax: string;
  expired: string;
  untitled: string;
  truncated: string;
}

// 본문 안의 백틱 묶음보다 긴 울타리를 고른다.
function fence(body: string): string {
  let longest = 2;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(longest + 1);
}

function block(body: string, lang: string): string {
  const f = fence(body);
  return `${f}${lang}\n${body}\n${f}`;
}

function prettyJsonOrText(content: string): { body: string; lang: string } {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { body: JSON.stringify(JSON.parse(content), null, 2), lang: "json" };
    } catch {
      /* 그대로 */
    }
  }
  return { body: content, lang: "text" };
}

function formatTime(ms: number | undefined): string {
  return ms === undefined ? "" : new Date(ms).toISOString();
}

export function conversationToMarkdown(record: StoredConversation, labels: MarkdownLabels, now: Date = new Date()): string {
  const r = redactConversation(record);
  const lines: string[] = [];
  const title = (r.title || labels.untitled).replace(/\s+/g, " ");
  lines.push(`# ${title}`, "");
  lines.push(`- ${labels.exported}: ${now.toISOString()}`);
  lines.push(`- ${labels.model}: ${r.provider} / ${r.model}`);
  if (r.servers.length > 0) lines.push(`- ${labels.servers}: ${r.servers.join(", ")}`);
  if (r.runtimeServers.length > 0) lines.push(`- ${labels.runtimeServers}: ${r.runtimeServers.join(", ")}`);
  lines.push(`- ${labels.approval}: ${r.approval === "manual" ? labels.approvalManual : labels.approvalAuto}`);
  if (r.usage) {
    const cache = (r.usage.cacheRead ?? 0) > 0 || (r.usage.cacheWrite ?? 0) > 0 ? ` (cache read ${r.usage.cacheRead ?? 0}, write ${r.usage.cacheWrite ?? 0})` : "";
    lines.push(`- ${labels.tokens}: ${labels.tokensInOut(String(r.usage.input), String(r.usage.output))}${cache}`);
  } else {
    lines.push(`- ${labels.tokens}: ${labels.tokensNone}`);
  }
  if (r.truncated) lines.push(`- ${labels.truncated}`);
  lines.push("");

  for (const turn of r.turns) {
    if (turn.role === "user") {
      const when = formatTime(turn.at);
      lines.push(`## ${labels.user}${when ? ` (${when})` : ""}`, "", turn.content, "");
      continue;
    }
    const when = formatTime(turn.startedAt);
    lines.push(`## ${labels.assistant}${turn.model ? ` (${turn.model})` : ""}${when ? ` ${when}` : ""}`, "");
    for (const it of turn.iterations) {
      if (it.text) lines.push(it.text, "");
      for (const tool of it.toolUses) {
        const name = tool.server ? `${tool.server} / ${tool.tool ?? tool.name}` : (tool.tool ?? tool.name);
        const status = !tool.result
          ? labels.status.cancelled
          : tool.approval?.state === "denied"
            ? labels.status.denied
            : tool.result.isError
              ? labels.status.error
              : labels.status.done;
        lines.push(`### ${labels.toolCall}: ${name} (${status})`, "");
        lines.push(`**${labels.arguments}**`, "", block(JSON.stringify(tool.input, null, 2), "json"), "");
        if (tool.result) {
          const shown = prettyJsonOrText(tool.result.content);
          lines.push(`**${labels.result}**`, "", block(shown.body, shown.lang), "");
        }
      }
    }
    if (turn.expired) lines.push(`> ${labels.expired}`, "");
    else if (turn.stopReason === "aborted") lines.push(`> ${labels.stopped}`, "");
    else if (turn.stopReason === "max_iterations") lines.push(`> ${labels.stoppedMax}`, "");
    else if (turn.stopReason === "error") lines.push(`> ${labels.error}: ${turn.error ?? ""}`, "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// ----- 가져오기 ----- //

export type ImportErrorCode = "tooLarge" | "invalidJson" | "notExport" | "unsupportedVersion" | "empty" | "tooMany";

export interface ImportPreview {
  ok: true;
  // 검증을 통과한 대화 (id 는 아직 파일의 값 그대로)
  valid: StoredConversation[];
  // 검증을 통과하지 못한 항목 수와 첫 이유
  invalid: number;
  firstIssue: string | null;
  exportedAt: string | null;
}
export interface ImportFailure {
  ok: false;
  code: ImportErrorCode;
  // unsupportedVersion 일 때 파일의 버전
  version?: unknown;
}

const envelopeHead = z.object({ format: z.literal(EXPORT_FORMAT), version: z.unknown(), conversations: z.array(z.unknown()).optional(), exportedAt: z.string().optional() });

// UTF-8 바이트 수 (복사본을 만들지 않고 센다). 짝이 맞는 서로게이트는 4바이트, 외톨이는 U+FFFD 로 3바이트.
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

// 파일 크기 상한은 바이트로 잰다 (글자 수는 한글 같은 다중 바이트 문자에서 실제보다 작다).
export function exceedsImportLimit(text: string): boolean {
  if (text.length > MAX_IMPORT_BYTES) return true;
  if (text.length * 3 <= MAX_IMPORT_BYTES) return false;
  return utf8ByteLength(text) > MAX_IMPORT_BYTES;
}

export function parseImport(text: string): ImportPreview | ImportFailure {
  if (exceedsImportLimit(text)) return { ok: false, code: "tooLarge" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalidJson" };
  }
  const head = envelopeHead.safeParse(data);
  if (!head.success) return { ok: false, code: "notExport" };
  if (head.data.version !== EXPORT_VERSION) return { ok: false, code: "unsupportedVersion", version: head.data.version };
  const list = head.data.conversations;
  if (!list) return { ok: false, code: "notExport" };
  if (list.length === 0) return { ok: false, code: "empty" };
  if (list.length > MAX_IMPORT_CONVERSATIONS) return { ok: false, code: "tooMany" };

  const valid: StoredConversation[] = [];
  let invalid = 0;
  let firstIssue: string | null = null;
  for (const raw of list) {
    const parsed = storedConversationSchema.safeParse(raw);
    if (parsed.success) valid.push(fitImported(parsed.data as StoredConversation));
    else {
      invalid += 1;
      if (firstIssue === null) {
        const issue = parsed.error.issues[0];
        firstIssue = issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid";
      }
    }
  }
  return { ok: true, valid, invalid, firstIssue, exportedAt: head.data.exportedAt ?? null };
}

// 가져올 기록의 id 를 정한다: 이미 있는 id 이거나 파일 안에서 겹치면 새 id. 그 밖은 파일의 id 를 유지한다.
export function assignImportIds(records: readonly StoredConversation[], existing: ReadonlySet<string>): StoredConversation[] {
  const taken = new Set(existing);
  return records.map((record) => {
    let id = record.id;
    if (taken.has(id)) id = newConversationId();
    taken.add(id);
    return id === record.id ? record : { ...record, id };
  });
}

// 파일 이름용: 제목에서 안전한 문자만 남긴다.
export function exportFileName(title: string, ext: "md" | "json", now: Date = new Date()): string {
  const slug = title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = now.toISOString().slice(0, 10);
  return `${slug || "conversation"}-${stamp}.${ext}`;
}
