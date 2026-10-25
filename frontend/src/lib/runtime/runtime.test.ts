import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RUNTIME_PROXY_PATH, RUNTIME_HEADERS_HEADER, RUNTIME_TARGET_HEADER, decodeRuntimeHeaders } from "./guards";
import { displayTarget, headersRecord, toRuntimeServer } from "./connection";
import { RUNTIME_STORAGE_KEY, parseRuntime, serializeRuntime } from "./storage";
import {
  __resetRuntimeStoreForTests,
  addRuntimeServer,
  getRuntimeSnapshot,
  removeRuntimeServer,
  subscribeRuntime,
  updateRuntimeServer,
} from "./store";
import type { RuntimeServerDef } from "./types";
import { cleanHeaders, suggestName, validateDraft, validateName } from "./validate";

const def = (over: Partial<RuntimeServerDef> = {}): RuntimeServerDef => ({
  name: "ext-one",
  url: "http://localhost:8001/mcp",
  headers: [{ name: "X-Api-Key", value: "key_test_fixture" }],
  mode: "direct",
  rev: 0,
  ...over,
});

const ctx = { registryNames: ["starter-mcp-http"], runtimeNames: ["taken-one"], editing: null };

describe("validateName", () => {
  it("accepts lowercase, digits and dashes", () => {
    expect(validateName("my-server-2", ctx)).toBeNull();
  });
  it("rejects empty, bad format, too long and collisions", () => {
    expect(validateName("  ", ctx)).toBe("empty");
    expect(validateName("My_Server", ctx)).toBe("format");
    expect(validateName("-lead", ctx)).toBe("format");
    expect(validateName("trail-", ctx)).toBe("format");
    expect(validateName("a".repeat(41), ctx)).toBe("tooLong");
    expect(validateName("starter-mcp-http", ctx)).toBe("taken");
    expect(validateName("taken-one", ctx)).toBe("taken");
  });
  it("lets an edited server keep its own name but never a registry name", () => {
    expect(validateName("taken-one", { ...ctx, editing: "taken-one" })).toBeNull();
    expect(validateName("starter-mcp-http", { ...ctx, editing: "starter-mcp-http" })).toBe("taken");
  });
});

describe("validateDraft", () => {
  it("passes a good draft and ignores blank header rows", () => {
    const r = validateDraft({ name: "ok", url: "https://example.com/mcp", headers: [{ name: "", value: "" }, { name: "X-A", value: "1" }] }, ctx);
    expect(r.valid).toBe(true);
  });
  it("reports url, header name, value and duplicate problems", () => {
    const r = validateDraft(
      { name: "ok", url: "ftp://x", headers: [{ name: "Host", value: "a" }, { name: "X-A", value: "1" }, { name: "x-a", value: "2" }, { name: "X-B", value: "a\nb" }] },
      ctx,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.url).toBe("scheme");
    expect(r.errors.headers[0]!.name).toBe("reserved");
    expect(r.errors.headers[2]!.name).toBe("duplicate");
    expect(r.errors.headers[3]!.value).toBe("invalid");
  });
  it("cleans rows and suggests names", () => {
    expect(cleanHeaders([{ name: " X-A ", value: "1" }, { name: "", value: "z" }])).toEqual([{ name: "X-A", value: "1" }]);
    expect(suggestName("http://localhost:8001/mcp")).toBe("localhost-8001");
    expect(suggestName("nope")).toBe("");
  });
});

describe("storage parsing", () => {
  it("round-trips and drops broken or colliding entries", () => {
    const raw = serializeRuntime([def(), def({ name: "ext-one", url: "http://other/mcp" }), def({ name: "Bad Name" }), def({ name: "no-url", url: "ftp://x" })]);
    const out = parseRuntime(raw);
    expect(out.map((d) => d.name)).toEqual(["ext-one"]);
    expect(out[0]!.headers).toEqual([{ name: "X-Api-Key", value: "key_test_fixture" }]);
    expect(parseRuntime("not json")).toEqual([]);
    expect(parseRuntime(null)).toEqual([]);
  });
  it("drops unsafe header rows", () => {
    const raw = JSON.stringify({ v: 1, servers: [{ name: "a", url: "http://x/mcp", mode: "proxy", headers: [{ name: "Host", value: "x" }, { name: "X-Ok", value: "1" }] }] });
    expect(parseRuntime(raw)[0]).toMatchObject({ mode: "proxy", headers: [{ name: "X-Ok", value: "1" }] });
  });
});

