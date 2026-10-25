import { describe, expect, it } from "vitest";

import { awaitingTurn, sampleConversation, toolTurn, userTurn } from "./fixtures";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  assignImportIds,
  buildExport,
  conversationToMarkdown,
  exportFileName,
  exportJson,
  MAX_IMPORT_BYTES,
  exceedsImportLimit,
  parseImport,
  redactContent,
  redactText,
  utf8ByteLength,
  type MarkdownLabels,
} from "./export";
import { REDACTED } from "@/lib/inspector/redact";

const labels: MarkdownLabels = {
  exported: "Exported",
  model: "Model",
  servers: "Servers",
  runtimeServers: "Runtime servers (names only)",
  approval: "Tool approval",
  approvalAuto: "auto",
  approvalManual: "manual",
  tokens: "Tokens",
  tokensInOut: (i, o) => `${i} in, ${o} out`,
  tokensNone: "not reported",
  user: "User",
  assistant: "Assistant",
  toolCall: "Tool call",
  arguments: "Arguments",
  result: "Result",
  error: "Error",
  status: { done: "done", error: "isError", denied: "denied", cancelled: "did not run" },
  stopped: "Stopped by the user.",
  stoppedMax: "Stopped at the max iterations limit.",
  expired: "Approval expired.",
  untitled: "Untitled",
  truncated: "Some results were trimmed.",
};

const NOW = new Date("2026-10-23T09:00:00.000Z");

describe("markdown export", () => {
  it("writes a readable transcript with tool calls in fenced blocks and token totals", () => {
    const md = conversationToMarkdown(sampleConversation(), labels, NOW);
    expect(md).toContain("# List the repositories");
    expect(md).toContain("- Model: anthropic / claude-sonnet-4-6");
    expect(md).toContain("- Tokens: 320 in, 70 out");
    expect(md).toContain("## User");
    expect(md).toContain("### Tool call: mock-repo-mcp / list_repositories (done)");
    expect(md).toContain("```json\n{\n  \"limit\": 5\n}\n```");
    expect(md).toContain('"repos": [');
    expect(md).toContain("There is one repository: alpha-service.");
  });

  it("uses a longer fence when the content has backticks", () => {
    const record = sampleConversation({}, [userTurn("q"), toolTurn({ result: "text with ``` inside" })]);
    const md = conversationToMarkdown(record, labels, NOW);
    expect(md).toContain("````text\ntext with ``` inside\n````");
  });

  it("notes an expired approval and a denied or unrun call", () => {
    const md = conversationToMarkdown(sampleConversation({}, [userTurn("q"), { ...awaitingTurn(), stopReason: "aborted", expired: true }]), labels, NOW);
    expect(md).toContain("> Approval expired.");
    expect(md).toContain("(did not run)");
  });

  it("redacts secret-looking values", () => {
    const record = sampleConversation({}, [
      userTurn("use Bearer abcdefghijklmnop_test_fixture please"),
      toolTurn({ input: { api_key: "abc_test_fixture", q: "ok" }, result: JSON.stringify({ token: "zzz_test_fixture", rows: 3 }) }),
    ]);
    const md = conversationToMarkdown(record, labels, NOW);
    expect(md).not.toContain("_test_fixture");
    expect(md).toContain(REDACTED);
    expect(md).toContain('"q": "ok"');
    expect(md).toContain('"rows": 3');
  });
});

describe("redaction", () => {
  it("redactContent keeps non-secret JSON untouched and masks secret keys", () => {
    const plain = '{"a":1}';
    expect(redactContent(plain)).toBe(plain);
    expect(redactContent('{"password":"x_test_fixture","a":1}')).toContain(REDACTED);
    expect(redactContent('{"password":"x_test_fixture","a":1}')).not.toContain("x_test_fixture");
  });
  it("redactText masks Bearer, sk- and JWT shapes", () => {
    expect(redactText("Authorization: Bearer abcdefgh12345678_test_fixture")).not.toContain("abcdefgh12345678");
    expect(redactText("key sk-ant-abcdefghijklmnopqrstuvwxyz_test_fixture")).toContain(REDACTED);
    expect(redactText("eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJl_test_fixture")).toContain(REDACTED);
  });
  it("redactText masks URL userinfo and query secrets in place", () => {
    expect(redactText("open https://u:p_test_fixture@h.example/x?token=t_test_fixture&page=2")).toBe(
      `open https://u:${REDACTED}@h.example/x?token=${REDACTED}&page=2`,
    );
  });
});

