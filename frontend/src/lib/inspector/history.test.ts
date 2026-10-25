import { beforeEach, describe, expect, it } from "vitest";

import type { CallResult, CallToolPayload } from "@/lib/mcp/types";
import type { CallPayload } from "@/components/inspector/types";

import {
  applyCaps,
  buildHistoryEntry,
  clearHistory,
  HISTORY_KEY,
  HISTORY_PER_SERVER_MAX,
  HISTORY_TOTAL_MAX,
  loadHistory,
  parseHistory,
  pushHistory,
  removeHistory,
  summarizeArgs,
  type HistoryEntry,
} from "./history";

beforeEach(() => localStorage.clear());

const okTool = (content: unknown): CallResult<CallPayload> => ({
  content,
  isError: false,
  durationMs: 12,
  detail: { outcome: "ok", payload: { content: [] } as CallToolPayload, elapsedMs: 11.6 },
});

const entry = (server: string, i: number): HistoryEntry =>
  buildHistoryEntry({ server, method: "tools/call", target: "add", args: { a: i }, result: okTool({ result: i }), now: new Date(2026, 9, 23, 0, 0, i) });

describe("buildHistoryEntry", () => {
  it("records a successful tool call with the observed response", () => {
    const e = buildHistoryEntry({ server: "s", method: "tools/call", target: "add", args: { a: 2, b: 3 }, result: okTool({ result: 5 }) });
    expect(e).toMatchObject({ server: "s", kind: "tool", target: "add", args: { a: 2, b: 3 }, outcome: "ok", status: "ok", durationMs: 12, observed: { result: 5 } });
    expect(e.id).toBeTruthy();
    expect(e.redacted).toBeUndefined();
  });

  it("records isError results with the [CODE] tag and message", () => {
    const result: CallResult<CallPayload> = {
      content: [{ type: "text", text: "text is required [INVALID_INPUT]" }],
      isError: true,
      durationMs: 3,
      detail: { outcome: "tool-error", payload: { content: [{ type: "text", text: "text is required [INVALID_INPUT]" }], isError: true } as CallToolPayload, elapsedMs: 3 },
    };
    const e = buildHistoryEntry({ server: "s", method: "tools/call", target: "echo", args: { text: "" }, result });
    expect(e).toMatchObject({ status: "error", outcome: "tool-error", errorCode: "INVALID_INPUT", errorMessage: "text is required [INVALID_INPUT]" });
  });

  it("records cancelled and transport failures without an observed response", () => {
    const cancelled = buildHistoryEntry({
      server: "s", method: "tools/call", target: "slow", args: {},
      result: { content: "aborted", isError: true, durationMs: 50, detail: { outcome: "cancelled", elapsedMs: 50 } },
    });
    expect(cancelled).toMatchObject({ status: "cancelled", outcome: "cancelled" });
    expect(cancelled.observed).toBeUndefined();
  });

  it("shapes resources and prompts like the scenario response and drops binary data", () => {
    const res = buildHistoryEntry({
      server: "s", method: "resources/read", target: "starter://logo", args: {},
      result: { content: [], isError: false, durationMs: 4, detail: { outcome: "ok", payload: { contents: [{ uri: "starter://logo", mimeType: "image/png", blob: "AAAA".repeat(500) }] }, elapsedMs: 4 } },
    });
    expect(res.kind).toBe("resource");
    expect(res.observed).toEqual({ contents: [{ uri: "starter://logo", mimeType: "image/png", blob: "[omitted]" }] });
    const prm = buildHistoryEntry({
      server: "s", method: "prompts/get", target: "explain_tool", args: { tool_name: "add" },
      result: { content: [], isError: false, durationMs: 4, detail: { outcome: "ok", payload: { description: "d", messages: [{ role: "user", content: { type: "text", text: "hi" } }] }, elapsedMs: 4 } },
    });
    expect(prm.observed).toEqual({ description: "d", messages: [{ role: "user", content: { type: "text", text: "hi" } }] });
  });

  it("redacts secret inputs, flags the entry and clips long strings", () => {
    const e = buildHistoryEntry({ server: "s", method: "tools/call", target: "login", args: { user: "kim", password: "pw_test_fixture" }, result: okTool({ note: "x".repeat(500) }) });
    expect(e.args).toEqual({ user: "kim", password: "[REDACTED]" });
    expect(e.redacted).toBe(true);
    expect(JSON.stringify(e)).not.toContain("pw_test_fixture");
    expect((e.observed as { note: string }).note.length).toBeLessThanOrEqual(200);
  });

  it("drops an oversized observed response instead of storing it", () => {
    const big = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`k${i}`, "y".repeat(190)]));
    const e = buildHistoryEntry({ server: "s", method: "tools/call", target: "t", args: {}, result: okTool(big) });
    expect(e.observed).toBeUndefined();
  });
});

describe("history store", () => {
  it("pushes newest first and persists", () => {
    pushHistory(entry("a", 1));
    pushHistory(entry("a", 2));
    const list = loadHistory();
    expect(list.map((e) => e.args.a)).toEqual([2, 1]);
    expect(localStorage.getItem(HISTORY_KEY)).toContain('"server":"a"');
  });

  it("caps per server and in total, dropping the oldest", () => {
    for (let i = 0; i < HISTORY_PER_SERVER_MAX + 10; i += 1) pushHistory(entry("a", i));
    pushHistory(entry("b", 1));
    const list = loadHistory();
    expect(list.filter((e) => e.server === "a")).toHaveLength(HISTORY_PER_SERVER_MAX);
    expect(list.filter((e) => e.server === "a")[0]!.args.a).toBe(HISTORY_PER_SERVER_MAX + 9);
    expect(list.filter((e) => e.server === "b")).toHaveLength(1);

    const many: HistoryEntry[] = Array.from({ length: HISTORY_TOTAL_MAX + 40 }, (_, i) => entry(`srv${i % 8}`, i)).reverse();
    expect(applyCaps(many).length).toBeLessThanOrEqual(HISTORY_TOTAL_MAX);
  });

  it("removes one entry, clears one server, then everything", () => {
    pushHistory(entry("a", 1));
    const kept = pushHistory(entry("b", 2));
    expect(removeHistory(kept[0]!.id)).toHaveLength(1);
    pushHistory(entry("a", 3));
    expect(clearHistory("a").every((e) => e.server !== "a")).toBe(true);
    pushHistory(entry("a", 4));
    expect(clearHistory()).toEqual([]);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it("skips unreadable items (including the old recentCalls shape) and survives bad JSON", () => {
    const good = entry("a", 1);
    const old = { ts: "2026-01-01T00:00:00Z", server: "s", tool: "echo", params: {}, status: "ok", durationMs: 5 };
    expect(parseHistory(JSON.stringify([old, good, 42]))).toEqual([good]);
    expect(parseHistory("{nope")).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });

  it("summarizes arguments per kind", () => {
    expect(summarizeArgs(entry("a", 1))).toBe('{"a":1}');
    expect(summarizeArgs({ ...entry("a", 1), kind: "resource", target: "starter://about" })).toBe("starter://about");
  });
});