describe("session scoped store", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    __resetRuntimeStoreForTests();
  });
  afterEach(() => __resetRuntimeStoreForTests());

  it("keeps definitions in sessionStorage only, never localStorage", () => {
    expect(addRuntimeServer({ name: "ext-one", url: "http://localhost:8001/mcp", headers: [{ name: "X-Api-Key", value: "key_test_fixture" }], mode: "direct" })).toBe(true);
    expect(window.sessionStorage.getItem(RUNTIME_STORAGE_KEY)).toContain("ext-one");
    expect(window.localStorage.length).toBe(0);
    // 새 탭처럼 모듈 상태를 비우면 sessionStorage 에서 다시 읽는다
    __resetRuntimeStoreForTests();
    expect(getRuntimeSnapshot().map((d) => d.name)).toEqual(["ext-one"]);
  });

  it("notifies, rejects duplicates, bumps rev on update, and removes", () => {
    let calls = 0;
    const off = subscribeRuntime(() => (calls += 1));
    addRuntimeServer({ name: "a", url: "http://x/mcp", headers: [], mode: "direct" });
    expect(addRuntimeServer({ name: "a", url: "http://y/mcp", headers: [], mode: "direct" })).toBe(false);
    addRuntimeServer({ name: "b", url: "http://z/mcp", headers: [], mode: "proxy" });
    expect(updateRuntimeServer("a", { name: "a2", url: "http://x2/mcp", headers: [], mode: "direct" })).toBe(true);
    expect(updateRuntimeServer("a2", { name: "b", url: "http://x2/mcp", headers: [], mode: "direct" })).toBe(false);
    expect(getRuntimeSnapshot().map((d) => [d.name, d.rev])).toEqual([["a2", 1], ["b", 0]]);
    removeRuntimeServer("a2");
    removeRuntimeServer("b");
    expect(getRuntimeSnapshot()).toEqual([]);
    expect(window.sessionStorage.getItem(RUNTIME_STORAGE_KEY)).toBeNull();
    expect(calls).toBeGreaterThanOrEqual(5);
    off();
  });
});

describe("toRuntimeServer", () => {
  it("direct mode connects to the target with the user headers", () => {
    const s = toRuntimeServer(def());
    expect(s.url).toBe("http://localhost:8001/mcp");
    expect(s.headers).toEqual({ "X-Api-Key": "key_test_fixture" });
    expect(s.runtime).toEqual({ mode: "direct", target: "http://localhost:8001/mcp", headerNames: ["X-Api-Key"], rev: 0 });
  });
  it("proxy mode goes to the same-origin route and carries target and headers in request headers", () => {
    const s = toRuntimeServer(def({ mode: "proxy" }));
    expect(s.url).toBe(RUNTIME_PROXY_PATH);
    expect(s.headers![RUNTIME_TARGET_HEADER]).toBe("http://localhost:8001/mcp");
    expect(decodeRuntimeHeaders(s.headers![RUNTIME_HEADERS_HEADER]!)).toEqual({ ok: true, headers: { "X-Api-Key": "key_test_fixture" } });
    // 비밀 값은 runtime 메타 정보에 들어가지 않는다
    expect(JSON.stringify(s.runtime)).not.toContain("key_test_fixture");
  });
  it("hides query strings when displaying a target", () => {
    expect(displayTarget("https://h.example/mcp?token=abc_test_fixture")).toBe("https://h.example/mcp?…");
    expect(headersRecord(def({ headers: [{ name: " ", value: "x" }] }))).toEqual({});
  });
});
