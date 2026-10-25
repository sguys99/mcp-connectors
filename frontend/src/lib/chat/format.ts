// Chat 화면의 작은 표시 헬퍼 (순수 함수).

import { parseJsonContainer } from "@/lib/inspector/json-tokens";

// 입력이 `{ sql: "..." }` 하나뿐이면 SQL 블록으로 보여 준다 (NL2SQL 의 run_sql_query).
export function sqlOnly(input: Record<string, unknown>): string | null {
  const keys = Object.keys(input);
  return keys.length === 1 && keys[0] === "sql" && typeof input.sql === "string" ? input.sql : null;
}

// 카드 머리에 한 줄로 보이는 입력 요약. 길면 말줄임표.
export function argsShort(input: Record<string, unknown>, max = 72): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? "";
  } catch {
    text = "";
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

// MCP 가 돌려주는 content 블록 배열([{type:"text", text}, ...])이면 글만 이어 붙인다. 아니면 null.
// 구조화된 결과가 없는 도구와 isError 결과가 이 모양이라, 그대로 보여 주면 JSON 겉껍질만 가득하다.
function textOfBlocks(parsed: object): string | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const parts: string[] = [];
  for (const block of parsed) {
    if (!block || typeof block !== "object") return null;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type !== "text" || typeof text !== "string") return null;
    parts.push(text);
  }
  return parts.join("\n");
}

// 결과 문자열이 JSON 객체나 배열이면 들여써서, 아니면 그대로 돌려준다. 텍스트 블록 배열은 글만 꺼내고,
// 그 글이 다시 JSON 이면 들여쓴다.
export function prettyResult(content: string): { text: string; json: boolean } {
  const parsed = parseJsonContainer(content);
  if (!parsed) return { text: content, json: false };
  const inner = textOfBlocks(parsed);
  if (inner !== null) {
    const nested = parseJsonContainer(inner);
    return nested ? { text: JSON.stringify(nested, null, 2), json: true } : { text: inner, json: false };
  }
  return { text: JSON.stringify(parsed, null, 2), json: true };
}

// 긴 본문을 줄 경계에서 자른다. 자를 필요가 없으면 그대로.
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", max);
  return { text: `${text.slice(0, cut > max * 0.6 ? cut : max)}\n…`, truncated: true };
}

// 메시지 시각 (시:분). 값이 없으면 빈 문자열.
export function formatClock(ms: number | undefined, locale: string): string {
  if (ms === undefined) return "";
  return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

// 토큰 수 같은 정수를 천 단위 구분 쉼표로 (1234 -> "1,234"). 언어와 상관없이 같은 표기를 쓴다.
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// 좁은 자리에 쓰는 줄임 표기 (1234 -> "1.2k", 12345 -> "12k", 1500000 -> "1.5M")
export function formatCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
