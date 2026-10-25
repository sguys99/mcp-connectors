import { describe, expect, it } from "vitest";

import { APPROVAL_TTL_MS, consumeApproval, signApproval, stableStringify, verifyApproval } from "./approval-token";

const CALLS = [{ id: "c1", name: "run_sql_query", input: { sql: "SELECT 1", limit: 5 } }];

describe("stableStringify", () => {
  it("does not depend on key order and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe("approval token", () => {
  const now = 1_800_000_000_000;

  it("verifies the same calls (key order in the input does not matter) and returns the iteration count", () => {
    const token = signApproval(CALLS, 3, now);
    expect(verifyApproval(token, [{ id: "c1", name: "run_sql_query", input: { limit: 5, sql: "SELECT 1" } }], now + 1000)).toMatchObject({ ok: true, iterationsUsed: 3, issuedAt: now });
  });

  it.each([
    ["a changed input", [{ ...CALLS[0]!, input: { sql: "SELECT 2", limit: 5 } }]],
    ["a changed id", [{ ...CALLS[0]!, id: "c2" }]],
    ["a changed name", [{ ...CALLS[0]!, name: "other" }]],
    ["an added call", [...CALLS, { id: "c3", name: "x", input: {} }]],
    ["a removed call", []],
  ])("rejects %s", (_label, calls) => {
    expect(verifyApproval(signApproval(CALLS, 1, now), calls, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a changed iteration count or issue time, malformed tokens and expired tokens", () => {
    const token = signApproval(CALLS, 2, now);
    const [iat, , nonce, sig] = token.split(".");
    expect(verifyApproval(`${iat}.1.${nonce}.${sig}`, CALLS, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyApproval(`${Number(iat) + 1}.2.${nonce}.${sig}`, CALLS, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyApproval(`${iat}.2.${"A".repeat(22)}.${sig}`, CALLS, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyApproval("garbage", CALLS, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyApproval(token, CALLS, now + APPROVAL_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(verifyApproval(token, CALLS, now + APPROVAL_TTL_MS)).toMatchObject({ ok: true });
  });

  it("gives every token its own nonce and accepts a token only once after it is consumed", () => {
    const a = signApproval(CALLS, 1, now);
    const b = signApproval(CALLS, 1, now);
    expect(a).not.toBe(b);
    const first = verifyApproval(a, CALLS, now);
    expect(first).toMatchObject({ ok: true });
    // 검증만으로는 사용 처리되지 않는다
    expect(verifyApproval(a, CALLS, now)).toMatchObject({ ok: true });
    if (first.ok) consumeApproval(first.nonce, first.issuedAt);
    expect(verifyApproval(a, CALLS, now + 1000)).toEqual({ ok: false, reason: "used" });
    // 다른 토큰은 영향이 없다
    expect(verifyApproval(b, CALLS, now)).toMatchObject({ ok: true });
  });
});
