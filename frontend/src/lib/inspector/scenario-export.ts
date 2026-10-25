// Inspector 호출 기록을 시나리오 YAML(docs/scenario-format.md, version 1)로 바꾼다. 순수 모듈.
//
//   * 한 기록이 한 케이스다. 도구는 tool+params, 리소스는 resource, 프롬프트는 prompt+arguments 단계로 옮긴다.
//   * expect 는 관찰한 응답에서 보수적으로 끌어낸다: 상태(성공, 오류), 있다면 error_code, 몇 개의 안정적인 값.
//     시각, UUID 같은 값은 값 대신 모양(matches_regex)이나 not_empty 로만 확인한다.
//   * 끌어낸 검사임을 알 수 있게 케이스마다 `op: note` 검사를 맨 앞에 두고(판정에서 빠진다), tags 에 derived 를 붙이며,
//     파일 머리에 주석을 단다. 사람이 고치라는 뜻이다.
//   * 취소되었거나 전송 실패한 기록은 시나리오가 될 수 없어 건너뛴다. 비밀을 가린 입력이 있는 케이스는 skip 으로 둔다.

import { Document } from "yaml";

import type { HistoryEntry } from "./history";

export interface ScenarioCheck {
  field?: string;
  op: string;
  value?: unknown;
}

export interface ScenarioExpect {
  status?: "success" | "error" | "any";
  error_code?: string;
  checks?: ScenarioCheck[];
}

export interface ScenarioCase {
  id: string;
  name: string;
  tags: string[];
  tool?: string;
  params?: Record<string, unknown>;
  resource?: string;
  prompt?: string;
  arguments?: Record<string, unknown>;
  expect: ScenarioExpect;
  skip?: string;
}

export interface ScenarioFile {
  version: 1;
  name: string;
  description: string;
  server: string;
  cases: ScenarioCase[];
}

export interface ExportOptions {
  server: string;
  now?: Date;
}

export interface ExportResult {
  scenario: ScenarioFile;
  yaml: string;
  // 시나리오가 될 수 없어 뺀 기록 수 (취소, 전송 실패)
  skipped: number;
}

export const DERIVED_NOTE = "auto-derived from the observed response in Inspector history; review and edit before relying on it";
const MAX_DERIVED_CHECKS = 4;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_SHAPE = "^\\d{4}-\\d{2}-\\d{2}T";
const UUID_SHAPE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const isExportable = (entry: HistoryEntry): boolean => entry.status !== "cancelled" && entry.outcome !== "transport";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 값 하나에서 검사 하나를 끌어낸다. 믿을 수 없는 값(긴 문자열, 큰 정수, 부동소수점 오차)이면 null.
function checkForValue(field: string, value: unknown): ScenarioCheck | null {
  if (typeof value === "boolean") return { field, op: "eq", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e9) return { field, op: "not_null" };
    return { field, op: "eq", value };
  }
  if (typeof value === "string") {
    if (value === "") return null;
    if (ISO_DATETIME.test(value)) return { field, op: "matches_regex", value: ISO_SHAPE };
    if (UUID.test(value)) return { field, op: "matches_regex", value: UUID_SHAPE };
    // 잘린 문자열(…로 끝나거나 상한 길이)은 정확한 값을 모르므로 not_empty 만 확인한다.
    if (value.length >= 200 || value.endsWith("…")) return { field, op: "not_empty" };
    return { field, op: "eq", value };
  }
  if (Array.isArray(value)) return value.length > 0 ? { field, op: "not_empty" } : { field: `${field} | length`, op: "length_eq", value: 0 };
  return null;
}

// 구조화된 객체 응답의 위쪽 값 몇 개 (최상위, 그다음 한 단계 아래)
function objectChecks(observed: Record<string, unknown>): ScenarioCheck[] {
  const out: ScenarioCheck[] = [];
  const push = (c: ScenarioCheck | null) => {
    if (c && out.length < MAX_DERIVED_CHECKS) out.push(c);
  };
  for (const [key, value] of Object.entries(observed)) {
    if (!IDENT.test(key) || isPlainObject(value) || value === null) continue;
    push(checkForValue(key, value));
  }
  for (const [key, value] of Object.entries(observed)) {
    if (!IDENT.test(key) || !isPlainObject(value)) continue;
    for (const [inner, v] of Object.entries(value)) {
      if (!IDENT.test(inner) || isPlainObject(v) || v === null) continue;
      push(checkForValue(`${key}.${inner}`, v));
    }
  }
  return out;
}

