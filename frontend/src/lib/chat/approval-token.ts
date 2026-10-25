// 수동 승인 모드의 승인 토큰 (서버 전용).
//
// 서버는 무상태다. 도구 호출 승인을 기다리는 동안 서버에는 아무것도 남지 않고, 승인 결정은 클라이언트가 대화 기록과 함께 다시 보낸다.
// 그래서 다시 받은 대화 기록의 "승인 대기 중인 도구 호출"이 서버가 보여 준 그대로인지 확인할 방법이 필요하다.
//
// 방식: 서버가 approval_required 를 보낼 때 대기 중인 호출들(id, 이름, 입력)과 지금까지 쓴 반복 수, 발급 시각에 대한
// HMAC-SHA256 서명 토큰을 함께 보낸다. 이어서 요청이 오면 대화 기록 끝의 assistant 메시지에서 호출들을 다시 읽어
// 같은 서명이 나오는지 비교한다. 이렇게 하면 다음이 보장된다.
//   * 실행되는 호출의 id, 이름, 입력은 서버가 LLM 응답에서 받아 사용자에게 보여 준 것과 같다 (화면에서 SQL 을 바꿔치기할 수 없다).
//   * 반복 횟수를 줄여 보내 한도를 우회할 수 없다 (서명에 들어 있다).
//   * 토큰은 발급 후 TTL(30분)이 지나면 쓸 수 없다.
//   * 토큰은 한 번만 쓸 수 있다. 발급마다 무작위 nonce 를 서명에 넣고, 이어서 실행이 받아들여지면 그 nonce 를
//     프로세스 메모리의 사용 목록(TTL 동안 유지)에 넣는다. 같은 토큰을 다시 보내면 token_used 로 거부한다.
//     목록은 인스턴스마다 따로라 여러 인스턴스 배포에서는 같은 인스턴스로 다시 보낸 재사용만 막는다.
// 도구 "결과"는 클라이언트가 보내도 서버가 쓰지 않는다. 결과는 서버가 승인된 호출을 직접 실행해 만든 것만 이어 붙인다
// (route.ts 가 대기 호출의 결과가 대화 기록에 이미 있으면 거부한다).
//
// 비밀 키: CHAT_APPROVAL_SECRET (16자 이상) 이 있으면 그 값을, 없으면 프로세스마다 무작위로 만든 값을 쓴다.
// 서버 인스턴스를 여러 개 두거나 재시작 뒤에도 승인을 이어야 한다면 환경 변수로 같은 값을 줘야 한다.
// 서명이 맞지 않으면 "승인이 만료되었거나 변조되었습니다"로 거부한다.

import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ChatToolUse } from "@/lib/llm/adapter";

export const APPROVAL_TTL_MS = 30 * 60 * 1000;
// 서버 시계와 토큰 발급 시각이 어긋나도 받아 주는 여유
const CLOCK_SKEW_MS = 60 * 1000;

const g = globalThis as { __mcpApprovalSecret?: Buffer };

function secret(env: Record<string, string | undefined> = process.env): Buffer {
  const fromEnv = env.CHAT_APPROVAL_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return Buffer.from(fromEnv, "utf8");
  // 개발 서버가 모듈을 다시 불러와도 같은 값을 쓰도록 globalThis 에 둔다.
  g.__mcpApprovalSecret ??= randomBytes(32);
  return g.__mcpApprovalSecret;
}

// 키 순서와 상관없이 같은 문자열이 되도록 객체 키를 정렬해 직렬화한다.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function payload(calls: readonly ChatToolUse[], iterationsUsed: number, issuedAt: number, nonce: string): string {
  return stableStringify({ v: 2, iterationsUsed, issuedAt, nonce, calls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input })) });
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

// 형식: `<발급 시각(ms)>.<사용한 반복 수>.<nonce>.<서명>`
export function signApproval(
  calls: readonly ChatToolUse[],
  iterationsUsed: number,
  now: number = Date.now(),
  nonce: string = randomBytes(16).toString("base64url"),
): string {
  return `${now}.${iterationsUsed}.${nonce}.${sign(payload(calls, iterationsUsed, now, nonce))}`;
}

export type ApprovalCheck =
  | { ok: true; iterationsUsed: number; nonce: string; issuedAt: number }
  | { ok: false; reason: "malformed" | "expired" | "mismatch" | "used" };

// 이미 쓴 nonce 와 만료 시각. 개발 서버의 모듈 재적재에도 유지되도록 globalThis 에 둔다.
const used = ((globalThis as { __mcpApprovalUsed?: Map<string, number> }).__mcpApprovalUsed ??= new Map<string, number>());

function pruneUsed(now: number): void {
  for (const [nonce, expiresAt] of used) if (expiresAt < now) used.delete(nonce);
}

// 검증만 하고 사용 처리는 하지 않는다 (결정 검사까지 통과한 뒤 consumeApproval 로 처리).
export function verifyApproval(token: string, calls: readonly ChatToolUse[], now: number = Date.now()): ApprovalCheck {
  const m = /^(\d{1,16})\.(\d{1,3})\.([A-Za-z0-9_-]{16,32})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
  if (!m) return { ok: false, reason: "malformed" };
  const issuedAt = Number(m[1]);
  const iterationsUsed = Number(m[2]);
  const nonce = m[3]!;
  const expected = Buffer.from(sign(payload(calls, iterationsUsed, issuedAt, nonce)));
  const given = Buffer.from(m[4]!);
  // 서명이 먼저다. 시각 검사를 먼저 하면 변조와 만료를 구분해 알려 주게 된다.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "mismatch" };
  if (now - issuedAt > APPROVAL_TTL_MS || issuedAt - now > CLOCK_SKEW_MS) return { ok: false, reason: "expired" };
  pruneUsed(now);
  if (used.has(nonce)) return { ok: false, reason: "used" };
  return { ok: true, iterationsUsed, nonce, issuedAt };
}

// 받아들인 토큰의 nonce 를 사용 처리한다. 만료 뒤에는 서명 검사에서 걸리므로 TTL 이 지나면 목록에서 지운다.
export function consumeApproval(nonce: string, issuedAt: number): void {
  used.set(nonce, issuedAt + APPROVAL_TTL_MS + CLOCK_SKEW_MS);
}
