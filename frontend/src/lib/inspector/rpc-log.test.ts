import { describe, expect, it } from "vitest";

import type { RpcMessageEvent } from "@/lib/mcp/types";

import { appendRpc, emptyRpcLog, exportRpcLog, filterRpc, formatBytes, messageJson, RPC_LOG_MAX, type RpcLog } from "./rpc-log";

let clock = 1000;
const ev = (dir: "out" | "in", message: unknown, extra: Partial<RpcMessageEvent> = {}): RpcMessageEvent => {
  clock += 10;
  return { dir, at: 1_700_000_000_000 + clock, t: clock, message, ...extra };
};
const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });
const res = (id: number, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fold = (events: RpcMessageEvent[], start: RpcLog = emptyRpcLog()) => events.reduce(appendRpc, start);

describe("rpc-log", () => {
  it("pairs a response with its request: method, duration and ok status", () => {
    const log = fold([
      ev("out", req(3, "tools/call", { name: "add", arguments: { a: 1, b: 2 } })),
      ev("in", res(3, { content: [{ type: "text", text: "3" }] })),
    ]);
    const [q, r] = log.entries;
    expect(q).toMatchObject({ dir: "out", kind: "request", method: "tools/call", rpcId: 3, status: "ok", detail: "add" });
    expect(r).toMatchObject({ dir: "in", kind: "response", method: "tools/call", rpcId: 3, status: "ok", detail: "1 blocks" });
    expect(r!.durationMs).toBe(10);
    expect(r!.bytes).toBeGreaterThan(10);
  });

  it("marks JSON-RPC errors and isError results as error", () => {
    const log = fold([
      ev("out", req(1, "resources/read", { uri: "x://nope" })),
      ev("in", { jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Resource not found" } }),
      ev("out", req(2, "tools/call", { name: "echo" })),
      ev("in", res(2, { isError: true, content: [] })),
    ]);
    expect(log.entries.map((e) => e.status)).toEqual(["error", "error", "error", "error"]);
    expect(log.entries[1]!.detail).toBe("-32002 Resource not found");
    expect(log.entries[3]!.detail).toBe("isError");
  });

  it("marks a request cancelled when notifications/cancelled goes out, and keeps a late response", () => {
    let log = fold([ev("out", req(7, "tools/call", { name: "slow" })), ev("out", { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7, reason: "user" } })]);
    expect(log.entries[0]!.status).toBe("cancelled");
    expect(log.entries[1]).toMatchObject({ kind: "notification", status: "info", detail: "requestId 7" });
    log = appendRpc(log, ev("in", res(7, { content: [] })));
    expect(log.entries[0]!.status).toBe("cancelled");
    expect(log.entries[2]).toMatchObject({ kind: "response", method: "tools/call", status: "ok" });
  });

  it("keeps requests pending until answered and handles inbound notifications and server requests", () => {
    let log = fold([ev("out", req(1, "tools/list"))]);
    expect(log.entries[0]!.status).toBe("pending");
    log = appendRpc(log, ev("in", { jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } }));
    expect(log.entries[1]).toMatchObject({ dir: "in", kind: "notification" });
    // 서버가 보낸 ping 요청에는 클라이언트의 응답이 짝이 된다
    log = fold([ev("in", req(9, "ping")), ev("out", res(9, {}))], log);
    expect(log.entries[3]).toMatchObject({ dir: "out", kind: "response", method: "ping", status: "ok" });
    expect(log.entries[2]!.status).toBe("ok");
    expect(log.entries[0]!.status).toBe("pending");
  });

  it("turns a failed send into a transport error on the pending request without adding a row", () => {
    const message = req(4, "tools/call", { name: "x" });
    const log = fold([ev("out", message), ev("out", message, { sendError: "Failed to fetch" })]);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ status: "error", detail: "transport: Failed to fetch" });
  });

  it("redacts secret-looking params and results but measures the original size", () => {
    const message = req(1, "tools/call", { name: "x", arguments: { password: "pw_test_fixture", headers: { Authorization: "Bearer abcdef123456" } } });
    const log = fold([ev("out", message)]);
    expect(JSON.stringify(log.entries[0]!.message)).not.toContain("pw_test_fixture");
    expect(JSON.stringify(log.entries[0]!.message)).not.toContain("abcdef123456");
    expect(messageJson(log.entries[0]!)).toContain("[REDACTED]");
    expect(log.entries[0]!.bytes).toBe(new TextEncoder().encode(JSON.stringify(message)).length);
  });

  it("is a ring buffer: drops the oldest past the cap and counts them", () => {
    let log = emptyRpcLog();
    for (let i = 1; i <= RPC_LOG_MAX + 25; i += 1) log = appendRpc(log, ev("out", { jsonrpc: "2.0", method: `n/${i}` }));
    expect(log.entries).toHaveLength(RPC_LOG_MAX);
    expect(log.dropped).toBe(25);
    expect(log.entries[0]!.method).toBe("n/26");
    expect(log.entries.at(-1)!.method).toBe(`n/${RPC_LOG_MAX + 25}`);
  });

  it("ignores things that are not JSON-RPC and does not mutate the previous log", () => {
    const log = fold([ev("out", req(1, "tools/list"))]);
    expect(appendRpc(log, ev("in", "garbage"))).toBe(log);
    const before = log.entries[0]!;
    const next = appendRpc(log, ev("in", res(1, { tools: [{}, {}] })));
    expect(before.status).toBe("pending");
    expect(next.entries[0]!.status).toBe("ok");
    expect(next.entries[1]!.detail).toBe("2 tools");
  });

  it("filters by method, id, status and message text; all words must match", () => {
    const log = fold([
      ev("out", req(1, "tools/call", { name: "add" })),
      ev("in", res(1, { content: [] })),
      ev("out", req(2, "resources/read", { uri: "starter://about" })),
      ev("in", { jsonrpc: "2.0", id: 2, error: { code: -1, message: "boom" } }),
    ]);
    expect(filterRpc(log.entries, "")).toHaveLength(4);
    expect(filterRpc(log.entries, "resources/read")).toHaveLength(2);
    expect(filterRpc(log.entries, "starter://about")).toHaveLength(1);
    expect(filterRpc(log.entries, "error boom")).toHaveLength(1);
    expect(filterRpc(log.entries, "tools/call error")).toHaveLength(0);
  });

  it("exports the log as JSON and formats sizes", () => {
    const log = fold([ev("out", req(1, "ping"))]);
    const parsed = JSON.parse(exportRpcLog(log.entries));
    expect(parsed[0]).toMatchObject({ direction: "client->server", method: "ping", id: 1, status: "pending" });
    expect(parsed[0].message.method).toBe("ping");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
  });
});