function successChecks(entry: HistoryEntry): ScenarioCheck[] {
  const observed = entry.observed;
  if (entry.kind === "tool") {
    if (isPlainObject(observed)) return objectChecks(observed);
    if (Array.isArray(observed)) {
      const first = observed[0];
      return isPlainObject(first) && typeof first.type === "string" ? [{ field: "[0].type", op: "eq", value: first.type }] : [];
    }
    return [];
  }
  if (!isPlainObject(observed)) return [];
  const checks: ScenarioCheck[] = [];
  if (entry.kind === "resource") {
    const contents = observed.contents;
    if (Array.isArray(contents) && contents.length > 0) {
      checks.push({ field: "contents | length", op: "gte", value: 1 });
      const mime = isPlainObject(contents[0]) ? contents[0].mimeType : undefined;
      if (typeof mime === "string" && mime) checks.push({ field: "contents[0].mimeType", op: "eq", value: mime });
    }
    return checks;
  }
  const messages = observed.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    checks.push({ field: "messages | length", op: "gte", value: 1 });
    const role = isPlainObject(messages[0]) ? messages[0].role : undefined;
    if (typeof role === "string" && role) checks.push({ field: "messages[0].role", op: "eq", value: role });
  }
  return checks;
}

// 오류 문구에서 [CODE] 태그와 가변 부분을 뺀 앞부분 (비교용으로 짧게)
function messageSnippet(message: string): string {
  const first = message.replace(/\[[A-Z][A-Z0-9_]+\]/g, "").split("\n")[0]!.trim();
  return first.length > 60 ? first.slice(0, 60).trimEnd() : first;
}

export function deriveExpect(entry: HistoryEntry): ScenarioExpect {
  const note: ScenarioCheck = { op: "note", value: DERIVED_NOTE };
  if (entry.status === "ok") {
    return { checks: [note, ...successChecks(entry)] };
  }
  const expect: ScenarioExpect = { status: "error" };
  if (entry.errorCode) expect.error_code = entry.errorCode;
  const checks: ScenarioCheck[] = [note];
  // 도구 오류는 메시지가 응답의 error.message 와 같으므로 앞부분을 확인한다. JSON-RPC 오류 문구는 계층마다 달라 건너뛴다.
  if (entry.outcome === "tool-error" && entry.errorMessage) {
    const snippet = messageSnippet(entry.errorMessage);
    if (snippet.length >= 4) checks.push({ field: "error.message", op: "contains", value: snippet });
  }
  expect.checks = checks;
  return expect;
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "case";
}

function toCase(entry: HistoryEntry, id: string): ScenarioCase {
  const base = {
    id,
    name: `${entry.target} (derived from Inspector history)`,
    tags: ["derived", entry.kind === "tool" ? "tools" : entry.kind === "resource" ? "resources" : "prompts"],
  };
  const step: Partial<ScenarioCase> =
    entry.kind === "tool"
      ? { tool: entry.target, ...(Object.keys(entry.args).length ? { params: entry.args } : {}) }
      : entry.kind === "resource"
        ? { resource: entry.target }
        : { prompt: entry.target, ...(Object.keys(entry.args).length ? { arguments: entry.args } : {}) };
  const c: ScenarioCase = { ...base, ...step, expect: deriveExpect(entry) };
  if (entry.redacted) c.skip = "an input value was redacted when the call was recorded; fill it in, then remove this skip";
  return c;
}

// entries 는 기록 순서(최근이 앞)를 받아도 되고, 시간 순으로 뒤집어 케이스를 만든다.
export function buildScenario(entries: readonly HistoryEntry[], options: ExportOptions): { scenario: ScenarioFile; skipped: number } {
  const now = options.now ?? new Date();
  const usable = entries.filter(isExportable);
  const chronological = usable.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const used = new Map<string, number>();
  const cases = chronological.map((entry) => {
    const base = slug(entry.target);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return toCase(entry, n === 1 ? base : `${base}-${n}`);
  });
  return {
    scenario: {
      version: 1,
      name: `${options.server} (Inspector history)`,
      description: `Derived from ${cases.length} Inspector call(s) on ${now.toISOString().slice(0, 10)}. The expect blocks are derived from the observed responses; review them.`,
      server: options.server,
      cases,
    },
    skipped: entries.length - usable.length,
  };
}

export function exportScenarioYaml(entries: readonly HistoryEntry[], options: ExportOptions): ExportResult {
  const { scenario, skipped } = buildScenario(entries, options);
  const doc = new Document(scenario);
  doc.commentBefore = [
    " Generated by the MCP Connectors Inspector (call history export).",
    " The expect blocks are DERIVED from the responses observed at the time: each case starts with an `op: note` check",
    " (not evaluated) marking that. Review and edit them before relying on this file.",
    ` Run: python scripts/mcp_cli.py test <this file>   (server: ${options.server})`,
  ].join("\n");
  return { scenario, yaml: doc.toString({ lineWidth: 0 }), skipped };
}

export function scenarioFileName(server: string, now: Date = new Date()): string {
  return `${slug(server)}-history-${now.toISOString().slice(0, 10)}.yaml`;
}
