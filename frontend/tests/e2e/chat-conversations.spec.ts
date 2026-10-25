import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForShell } from "./helpers";

// Chat 대화 저장 회귀 (Phase 5-C, P5-7): IndexedDB 에 자동 저장, 목록, 새로고침 뒤 복원, ?c= 딥링크, 이름 바꾸기, 검색, 삭제,
// 내보내기(JSON, Markdown)와 가져오기, 승인 대기 만료, IndexedDB 를 쓸 수 없는 브라우저의 안내.
// 가짜 LLM(CHAT_MOCK_LLM=1)으로 돌린다. 개발 서버가 그 값 없이 떠 있으면 건너뛴다.
// 테스트마다 새 브라우저 컨텍스트라서 IndexedDB 는 비어 있는 채로 시작한다.

const CHAT_URL = "/chat?server=mock-repo-mcp";
const QUESTION = "[[tool:list_repositories]] [[sleep:30]]";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const list = (page: Page) => page.locator("[data-conversation-list]");
const rows = (page: Page) => list(page).locator("li[data-conversation-id]");
const titleOf = (page: Page, text: string | RegExp) => list(page).locator("[data-conversation-title]").filter({ hasText: text });
const card = (page: Page) => page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" });

async function openChat(page: Page, url = CHAT_URL) {
  await page.goto(url);
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  await waitForShell(page);
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

// 첫 대화를 하나 만들어 저장될 때까지 기다린다.
async function seedConversation(page: Page, text = QUESTION) {
  await ask(page, text);
  await expect(card(page).getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible();
  await expect(rows(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]c=/);
}

async function rowMenu(page: Page, index = 0) {
  await rows(page).nth(index).locator("[data-conversation-menu]").click();
}

test.beforeEach(async ({ page }) => {
  await openChat(page);
  const blocked = await page.getByText(/API key is not set/).isVisible();
  test.skip(blocked, "start the dev server with CHAT_MOCK_LLM=1 to run the Chat e2e");
});

test("empty list explains autosave; a run is saved with an auto title and survives a reload via ?c=", async ({ page }) => {
  await expect(list(page).locator("[data-conversations-empty]")).toBeVisible();

  await seedConversation(page);
  const row = rows(page).first();
  // 첫 질문에서 만든 제목, 모델, 토큰
  await expect(row.locator("[data-conversation-title]")).toHaveText(/^\[\[tool:list_repositories\]\]/);
  await expect(row).toContainText("claude-sonnet-4-6");
  await expect(row).toContainText(/tok/);
  await expect(row.locator("button").first()).toHaveAttribute("aria-current", "true");

  // 새로고침: 주소의 ?c= 로 같은 대화가 돌아온다 (도구 카드, 워터폴, 토큰 미터)
  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  await expect(card(page).getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toContainText("alpha-service");
  const waterfall = page.getByRole("region", { name: "Trace" }).getByRole("listbox", { name: /^Turn 1:/ });
  await expect(waterfall.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("group", { name: "Token usage" })).toContainText("3,000");
  await expect(rows(page)).toHaveCount(1);
});

test("the first run shows as a Running draft row instead of the empty state, then becomes the saved row", async ({ page }) => {
  await ask(page, "[[tool:list_repositories]] [[sleep:1500]]");
  const draft = list(page).locator("li[data-conversation-draft]");
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("Running");
  await expect(draft).toHaveAttribute("aria-current", "true");
  await expect(list(page).locator("[data-conversations-empty]")).toHaveCount(0);

  await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(draft).toHaveCount(0);
});

test("new chat starts empty, the old one opens from the list, and an unknown ?c= warns", async ({ page }) => {
  await seedConversation(page);
  const firstUrl = page.url();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Ask about your data")).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]c=/);
  await expect(rows(page)).toHaveCount(1);

  await rows(page).first().locator("button").first().click();
  await expect(card(page).getByText("done", { exact: true })).toBeVisible();
  expect(page.url()).toBe(firstUrl);

  await openChat(page, "/chat?c=does-not-exist&server=mock-repo-mcp");
  await expect(page.getByText("That conversation no longer exists.")).toBeVisible({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/[?&]c=/);
});

test("deep link opens a saved conversation in a fresh page and restores toolbar choices", async ({ page }) => {
  // 수동 승인으로 바꾼 값도 대화에 저장된다
  await page.getByRole("radio", { name: "Manual" }).click();
  await ask(page, "hello there");
  await expect(page.getByText(/Mock summary|hello/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1, { timeout: 10_000 });
  const url = page.url();

  await page.goto("/");
  await openChat(page, url);
  await expect(page.getByRole("radio", { name: "Manual" })).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
});

test("rename: dialog, persists across reload, and a manual name is kept on the next message", async ({ page }) => {
  await seedConversation(page);
  await rowMenu(page);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename conversation" });
  await dialog.getByLabel("Name").fill("Repository overview");
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(titleOf(page, "Repository overview")).toBeVisible();
  await expect(page.getByText("Conversation renamed")).toBeVisible();

  // 다음 메시지가 자동 제목으로 이름을 덮어쓰지 않는다
  await ask(page, "[[sleep:10]] second question");
  await expect(page.getByText(/second question/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(titleOf(page, "Repository overview")).toBeVisible({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(1);
});

test("search matches title and content, shows a no-match state, and clears", async ({ page }) => {
  await seedConversation(page);
  await page.getByRole("button", { name: "New chat" }).click();
  await ask(page, "[[sleep:10]] something about widgets");
  await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });

  const search = page.getByRole("searchbox", { name: "Search conversations by title or content" });
  await search.fill("widgets");
  await expect(rows(page)).toHaveCount(1);
  await expect(titleOf(page, /widgets/)).toBeVisible();

  // 도구 이름처럼 제목에 없는 내용도 찾는다
  await search.fill("list_repositories");
  await expect(rows(page)).toHaveCount(1);
  await expect(titleOf(page, /list_repositories/)).toBeVisible();

  await search.fill("zzz-nothing");
  await expect(rows(page)).toHaveCount(0);
  await expect(list(page).locator("[data-conversations-nomatch]")).toContainText("zzz-nothing");

  await search.fill("");
  await expect(rows(page)).toHaveCount(2);
});

test("delete asks for confirmation; cancel keeps it, confirm removes it and clears the thread", async ({ page }) => {
  await seedConversation(page);
  await rowMenu(page);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this conversation?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page)).toHaveCount(1);

  await rowMenu(page);
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("Conversation deleted")).toBeVisible();
  await expect(page.getByText("Ask about your data")).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]c=/);

  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  await expect(list(page).locator("[data-conversations-empty]")).toBeVisible();
});

test("export JSON then import it back adds a second copy; Markdown has the transcript", async ({ page }) => {
  await seedConversation(page);

  // JSON 내보내기
  await rowMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export conversation" });
  await expect(exportDialog).toContainText("[REDACTED]");
  await exportDialog.getByRole("radio", { name: /JSON/ }).click();
  const jsonPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download" }).click();
  const jsonDownload = await jsonPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  const jsonPath = await jsonDownload.path();
  const envelope = JSON.parse(readFileSync(jsonPath, "utf8"));
  expect(envelope.format).toBe("mcp-connectors.conversations");
  expect(envelope.version).toBe(1);
  expect(envelope.conversations).toHaveLength(1);
  expect(envelope.conversations[0].turns).toHaveLength(2);
  expect(envelope.conversations[0].usage.input).toBeGreaterThan(0);
  // 승인 토큰이나 헤더 값 같은 것은 없다
  expect(JSON.stringify(envelope)).not.toMatch(/awaiting|waitStartClient/);

  // Markdown 내보내기
  await rowMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  const mdDialog = page.getByRole("dialog", { name: "Export conversation" });
  const mdPromise = page.waitForEvent("download");
  await mdDialog.getByRole("button", { name: "Download" }).click();
  const mdDownload = await mdPromise;
  expect(mdDownload.suggestedFilename()).toMatch(/\.md$/);
  const md = readFileSync((await mdDownload.path())!, "utf8");
  expect(md).toContain("- Model: anthropic / claude-sonnet-4-6");
  expect(md).toContain("- Tokens: ");
  expect(md).toContain("## User");
  expect(md).toContain("### Tool call: mock-repo-mcp / list_repositories (done)");
  expect(md).toContain("```json");
  expect(md).toContain("alpha-service");
  expect(md).toMatch(/Mock summary of 1 tool call/);

  // 가져오기: 형식이 맞지 않는 파일은 이유를 보여 준다
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import…" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import conversations" });
  await importDialog.locator("[data-import-input]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(importDialog.locator("[data-import-result]")).toContainText("not a conversation export");
  await expect(importDialog.getByRole("button", { name: /^Import \d/ })).toBeDisabled();

  await importDialog.locator("[data-import-input]").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "mcp-connectors.conversations", version: 9, conversations: [] })),
  });
  await expect(importDialog.locator("[data-import-result]")).toContainText("format version 9");

  // 맞는 파일: 새 id 의 사본이 목록에 추가된다
  await importDialog.locator("[data-import-input]").setInputFiles(jsonPath);
  await expect(importDialog.locator("[data-import-result]")).toContainText("1 conversation is ready");
  await importDialog.getByRole("button", { name: "Import 1" }).click();
  await expect(page.getByText("Imported 1 conversation")).toBeVisible();
  await expect(rows(page)).toHaveCount(2, { timeout: 10_000 });
  const ids = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-conversation-id")));
  expect(new Set(ids).size).toBe(2);

  // 가져온 대화를 열어도 아무것도 실행되지 않고 내용이 그대로 보인다
  await rows(page).nth(1).locator("button").first().click();
  await expect(card(page)).toContainText("alpha-service");
});

