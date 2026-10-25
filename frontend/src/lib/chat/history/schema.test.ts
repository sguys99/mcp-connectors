import { describe, expect, it } from "vitest";

import {
  MAX_CONVERSATION_CHARS,
  MAX_RESULT_CHARS,
  MAX_TURNS,
  autoTitle,
  buildStoredConversation,
  deriveMeta,
  fitImported,
  matchesQuery,
  restoreTurns,
  upgradeRecord,
} from "./schema";
import { awaitingTurn, sampleConversation, toolTurn, userTurn } from "./fixtures";
import type { ChatTurn } from "@/lib/chat/serialize";

describe("autoTitle", () => {
  it("collapses whitespace and cuts long titles", () => {
    expect(autoTitle([userTurn("  List   the\nrepos ")])).toBe("List the repos");
    const long = "x".repeat(200);
    const title = autoTitle([userTurn(long)]);
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
  });
  it("is empty without a user turn", () => {
    expect(autoTitle([])).toBe("");
  });
});

describe("buildStoredConversation", () => {
  it("drops the signed token and browser clock values", () => {
    const record = sampleConversation({}, [userTurn("q"), awaitingTurn()]);
    const text = JSON.stringify(record);
    expect(text).not.toContain("signed.token.value");
    expect(text).not.toContain("waitStartClient");
    expect(text).not.toContain("clientAt");
    expect(record.turns[1]).toMatchObject({ stopReason: "awaiting_approval" });
  });

  it("computes total usage", () => {
    expect(sampleConversation().usage).toEqual({ input: 320, output: 70 });
  });

  it("truncates a huge tool result with a marker and flags the record", () => {
    const huge = "a".repeat(MAX_RESULT_CHARS + 5000);
    const record = sampleConversation({}, [userTurn("q"), toolTurn({ result: huge })]);
    const asst = record.turns[1];
    if (asst?.role !== "assistant") throw new Error("expected assistant");
    const content = asst.iterations[0]!.toolUses[0]!.result!.content;
    expect(content.length).toBeLessThan(huge.length);
    expect(content).toContain("truncated when saving");
    expect(record.truncated).toBe(true);
  });

  it("shrinks results step by step until the conversation fits the cap", () => {
    const turns = [userTurn("q")];
    for (let i = 0; i < 60; i++) turns.push({ ...toolTurn({ id: `a${i}`, result: "b".repeat(90_000) }) });
    const record = sampleConversation({}, turns);
    expect(JSON.stringify(record).length).toBeLessThanOrEqual(MAX_CONVERSATION_CHARS);
    expect(record.truncated).toBe(true);
  });

  it("truncates long message text when tool results alone cannot fit the cap", () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 10; i++) turns.push(userTurn("q".repeat(600_000), `u${i}`));
    const record = sampleConversation({}, turns);
    expect(JSON.stringify(record).length).toBeLessThanOrEqual(MAX_CONVERSATION_CHARS);
    expect(record.truncated).toBe(true);
    expect(record.turns).toHaveLength(10);
    const first = record.turns[0];
    expect(first?.role === "user" && first.content).toContain("characters omitted");
  });

  it("drops the oldest turns with a visible marker when there are too many turns", () => {
    const turns: ChatTurn[] = [];
    for (let i = 0; i < 6000; i++) turns.push(userTurn(`question ${i} ${"z".repeat(1500)}`, `u${i}`));
    const record = sampleConversation({}, turns);
    expect(JSON.stringify(record).length).toBeLessThanOrEqual(MAX_CONVERSATION_CHARS);
    expect(record.turns.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(record.truncated).toBe(true);
    const first = record.turns[0];
    if (first?.role !== "user") throw new Error("expected user");
    expect(first.content).toMatch(/truncated when saving: \d+ earlier turns omitted/);
    // 가장 최근 턴은 남는다
    const last = record.turns[record.turns.length - 1];
    expect(last?.role === "user" && last.content).toContain("question 5999");
    // 다시 읽을 수 있는 기록이다
    expect(upgradeRecord(record)).not.toBeNull();
  });

  it("keeps small conversations untouched", () => {
    const record = sampleConversation();
    expect(record.truncated).toBeUndefined();
  });
});

describe("upgradeRecord", () => {
  it("accepts the current version and strips unknown keys", () => {
    const raw = { ...sampleConversation(), extra: "x" };
    const out = upgradeRecord(raw);
    expect(out?.id).toBe("conv-1");
    expect(out && "extra" in out).toBe(false);
  });
  it("rejects unknown versions and broken records", () => {
    expect(upgradeRecord({ ...sampleConversation(), v: 2 })).toBeNull();
    expect(upgradeRecord({ ...sampleConversation(), turns: "nope" })).toBeNull();
    expect(upgradeRecord(null)).toBeNull();
  });
});

describe("restoreTurns", () => {
  it("expires a conversation saved while awaiting approval", () => {
    const restored = restoreTurns([userTurn("q"), awaitingTurn()]);
    const asst = restored[1];
    if (asst?.role !== "assistant") throw new Error("expected assistant");
    expect(asst.stopReason).toBe("aborted");
    expect(asst.expired).toBe(true);
    expect(asst.awaiting).toBeUndefined();
    const [pending, approved] = asst.iterations[0]!.toolUses;
    expect(pending!.approval).toBeUndefined();
    expect(pending!.result).toBeNull();
    expect(approved!.approval?.state).toBe("approved");
  });
  it("leaves finished turns alone", () => {
    const turns = [userTurn("q"), toolTurn()];
    expect(restoreTurns(turns)).toEqual(turns);
  });
});

describe("meta and search", () => {
  it("derives a summary with pending flag and tokens", () => {
    const meta = deriveMeta(sampleConversation({}, [userTurn("q"), awaitingTurn()]), 123);
    expect(meta.pending).toBe(true);
    expect(meta.size).toBe(123);
    expect(deriveMeta(sampleConversation(), 1).tokens).toBe(390);
  });
  it("matches every term against title and content, case-insensitively", () => {
    const meta = deriveMeta(sampleConversation(), 1);
    expect(matchesQuery(meta, "ALPHA-service")).toBe(true);
    expect(matchesQuery(meta, "repositories list_repositories")).toBe(true);
    expect(matchesQuery(meta, "repositories nonexistent-word")).toBe(false);
    expect(matchesQuery(meta, "   ")).toBe(true);
  });
});

describe("fitImported", () => {
  it("applies the same size cap to imported records", () => {
    const record = sampleConversation({}, [userTurn("q"), toolTurn({ result: "c".repeat(MAX_RESULT_CHARS + 10) })]);
    // 이미 잘린 기록을 만들지 않도록 원본을 직접 구성한다
    const big = { ...record, turns: [userTurn("q"), toolTurn({ result: "c".repeat(MAX_RESULT_CHARS + 10) })] };
    const fitted = fitImported(big);
    expect(fitted.truncated).toBe(true);
  });
});

describe("buildStoredConversation input", () => {
  it("never stores runtime server urls (names only)", () => {
    const record = buildStoredConversation({
      id: "c",
      createdAt: 1,
      updatedAt: 2,
      title: "t",
      titleAuto: false,
      provider: "openai",
      model: "gpt-4o",
      maxIterations: 3,
      approval: "manual",
      servers: ["a", "my-runtime"],
      runtimeServers: ["my-runtime"],
      allowedTools: [],
      turns: [userTurn("q")],
    });
    expect(record.runtimeServers).toEqual(["my-runtime"]);
    expect(Object.keys(record)).not.toContain("headers");
  });
});
