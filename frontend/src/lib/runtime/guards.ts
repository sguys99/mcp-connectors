// 런타임 서버(Phase 5, P5-5)의 입력 검사와 프록시 방어선. 서버(Route Handler, Chat)와 브라우저(추가 대화상자)가 함께 쓴다.
//
// 여기 규칙은 "사용자가 입력한 URL과 헤더만 대상 서버로 간다"는 약속을 지킨다.
//   * URL 은 http/https 만 허용하고 userinfo(user:pass@)는 거부한다 (비밀이 URL 에 실리지 않게).
//   * 헤더 이름은 RFC 9110 token, 값은 줄바꿈 금지, 개수와 길이 상한. 프록시가 직접 다루는 헤더는 덮어쓰지 못한다.
//   * 프록시는 MCP_ALLOW_RUNTIME_PROXY=true 일 때만 켜진다 (기본 꺼짐).
//   * 서버가 대신 연결하는 경로(/api/mcp-runtime, Chat 의 런타임 서버)는 켜져 있어도 링크 로컬 주소와 클라우드 메타데이터
//     호스트(169.254.0.0/16, fe80::/10, metadata.google.internal 등)로는 연결하지 않는다 (isBlockedRuntimeHost).
//     loopback(127.0.0.1, localhost)과 사설망(10/8, 172.16/12, 192.168/16)은 막지 않는다. 이 앱은 로컬과 내부망의
//     MCP 서버를 점검하는 개발 도구라 그쪽이 주된 대상이기 때문이다. 검사는 URL 의 호스트 글자만 보며 DNS 를 풀지 않으므로,
//     메타데이터 주소로 풀리는 다른 이름까지 막지는 못한다. 프록시는 신뢰하는 환경에서만 켠다.

type Env = Record<string, string | undefined>;

export const RUNTIME_TARGET_HEADER = "x-mcp-runtime-target";
export const RUNTIME_HEADERS_HEADER = "x-mcp-runtime-headers";
export const RUNTIME_PROXY_PATH = "/api/mcp-runtime";

export const MAX_RUNTIME_HEADERS = 20;
export const MAX_HEADER_VALUE_LENGTH = 4096;
export const MAX_URL_LENGTH = 2048;

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;

// RFC 9110 token
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// 프록시가 직접 정하거나 연결을 깨뜨리는 헤더. 사용자가 넣을 수 없다.
export const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "content-type",
  "accept",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
  // 프록시 제어용
  RUNTIME_TARGET_HEADER,
  RUNTIME_HEADERS_HEADER,
]);

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

// 런타임 서버 프록시 허용 여부. 기본은 꺼짐.
export function isRuntimeProxyEnabled(env: Env = process.env): boolean {
  return isTruthy(env.MCP_ALLOW_RUNTIME_PROXY);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface RuntimeProxyLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRequestBytes: number;
}

export function runtimeProxyLimits(env: Env = process.env): RuntimeProxyLimits {
  return {
    timeoutMs: positiveInt(env.MCP_RUNTIME_PROXY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxResponseBytes: positiveInt(env.MCP_RUNTIME_PROXY_MAX_BYTES, DEFAULT_MAX_RESPONSE_BYTES),
    maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
  };
}

// ---------- URL ---------- //

export type UrlProblem = "empty" | "invalid" | "scheme" | "credentials" | "tooLong";

export type UrlCheck = { ok: true; url: string } | { ok: false; problem: UrlProblem };

// http/https URL 만 통과. 통과하면 정규화된 문자열을 돌려준다.
export function checkHttpUrl(raw: string | null | undefined): UrlCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, problem: "empty" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, problem: "tooLong" };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, problem: "scheme" };
  if (!parsed.hostname) return { ok: false, problem: "invalid" };
  if (parsed.username || parsed.password) return { ok: false, problem: "credentials" };
  return { ok: true, url: parsed.toString() };
}

// ---------- 서버 측 연결 대상 ---------- //

// 링크 로컬과 클라우드 메타데이터 호스트. WHATWG URL 은 IPv4 의 10진수, 16진수 표기(예: 2852039166)를
// 점 표기로 바꿔 주므로 hostname 을 그대로 비교하면 된다.
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set(["metadata.google.internal", "metadata.goog", "metadata"]);

export function isBlockedRuntimeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  // IPv4 169.254.0.0/16 (AWS, GCP, Azure 메타데이터 169.254.169.254 포함)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv6 fe80::/10 (fe80 ~ febf)
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  // IPv4 를 담은 IPv6 (::ffff:169.254.x.x 는 URL 이 ::ffff:a9fe:xxxx 로 바꾼다), AWS IPv6 메타데이터 fd00:ec2::254
  if (/^::ffff:a9fe:/.test(host) || /^::ffff:169\.254\./.test(host)) return true;
  if (host === "fd00:ec2::254") return true;
  return false;
}

// 서버가 대신 연결할 URL 의 호스트 검사. 막힌 대상이면 사유 문구, 아니면 null.
export function checkRuntimeTargetHost(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "invalid URL";
  }
  return isBlockedRuntimeHost(hostname)
    ? "link-local and cloud metadata addresses are not allowed for server-side runtime connections"
    : null;
}

// ---------- 헤더 ---------- //

export type HeaderNameProblem = "empty" | "invalid" | "reserved" | "duplicate";
export type HeaderValueProblem = "invalid" | "tooLong";

export function checkHeaderName(name: string): HeaderNameProblem | null {
  const n = name.trim();
  if (!n) return "empty";
  if (!HEADER_NAME_RE.test(n)) return "invalid";
  if (RESERVED_HEADERS.has(n.toLowerCase())) return "reserved";
  return null;
}

export function checkHeaderValue(value: string): HeaderValueProblem | null {
  if (value.length > MAX_HEADER_VALUE_LENGTH) return "tooLong";
  // 줄바꿈과 제어 문자는 헤더 주입에 쓰인다
  if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return "invalid";
  return null;
}

export type HeadersCheck =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; message: string };

// 서버가 받은 헤더 목록을 검사해 대상 서버로 보낼 헤더로 만든다 (잘못된 항목이 하나라도 있으면 거부).
export function sanitizeRuntimeHeaders(input: unknown): HeadersCheck {
  if (input === undefined || input === null) return { ok: true, headers: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "headers must be an object" };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_RUNTIME_HEADERS) return { ok: false, message: `at most ${MAX_RUNTIME_HEADERS} headers are allowed` };
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawName, value] of entries) {
    const name = rawName.trim();
    if (typeof value !== "string") return { ok: false, message: `header '${name}' must be a string` };
    const nameProblem = checkHeaderName(name);
    if (nameProblem) return { ok: false, message: `header name '${name}' is not allowed (${nameProblem})` };
    const valueProblem = checkHeaderValue(value);
    if (valueProblem) return { ok: false, message: `header '${name}' has an invalid value (${valueProblem})` };
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, message: `header '${name}' is duplicated` };
    seen.add(key);
    headers[name] = value;
  }
  return { ok: true, headers };
}

// ---------- 프록시 요청 헤더 인코딩 (브라우저 -> /api/mcp-runtime) ---------- //
// 헤더 값은 ASCII 만 안전하므로 JSON 을 UTF-8 base64url 로 싣는다. 이 값은 같은 origin 의 요청 헤더로만 간다 (URL 에는 싣지 않는다).

export function encodeRuntimeHeaders(headers: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(headers));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeRuntimeHeaders(encoded: string | null): HeadersCheck {
  if (!encoded) return { ok: true, headers: {} };
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return sanitizeRuntimeHeaders(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return { ok: false, message: "headers could not be decoded" };
  }
}