test("a conversation saved while awaiting approval reopens as expired and does not crash", async ({ page }) => {
  await page.getByRole("radio", { name: "Manual" }).click();
  await ask(page, "[[tool:list_repositories]] [[sleep:30]]");
  await expect(page.getByRole("group", { name: "Waiting for your approval" })).toBeVisible({ timeout: 15_000 });
  // 승인 대기 중에도 저장된다
  await expect(rows(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(rows(page).first()).toContainText("Awaiting approval");

  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-approval-expired]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("group", { name: "Waiting for your approval" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(card(page).getByText("cancelled", { exact: true })).toBeVisible();
  await expect(rows(page).first()).toContainText("Approval expired");

  // 이어서 질문하면 정상 동작한다 (만료된 호출은 기록에서 빠진다)
  await page.getByRole("radio", { name: "Auto" }).click();
  await ask(page, "[[sleep:10]] follow up");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("follow up").first()).toBeVisible();
});

test("clearing the chat removes the saved copy too", async ({ page }) => {
  await seedConversation(page);
  await page.getByRole("button", { name: "Clear chat" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]c=/);
});

test("another tab sees a new conversation without reloading", async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto(CHAT_URL);
  await expect(other.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 20_000 });
  await expect(other.locator("[data-conversations-empty]")).toBeVisible();

  await seedConversation(page);
  await expect(other.locator("li[data-conversation-id]")).toHaveCount(1, { timeout: 10_000 });
});

test.describe("IndexedDB unavailable", () => {
  test("the list shows a notice and Chat keeps working without saving", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    await openChat(page);
    const blocked = await page.getByText(/API key is not set/).isVisible();
    test.skip(blocked, "start the dev server with CHAT_MOCK_LLM=1 to run the Chat e2e");

    await expect(page.locator("[data-conversations-unavailable]")).toContainText("Conversations are not saved");
    await expect(page.getByText("Conversations are not saved in this browser.")).toBeVisible();
    await ask(page, QUESTION);
    await expect(card(page).getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]c=/);
    await context.close();
  });
});