describe("json export and import", () => {
  it("has a versioned envelope and round-trips a conversation", () => {
    const record = sampleConversation();
    const env = buildExport([record], NOW);
    expect(env.format).toBe(EXPORT_FORMAT);
    expect(env.version).toBe(EXPORT_VERSION);
    expect(env.exportedAt).toBe(NOW.toISOString());
    const preview = parseImport(exportJson([record], NOW));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.invalid).toBe(0);
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0]!.turns).toEqual(record.turns);
    expect(preview.valid[0]!.usage).toEqual(record.usage);
  });

  it("strips secrets in the JSON export too", () => {
    const record = sampleConversation({}, [userTurn("q"), toolTurn({ input: { authorization: "Bearer abcdefghij_test_fixture" } })]);
    const text = exportJson([record], NOW);
    expect(text).not.toContain("_test_fixture");
  });

  it("rejects invalid JSON, foreign files, and unknown versions with a code", () => {
    expect(parseImport("{not json")).toEqual({ ok: false, code: "invalidJson" });
    expect(parseImport(JSON.stringify({ hello: "world" }))).toEqual({ ok: false, code: "notExport" });
    expect(parseImport(JSON.stringify({ format: "other", version: 1, conversations: [] }))).toEqual({ ok: false, code: "notExport" });
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 2, conversations: [] }))).toEqual({ ok: false, code: "unsupportedVersion", version: 2 });
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, conversations: [] }))).toEqual({ ok: false, code: "empty" });
  });

  it("separates valid and invalid conversations and reports the first issue", () => {
    const good = sampleConversation();
    const bad = { ...sampleConversation({ id: "bad" }), provider: "nope" };
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: NOW.toISOString(), conversations: [good, bad, 42] });
    const result = parseImport(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valid.map((c) => c.id)).toEqual(["conv-1"]);
    expect(result.invalid).toBe(2);
    expect(result.firstIssue).toContain("provider");
  });

  it("drops unknown keys from imported records (nothing extra is carried in)", () => {
    const record = { ...sampleConversation(), onload: "alert(1)", turns: sampleConversation().turns };
    const result = parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, conversations: [record] }));
    expect(result.ok && "onload" in result.valid[0]!).toBe(false);
  });

  it("imports a pending approval as plain data (the signed token is not carried)", () => {
    const record = sampleConversation({}, [userTurn("q"), awaitingTurn()]);
    const result = parseImport(exportJson([record], NOW));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("signed.token.value");
  });

  it("assigns new ids on conflict, including duplicates inside the file", () => {
    const a = sampleConversation({ id: "same" });
    const b = sampleConversation({ id: "same" });
    const c = sampleConversation({ id: "fresh" });
    const out = assignImportIds([a, b, c], new Set(["same"]));
    expect(out[0]!.id).not.toBe("same");
    expect(out[1]!.id).not.toBe("same");
    expect(out[0]!.id).not.toBe(out[1]!.id);
    expect(out[2]!.id).toBe("fresh");
  });
});

describe("exportFileName", () => {
  it("builds a safe name with the date", () => {
    expect(exportFileName("List the repositories!", "md", NOW)).toBe("List-the-repositories-2026-10-23.md");
    expect(exportFileName("대화 목록", "json", NOW)).toBe("대화-목록-2026-10-23.json");
    expect(exportFileName("///", "json", NOW)).toBe("conversation-2026-10-23.json");
  });
});

describe("import size limit", () => {
  it("counts UTF-8 bytes like TextEncoder", () => {
    for (const text of ["abc", "한글", "emoji 😀", "\ud800 lone"]) {
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
  it("rejects text whose byte size exceeds the cap even when its character count does not", () => {
    // 한글 한 글자는 3바이트: 글자 수는 상한 아래, 바이트 수는 상한 위
    const text = "가".repeat(Math.floor(MAX_IMPORT_BYTES / 2));
    expect(text.length).toBeLessThan(MAX_IMPORT_BYTES);
    expect(exceedsImportLimit(text)).toBe(true);
    expect(parseImport(text)).toEqual({ ok: false, code: "tooLarge" });
    expect(exceedsImportLimit("가".repeat(1000))).toBe(false);
  });
});
