import { describe, expect, it, vi } from "vitest";

import type { ToolMeta } from "@/lib/mcp/types";

import type { LLMEvent } from "./adapter";
import { createMockAdapter, isMockLlmEnabled, parseMockPlan } from "./mock";

const tools: ToolMeta[] = [
  { name: "list_repositories", description: "", inputSchema: {} },
  { name: "echo", description: "", inputSchema: {} },
];

async function collect(iter: AsyncIterable<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe("isMockLlmEnabled", () => {
  it("is off unless CHAT_MOCK_LLM is 1 or true", () => {
    expect(isMockLlmEnabled({})).toBe(false);
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM: "0" })).toBe(false);
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM: "1" })).toBe(true);
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM: "TRUE" })).toBe(true);
  });

  it("is refused in production unless CHAT_MOCK_LLM_ALLOW_PRODUCTION is also set", () => {
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM: "1", NODE_ENV: "production" })).toBe(false);
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM_ALLOW_PRODUCTION: "1", NODE_ENV: "production" })).toBe(false);
    expect(isMockLlmEnabled({ CHAT_MOCK_LLM: "1", CHAT_MOCK_LLM_ALLOW_PRODUCTION: "1", NODE_ENV: "production" })).toBe(true);
  });
});

describe("parseMockPlan", () => {
  it("reads tool, sleep, loop and error directives", () => {
    const plan = parseMockPlan('[[tool:echo {"text":"hi"}]] [[tool:list_repositories]] [[sleep:50]] [[loop]]', []);
    expect(plan.calls).toEqual([
      { name: "echo", input: { text: "hi" } },
      { name: "list_repositories", input: {} },
    ]);
    expect(plan).toMatchObject({ sleepMs: 50, loop: true, error: null });
    expect(parseMockPlan("[[error:boom]]", []).error).toBe("boom");
  });

  it("finds the prefixed name when several servers are exposed", () => {
    const names = ["starter-mcp-http__echo", "mock-repo-mcp__list_repositories"];
    expect(parseMockPlan("[[tool:list_repositories]]", names).calls[0]?.name).toBe("mock-repo-mcp__list_repositories");
    // 접미가 같은 도구가 둘이면 고르지 못하므로 그대로 둔다 (모르는 도구 오류 경로)
    expect(parseMockPlan("[[tool:echo]]", ["a__echo", "b__echo"]).calls[0]?.name).toBe("echo");
  });

  it("picks a default call from the exposed tools when there is no directive", () => {
    expect(parseMockPlan("anything", ["a__run_sql_query"]).calls[0]?.name).toBe("a__run_sql_query");
    expect(parseMockPlan("anything", ["list_repositories"]).calls).toEqual([{ name: "list_repositories", input: {} }]);
    expect(parseMockPlan("hello", ["echo"]).calls).toEqual([{ name: "echo", input: { text: "hello" } }]);
    expect(parseMockPlan("hello", []).calls).toEqual([]);
  });
});

describe("createMockAdapter", () => {
  it("emits the same event shapes as the real adapters and finishes with end_turn", async () => {
    const onToolCall = vi.fn().mockResolvedValue({ content: '{"total_count":3}', isError: false });
    const events = await collect(
      createMockAdapter().chatWithTools({
        system: "",
        messages: [{ role: "user", content: "[[tool:list_repositories]] [[sleep:1]]" }],
        tools,
        onToolCall,
        maxIterations: 5,
      }),
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["iteration", "text_delta", "tool_use", "tool_result", "done"]),
    );
    expect(onToolCall).toHaveBeenCalledWith("list_repositories", {});
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("stops at maxIterations when looping", async () => {
    const events = await collect(
      createMockAdapter().chatWithTools({
        system: "",
        messages: [{ role: "user", content: "[[tool:echo]] [[loop]] [[sleep:1]]" }],
        tools,
        onToolCall: async () => ({ content: "x", isError: false }),
        maxIterations: 2,
      }),
    );
    expect(events.filter((e) => e.type === "tool_use")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "max_iterations" });
  });

  it("ends with an error event when aborted while waiting", async () => {
    const controller = new AbortController();
    const pending = collect(
      createMockAdapter().chatWithTools({
        system: "",
        messages: [{ role: "user", content: "[[sleep:5000]]" }],
        tools,
        onToolCall: async () => ({ content: "", isError: false }),
        signal: controller.signal,
      }),
    );
    setTimeout(() => controller.abort(), 10);
    const events = await pending;
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "error" });
  });
});

describe("mock adapter: usage and approval (P5-6)", () => {
  const base = {
    system: "",
    tools,
    onToolCall: async () => ({ content: "ok", isError: false }),
  };

  it("reports deterministic usage per iteration; [[usage:off]] reports none; [[usage:cache]] adds cache tokens", async () => {
    const run = (text: string) => collect(createMockAdapter().chatWithTools({ ...base, messages: [{ role: "user", content: text }] }));
    const events = await run("[[tool:echo]]");
    expect(events.filter((e) => e.type === "usage")).toEqual([
      { type: "usage", usage: { input: 1000, output: 50 } },
      { type: "usage", usage: { input: 2000, output: 100 } },
    ]);
    expect((await run("[[tool:echo]] [[usage:off]]")).some((e) => e.type === "usage")).toBe(false);
    expect((await run("[[tool:echo]] [[usage:cache]]")).find((e) => e.type === "usage")).toEqual({
      type: "usage",
      usage: { input: 1400, output: 50, cacheRead: 300, cacheWrite: 100 },
    });
    // 사용량 지시문만 있어도 기본 계획(도구 호출)은 그대로 쓴다
    expect((await run("hello [[usage:off]]")).some((e) => e.type === "tool_use")).toBe(true);
  });

  it("stops for approval before running tools, and a resumed request continues from the next iteration", async () => {
    const onToolCall = vi.fn(async () => ({ content: "ok", isError: false }));
    const first = await collect(
      createMockAdapter().chatWithTools({
        ...base,
        onToolCall,
        requireApproval: () => true,
        messages: [{ role: "user", content: '[[tool:echo {"text":"a"}]] [[tool:list_repositories]]' }],
      }),
    );
    expect(onToolCall).not.toHaveBeenCalled();
    const approval = first.find((e) => e.type === "approval_required");
    expect(approval).toMatchObject({ iterationsUsed: 1, calls: [{ id: "mock-0-0", name: "echo" }, { id: "mock-0-1", name: "list_repositories" }] });
    expect(first.at(-1)).toEqual({ type: "done", stopReason: "awaiting_approval" });

    const resumed = await collect(
      createMockAdapter().chatWithTools({
        ...base,
        iterationOffset: 1,
        messages: [
          { role: "user", content: '[[tool:echo {"text":"a"}]] [[tool:list_repositories]]' },
          { role: "assistant", content: "", toolUses: [{ id: "mock-0-0", name: "echo", input: { text: "a" } }, { id: "mock-0-1", name: "list_repositories", input: {} }] },
          { role: "tool_result", toolUseId: "mock-0-0", content: "ok", isError: false },
          { role: "tool_result", toolUseId: "mock-0-1", content: "denied", isError: true },
        ],
      }),
    );
    expect(resumed[0]).toEqual({ type: "iteration", index: 1 });
    expect(resumed.find((e) => e.type === "usage")).toEqual({ type: "usage", usage: { input: 2000, output: 100 } });
    const text = resumed.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("Mock summary of 2 tool calls");
    expect(text).toContain("`list_repositories` (isError)");
  });
});
