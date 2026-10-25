// isError 응답의 오류 코드 태그 추출과 원인별 안내 문구 키.
//
// nl2sql-mcp 는 모든 도구 오류 메시지를 "... [CODE]" 로 끝낸다 (src/mcp-servers/nl2sql_mcp/error_codes.py).
// 다른 서버도 같은 규칙을 따르면 그대로 태그가 잡힌다. 모르는 코드는 태그만 보여 주고 안내는 생략한다.

import type { TKey } from "@/lib/i18n/translate";

const TAG = /\[([A-Z][A-Z0-9_]+)\]/g;

// 마지막에 나온 [CODE] 태그. 메시지 중간에 쓴 대괄호 표기보다 끝에 붙은 코드가 진짜 코드라서 마지막 것을 쓴다.
export function extractErrorCode(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(TAG)) last = m[1]!;
  return last;
}

// 코드별 안내 문구 키. 값은 i18n 사전의 inspector.hint.* 키다.
const HINT_KEYS: Record<string, TKey> = {
  MASS_SCAN_BLOCKED: "inspector.hint.massScan",
  WRITE_BLOCKED: "inspector.hint.write",
  PII_COLUMN_BLOCKED: "inspector.hint.pii",
  DATE_RANGE_EXCEEDED: "inspector.hint.dateRange",
  FORBIDDEN_SQL_BLOCKED: "inspector.hint.forbidden",
  RISKY_SQL_BLOCKED: "inspector.hint.risky",
  ACCESS_DENIED: "inspector.hint.accessDenied",
  INVALID_INPUT: "inspector.hint.invalidInput",
  INVALID_SQL: "inspector.hint.invalidSql",
  TABLE_NOT_FOUND: "inspector.hint.tableNotFound",
  TOO_MANY_TABLES: "inspector.hint.tooMany",
  TOO_MANY_COLUMNS: "inspector.hint.tooMany",
  QUERY_TIMEOUT: "inspector.hint.timeout",
  BACKEND_UNAVAILABLE: "inspector.hint.backend",
};

export interface ErrorHint {
  code: string | null;
  hintKey: TKey | null;
}

// WHERE 1=1 같은 항상 참 조건은 MASS_SCAN_BLOCKED 코드를 쓰지만 안내가 달라서 따로 가른다.
export function errorHint(text: string): ErrorHint {
  const code = extractErrorCode(text);
  if (!code) return { code: null, hintKey: null };
  if (code === "MASS_SCAN_BLOCKED" && /\b(1\s*=\s*1|TRUE)\b/i.test(text)) {
    return { code, hintKey: "inspector.hint.tautology" };
  }
  return { code, hintKey: HINT_KEYS[code] ?? null };
}

// content 블록 배열에서 text 만 이어 붙인다.
export function joinText(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .filter(Boolean)
    .join("\n");
}
