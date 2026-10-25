// 비밀처럼 보이는 값 가리기. JSON-RPC 로그, 호출 기록, 내보내기가 같은 규칙을 쓴다.
//
// 브라우저는 프록시가 서버 쪽에서 붙이는 API Key 를 보지 못한다. 하지만 런타임 서버(P5-5)는 헤더를 브라우저에서 보내므로,
// 이름이 비밀처럼 생긴 키의 값은 모두 REDACTED 로 바꾼다. 숫자와 불리언은 비밀로 보지 않는다 (예: token 수).

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|token|bearer|password|passwd|secret|credentials?|x-[a-z0-9-]*(key|token|secret|auth)[a-z0-9-]*)$|(api[-_]?key|apikey|secret|passw(or)?d|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|private[-_]?key|client[-_]?secret|bearer)/i;

// 값 모양만으로 알 수 있는 비밀 (Bearer 토큰, 흔한 API Key 접두사, JWT)
const SECRET_VALUE = /^(Bearer\s+\S+|Basic\s+[A-Za-z0-9+/=]{8,}|sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*)$/;

// 문장 안에 섞인 비밀 (redactDeep 의 문자열, 대화 내보내기의 본문이 같은 규칙을 쓴다). 비밀 부분만 바꾸고 나머지는 남긴다.
//   * Bearer, Basic 토큰, sk- 키, JWT
//   * URL 의 userinfo 비밀번호  scheme://user:pass@host  ->  scheme://user:[REDACTED]@host
//   * 쿼리, 대입 형태의 비밀  ?api_key=xxx&q=1  ->  ?api_key=[REDACTED]&q=1
const INLINE_TOKEN =
  /\b(Bearer\s+[A-Za-z0-9._~+/=-]{8,}|Basic\s+[A-Za-z0-9+/=]{8,}|sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*)/g;
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#@:]*):([^\s/?#@]+)@/gi;
const SECRET_PARAM_NAMES =
  "api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|token|key|secret|password|passwd|pwd|sig|signature|auth";
const SECRET_PARAM = new RegExp(`(?<![A-Za-z0-9_])(${SECRET_PARAM_NAMES})=([^\\s&#"'<>),;]+)`, "gi");
const SECRET_PARAM_NAME = new RegExp(`^(${SECRET_PARAM_NAMES})$`, "i");

// URL 쿼리 매개변수 이름이 비밀을 담을 만한지 (api_key, token, key, sig ...)
export function isSecretParamName(name: string): boolean {
  return SECRET_PARAM_NAME.test(name) || isSensitiveKey(name);
}

export function redactInline(text: string): string {
  return text
    .replace(INLINE_TOKEN, REDACTED)
    .replace(URL_USERINFO, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`)
    .replace(SECRET_PARAM, (m, name: string, value: string) => (value === REDACTED ? m : `${name}=${REDACTED}`));
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE.test(value.trim());
}

const MAX_DEPTH = 24;

// 값을 깊이 복사하면서 비밀을 가린다. 원본은 건드리지 않는다.
export function redactDeep<T>(value: T): T {
  return walk(value, 0) as T;
}

function walk(value: unknown, depth: number): unknown {
  if (typeof value === "string") return looksLikeSecret(value) ? REDACTED : redactInline(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key) && (typeof v === "string" || (v !== null && typeof v === "object"))) out[key] = REDACTED;
    else out[key] = walk(v, depth + 1);
  }
  return out;
}

// HTTP 헤더 이름과 값 목록에서 비밀 헤더의 값을 가린다 (런타임 서버가 헤더를 화면에 보일 때 쓴다).
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveKey(name) || looksLikeSecret(value) ? REDACTED : redactInline(value);
  }
  return out;
}

// 가려진 값이 들어 있는지 (다시 실행하면 가려진 문구가 그대로 나가므로 확인한다). 문장 안에서 일부만 가린 경우도 센다.
export function containsRedacted(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes(REDACTED);
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) return false;
  return Object.values(value as Record<string, unknown>).some((v) => containsRedacted(v, depth + 1));
}
