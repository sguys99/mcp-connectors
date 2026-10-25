import { describe, expect, it } from "vitest";

import {
  checkHeaderName,
  checkHeaderValue,
  checkHttpUrl,
  checkRuntimeTargetHost,
  isBlockedRuntimeHost,
  decodeRuntimeHeaders,
  encodeRuntimeHeaders,
  isRuntimeProxyEnabled,
  runtimeProxyLimits,
  sanitizeRuntimeHeaders,
} from "./guards";

describe("isRuntimeProxyEnabled", () => {
  it("is off unless explicitly truthy", () => {
    expect(isRuntimeProxyEnabled({})).toBe(false);
    expect(isRuntimeProxyEnabled({ MCP_ALLOW_RUNTIME_PROXY: "" })).toBe(false);
    expect(isRuntimeProxyEnabled({ MCP_ALLOW_RUNTIME_PROXY: "no" })).toBe(false);
    expect(isRuntimeProxyEnabled({ MCP_ALLOW_RUNTIME_PROXY: "true" })).toBe(true);
    expect(isRuntimeProxyEnabled({ MCP_ALLOW_RUNTIME_PROXY: " 1 " })).toBe(true);
  });
});

describe("runtimeProxyLimits", () => {
  it("uses defaults and honors positive overrides", () => {
    expect(runtimeProxyLimits({}).timeoutMs).toBe(60_000);
    expect(runtimeProxyLimits({ MCP_RUNTIME_PROXY_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
    expect(runtimeProxyLimits({ MCP_RUNTIME_PROXY_MAX_BYTES: "-3" }).maxResponseBytes).toBe(10 * 1024 * 1024);
  });
});

describe("checkHttpUrl", () => {
  it("accepts http and https", () => {
    expect(checkHttpUrl(" http://localhost:8001/mcp ")).toEqual({ ok: true, url: "http://localhost:8001/mcp" });
    expect(checkHttpUrl("https://example.com/mcp?x=1").ok).toBe(true);
  });
  it("rejects other schemes, credentials and junk", () => {
    expect(checkHttpUrl("")).toEqual({ ok: false, problem: "empty" });
    expect(checkHttpUrl("file:///etc/passwd")).toEqual({ ok: false, problem: "scheme" });
    expect(checkHttpUrl("ws://localhost/mcp")).toEqual({ ok: false, problem: "scheme" });
    expect(checkHttpUrl("localhost:8001")).toMatchObject({ ok: false });
    expect(checkHttpUrl("http://u:p_test_fixture@host/mcp")).toEqual({ ok: false, problem: "credentials" });
    expect(checkHttpUrl("nope")).toEqual({ ok: false, problem: "invalid" });
    expect(checkHttpUrl(`http://a/${"x".repeat(3000)}`)).toEqual({ ok: false, problem: "tooLong" });
  });
});

describe("header checks", () => {
  it("validates names", () => {
    expect(checkHeaderName("X-API-Key")).toBeNull();
    expect(checkHeaderName("")).toBe("empty");
    expect(checkHeaderName("has space")).toBe("invalid");
    expect(checkHeaderName("Host")).toBe("reserved");
    expect(checkHeaderName("Mcp-Session-Id")).toBe("reserved");
  });
  it("validates values", () => {
    expect(checkHeaderValue("Bearer abc_test_fixture")).toBeNull();
    expect(checkHeaderValue("a\r\nb")).toBe("invalid");
    expect(checkHeaderValue("x".repeat(5000))).toBe("tooLong");
  });
  it("sanitizes a header object and rejects duplicates and overflow", () => {
    expect(sanitizeRuntimeHeaders(undefined)).toEqual({ ok: true, headers: {} });
    expect(sanitizeRuntimeHeaders({ "X-A": "1" })).toEqual({ ok: true, headers: { "X-A": "1" } });
    expect(sanitizeRuntimeHeaders({ "X-A": "1", "x-a": "2" }).ok).toBe(false);
    expect(sanitizeRuntimeHeaders({ "X-A": 1 }).ok).toBe(false);
    expect(sanitizeRuntimeHeaders([]).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-${i}`, "v"]));
    expect(sanitizeRuntimeHeaders(many).ok).toBe(false);
  });
});

describe("runtime header encoding", () => {
  it("round-trips including non-ASCII values", () => {
    const headers = { "X-Key": "값_test_fixture", Authorization: "Bearer a_test_fixture" };
    expect(decodeRuntimeHeaders(encodeRuntimeHeaders(headers))).toEqual({ ok: true, headers });
  });
  it("treats a missing value as no headers and rejects garbage", () => {
    expect(decodeRuntimeHeaders(null)).toEqual({ ok: true, headers: {} });
    expect(decodeRuntimeHeaders("***").ok).toBe(false);
  });
});

describe("isBlockedRuntimeHost / checkRuntimeTargetHost", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.1.2:8080/mcp",
    "http://2852039166/",
    "http://0xA9FEA9FE/",
    "http://[fe80::1]/mcp",
    "http://[febf::1]/mcp",
    "http://[::ffff:169.254.169.254]/",
    "http://[fd00:ec2::254]/",
    "http://metadata.google.internal/computeMetadata/v1",
    "http://METADATA.GOOGLE.INTERNAL./",
  ])("blocks %s", (url) => {
    expect(checkRuntimeTargetHost(url)).toMatch(/link-local/);
  });

  it.each([
    "http://localhost:8001/mcp",
    "http://127.0.0.1:8001/mcp",
    "http://10.0.0.5/mcp",
    "http://192.168.1.10/mcp",
    "http://172.16.0.1/mcp",
    "https://mcp.example.com/mcp",
    "http://[::1]:8001/mcp",
    "http://169.25.0.1/",
  ])("allows loopback, private and public hosts: %s", (url) => {
    expect(checkRuntimeTargetHost(url)).toBeNull();
  });

  it("works on bare hostnames", () => {
    expect(isBlockedRuntimeHost("[FE80::abcd]")).toBe(true);
    expect(isBlockedRuntimeHost("example.com")).toBe(false);
  });
});
