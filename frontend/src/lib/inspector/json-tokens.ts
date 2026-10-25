// JSON 구문 강조용 토큰 분해. 화면은 토큰 종류별로 --syntax-* 색 토큰을 입힌다.
// 라이브러리 없이 정규식 한 번으로 나눈다. 입력은 JSON.stringify(value, null, 2) 같은 정상 JSON 문자열이다.

export type JsonTokenKind = "key" | "string" | "number" | "boolean" | "null" | "punct" | "space";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const PATTERN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])|(\s+)/g;

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    // 정규식이 못 읽은 조각(깨진 JSON)은 그대로 이어 붙여 내용이 사라지지 않게 한다.
    if (at > last) tokens.push({ kind: "punct", text: text.slice(last, at) });
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        tokens.push({ kind: "key", text: m[1] });
        tokens.push({ kind: "punct", text: m[2] });
      } else {
        tokens.push({ kind: "string", text: m[1] });
      }
    } else if (m[3] !== undefined) tokens.push({ kind: "number", text: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: "boolean", text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: "null", text: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: "punct", text: m[6] });
    else if (m[7] !== undefined) tokens.push({ kind: "space", text: m[7] });
    last = at + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: "punct", text: text.slice(last) });
  return tokens;
}

// 문자열이 JSON 객체나 배열이면 파싱 결과를, 아니면 undefined 를 돌려준다. (숫자나 따옴표 문자열은 일반 텍스트로 본다)
export function parseJsonContainer(text: string): object | undefined {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

// 바이트 크기 표기 (1.2 KB). 응답 크기와 블록 크기에 쓴다.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 2 : 1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
