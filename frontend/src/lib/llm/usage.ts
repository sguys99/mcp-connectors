// LLM 제공자가 알려 준 토큰 사용량 (클라이언트 안전 모듈, 순수 함수).
//
// 원칙: 제공자 응답의 `usage` 실측값만 쓴다. 추정(글자 수 기반 등)과 비용 환산은 하지 않는다.
// 제공자마다 "입력 토큰"의 뜻이 달라서 한 모양으로 맞춘다.
//   input      이번 요청에서 모델이 읽은 입력 토큰 전체 (캐시에서 읽은 것과 캐시에 쓴 것을 포함한다)
//   output     모델이 쓴 출력 토큰
//   cacheRead  input 중 캐시에서 읽은 토큰 (제공자가 알려 줄 때만)
//   cacheWrite input 중 캐시에 새로 쓴 토큰 (제공자가 알려 줄 때만)
//
//   Anthropic  usage.input_tokens 는 캐시 적중분을 뺀 값이라 cache_read_input_tokens 와 cache_creation_input_tokens 를 더해 input 으로 삼는다.
//   OpenAI 호환 usage.prompt_tokens 가 이미 전체 입력이다. prompt_tokens_details.cached_tokens 가 cacheRead,
//              cache_write_tokens (OpenRouter) 가 cacheWrite 이다.
// 스트림이 usage 를 주지 않거나 값이 이상하면 null ("보고되지 않음")이다.

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function build(input: number, output: number, cacheRead: number | undefined, cacheWrite: number | undefined): TokenUsage {
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

export function normalizeAnthropicUsage(usage: unknown): TokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const fresh = count(u.input_tokens);
  const output = count(u.output_tokens);
  if (fresh === undefined || output === undefined) return null;
  const cacheRead = count(u.cache_read_input_tokens);
  const cacheWrite = count(u.cache_creation_input_tokens);
  return build(fresh + (cacheRead ?? 0) + (cacheWrite ?? 0), output, cacheRead, cacheWrite);
}

export function normalizeOpenAIUsage(usage: unknown): TokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const input = count(u.prompt_tokens);
  const output = count(u.completion_tokens);
  if (input === undefined || output === undefined) return null;
  const details = u.prompt_tokens_details && typeof u.prompt_tokens_details === "object" ? (u.prompt_tokens_details as Record<string, unknown>) : {};
  return build(input, output, count(details.cached_tokens), count(details.cache_write_tokens));
}

// 서버가 보낸 usage 이벤트의 값을 검사해 받는다 (브라우저 쪽 방어).
export function parseTokenUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  const input = count(u.input);
  const output = count(u.output);
  if (input === undefined || output === undefined) return null;
  return build(input, output, count(u.cacheRead), count(u.cacheWrite));
}

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const sum = (x: number | undefined, y: number | undefined) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return build(a.input + b.input, a.output + b.output, sum(a.cacheRead, b.cacheRead), sum(a.cacheWrite, b.cacheWrite));
}

export interface UsageTotal {
  // 보고된 반복들의 합. 하나도 없으면 null
  usage: TokenUsage | null;
  // 보고된 반복 수와 끝난 반복 수. reported < total 이면 합계가 일부만 반영된 것이다.
  reported: number;
  total: number;
}

// 반복별 사용량의 합. undefined 는 아직 진행 중인 반복이라 세지 않고, null 은 보고되지 않은 반복이다.
export function sumUsage(items: readonly (TokenUsage | null | undefined)[]): UsageTotal {
  let usage: TokenUsage | null = null;
  let reported = 0;
  let total = 0;
  for (const item of items) {
    if (item === undefined) continue;
    total += 1;
    if (item === null) continue;
    reported += 1;
    usage = usage ? addUsage(usage, item) : item;
  }
  return { usage, reported, total };
}

// 모델 컨텍스트 창 크기 (미터의 분모). 공개된 이름이 있는 모델만 안다. 모르면 null 이고 미터 막대를 그리지 않는다.
// 시안의 200,000 은 Anthropic 모델 기준이다. 이 값은 표시용 기준선이고 사용량 추정에는 쓰지 않는다.
export function contextWindow(provider: string, model: string): number | null {
  const id = model.toLowerCase();
  if (provider === "anthropic" || id.startsWith("anthropic/") || id.startsWith("claude")) return 200_000;
  if (provider === "openai" || id.startsWith("openai/")) return id.includes("gpt-4o") ? 128_000 : null;
  return null;
}
