import { describe, expect, it } from "vitest";

import { containsRedacted, isSecretParamName, isSensitiveKey, REDACTED, redactDeep, redactHeaders, redactInline } from "./redact";

describe("redact", () => {
  it("masks secret-looking keys at any depth and leaves the rest", () => {
    const input = {
      query: "select 1",
      headers: { "X-MCP-API-Key": "abc", Authorization: "Bearer xyz", Accept: "text/plain" },
      nested: [{ password: "pw", count: 3 }, { tokens: 12, apiKey: "k" }],
    };
    const out = redactDeep(input);
    expect(out.query).toBe("select 1");
    expect(out.headers["X-MCP-API-Key"]).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers.Accept).toBe("text/plain");
    expect(out.nested[0]).toEqual({ password: REDACTED, count: 3 });
    // 숫자는 비밀로 보지 않는다
    expect(out.nested[1]).toEqual({ tokens: 12, apiKey: REDACTED });
    // 원본은 그대로
    expect(input.headers.Authorization).toBe("Bearer xyz");
  });

  it("masks secret-shaped values under innocent keys", () => {
    const out = redactDeep({ note: "Bearer abcdef123456", jwt: "eyJhbGciOiJIUzI1.eyJzdWIiOiIx.sig", key: "sk-ant-aaaaaaaaaaaaaaaaaaaa" });
    expect(out).toEqual({ note: REDACTED, jwt: REDACTED, key: REDACTED });
  });

  it("does not mask ordinary words that merely contain a short fragment", () => {
    expect(isSensitiveKey("text")).toBe(false);
    expect(isSensitiveKey("tool_name")).toBe(false);
    expect(isSensitiveKey("max_tokens")).toBe(false);
    expect(isSensitiveKey("X-MCP-API-Key")).toBe(true);
    expect(isSensitiveKey("client_secret")).toBe(true);
  });

  it("redacts headers and detects leftover markers", () => {
    expect(redactHeaders({ "X-MCP-API-Key": "k", "Content-Type": "application/json", "X-Trace-Token": "t" })).toEqual({
      "X-MCP-API-Key": REDACTED,
      "Content-Type": "application/json",
      "X-Trace-Token": REDACTED,
    });
    expect(containsRedacted({ a: [{ b: REDACTED }] })).toBe(true);
    expect(containsRedacted({ a: "x" })).toBe(false);
  });

  it("redacts secrets inside longer strings and keeps the rest", () => {
    const out = redactDeep({
      url: "https://alice:hunter2pass@db.example.com:5432/app?sslmode=require",
      link: "see https://api.example.com/v1?api_key=abc123secret&q=cats#top",
      log: "calling with Authorization: Bearer abcdefgh12345678 done",
      list: ["token=zzz999 and access_token=yyy888, apikey=xxx777; password=pw1 key=k1 secret=s1"],
    });
    expect(out.url).toBe(`https://alice:${REDACTED}@db.example.com:5432/app?sslmode=require`);
    expect(out.link).toBe(`see https://api.example.com/v1?api_key=${REDACTED}&q=cats#top`);
    expect(out.log).toBe(`calling with Authorization: ${REDACTED} done`);
    expect(out.list[0]).toBe(
      `token=${REDACTED} and access_token=${REDACTED}, apikey=${REDACTED}; password=${REDACTED} key=${REDACTED} secret=${REDACTED}`,
    );
    expect(containsRedacted(out.link)).toBe(true);
  });

  it("does not touch look-alike words", () => {
    const text = "monkey=banana tokens=12 https://example.com/path?page=2 user@example.com";
    expect(redactInline(text)).toBe(text);
    expect(isSecretParamName("api_key")).toBe(true);
    expect(isSecretParamName("sig")).toBe(true);
    expect(isSecretParamName("page")).toBe(false);
  });
});
