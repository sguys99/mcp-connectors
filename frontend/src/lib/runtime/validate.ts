// 서버 추가 대화상자의 입력 검사 (순수 함수). 오류는 코드로 돌려주고 문구는 화면이 번역한다.

import {
  MAX_RUNTIME_HEADERS,
  checkHeaderName,
  checkHeaderValue,
  checkHttpUrl,
  type HeaderNameProblem,
  type HeaderValueProblem,
  type UrlProblem,
} from "./guards";
import type { RuntimeHeader } from "./types";

export const MAX_NAME_LENGTH = 40;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type NameProblem = "empty" | "format" | "tooLong" | "taken";

export interface DraftErrors {
  name?: NameProblem;
  url?: UrlProblem;
  headers: { name?: HeaderNameProblem; value?: HeaderValueProblem }[];
  tooManyHeaders?: boolean;
}

export interface DraftInput {
  name: string;
  url: string;
  headers: RuntimeHeader[];
}

export interface ValidateContext {
  // 레지스트리 서버 이름 (런타임 서버가 같은 이름을 쓰면 프록시와 탐색기에서 헷갈린다)
  registryNames: readonly string[];
  runtimeNames: readonly string[];
  // 수정 중이면 원래 이름 (자기 자신과는 겹치지 않는다)
  editing?: string | null;
}

export function validateName(name: string, ctx: ValidateContext): NameProblem | null {
  const n = name.trim();
  if (!n) return "empty";
  if (n.length > MAX_NAME_LENGTH) return "tooLong";
  if (!NAME_RE.test(n)) return "format";
  if (ctx.registryNames.includes(n)) return "taken";
  if (n !== ctx.editing && ctx.runtimeNames.includes(n)) return "taken";
  return null;
}

// 빈 행(이름과 값 모두 비어 있음)은 무시하고 검사한다.
export function validateDraft(draft: DraftInput, ctx: ValidateContext): { valid: boolean; errors: DraftErrors } {
  const errors: DraftErrors = { headers: [] };
  const nameProblem = validateName(draft.name, ctx);
  if (nameProblem) errors.name = nameProblem;
  const url = checkHttpUrl(draft.url);
  if (!url.ok) errors.url = url.problem;

  const seen = new Set<string>();
  let used = 0;
  let headerBad = false;
  for (const row of draft.headers) {
    const entry: DraftErrors["headers"][number] = {};
    if (row.name.trim() === "" && row.value === "") {
      errors.headers.push(entry);
      continue;
    }
    used += 1;
    const np = checkHeaderName(row.name);
    if (np) entry.name = np;
    else {
      const key = row.name.trim().toLowerCase();
      if (seen.has(key)) entry.name = "duplicate";
      seen.add(key);
    }
    const vp = checkHeaderValue(row.value);
    if (vp) entry.value = vp;
    if (entry.name || entry.value) headerBad = true;
    errors.headers.push(entry);
  }
  if (used > MAX_RUNTIME_HEADERS) errors.tooManyHeaders = true;

  const valid = !errors.name && !errors.url && !headerBad && !errors.tooManyHeaders;
  return { valid, errors };
}

// 빈 행을 빼고 이름 공백을 다듬은 헤더 목록.
export function cleanHeaders(rows: readonly RuntimeHeader[]): RuntimeHeader[] {
  return rows
    .filter((r) => r.name.trim() !== "")
    .map((r) => ({ name: r.name.trim(), value: r.value }));
}

// 이름 추천: URL 의 host 에서 만든다 (localhost-8001 처럼). 만들 수 없으면 빈 문자열.
export function suggestName(rawUrl: string): string {
  const url = checkHttpUrl(rawUrl);
  if (!url.ok) return "";
  const u = new URL(url.url);
  const base = `${u.hostname}${u.port ? `-${u.port}` : ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, MAX_NAME_LENGTH);
}
