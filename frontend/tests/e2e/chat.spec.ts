import { expect, test, type Page } from "@playwright/test";

// Chat 회귀 (Phase 4-B P4-7). 실제 LLM 없이 가짜 LLM(CHAT_MOCK_LLM=1, src/lib/llm/mock.ts)으로 돌린다.
// 도구 호출은 진짜 MCP 서버(mock-repo-mcp, global-setup 이 띄움)로 가므로 SSE 서버 시각, 도구 카드, trace 가 실측이다.
//
// 가짜 LLM 의 지시문 ([[tool:NAME {json}]], [[sleep:MS]], [[loop]]) 은 src/lib/llm/mock.ts 맨 위 주석에 있다.
// 개발 서버를 CHAT_MOCK_LLM=1 없이 미리 띄워 둔 경우에는 이 파일을 건너뛴다.

const CHAT_URL = "/chat?server=mock-repo-mcp";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

async function openChat(page: Page) {
  await page.goto(CHAT_URL);
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await openChat(page);
  // 키가 없고 가짜 LLM 도 꺼져 있으면 API 키 안내가 뜬다. 이때는 시험할 수 없다.
  const blocked = await page.getByText(/API key is not set/).isVisible();
  test.skip(blocked, "start the dev server with CHAT_MOCK_LLM=1 to run the Chat e2e");
});

test("tool call run: card, SSE-timed trace, summary and copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ask(page, "[[tool:list_repositories]] [[sleep:150]]");

  // 도구 카드: 서버 / 도구, 상태 칩, 소요 시간
  const card = page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("alpha-service");

  // 답변과 푸터
  await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible();

  // trace: 실행 번호, LLM 2번과 도구 1번이 실측 시각으로 그려진다
  const trace = page.getByRole("region", { name: "Trace" });
  await expect(trace.getByText("run #1")).toBeVisible();
  const waterfall = trace.getByRole("listbox", { name: /^Turn 1:/ });
  const rows = waterfall.getByRole("option");
  await expect(rows).toHaveCount(3);
  const tool = waterfall.getByRole("option", { name: /list_repositories mock-repo-mcp/ });
  await expect(tool).toBeVisible();

  // 시간은 서버가 잰 실측이다. 가짜 LLM 이 150ms 기다렸으니 LLM #1 은 그보다 길고, 도구 호출은 그보다 훨씬 짧다.
  const durationOf = async (row: typeof tool) => {
    const name = (await row.getAttribute("aria-label")) ?? "";
    const m = /, (\d+(?:\.\d+)?) (ms|s)\b/.exec(name);
    expect(m, name).not.toBeNull();
    return Number(m![1]) * (m![2] === "s" ? 1000 : 1);
  };
  expect(await durationOf(rows.nth(0))).toBeGreaterThanOrEqual(150);
  const toolMs = await durationOf(tool);
  expect(toolMs).toBeGreaterThan(0);
  expect(toolMs).toBeLessThan(150);

  // 요약
  await expect(trace.getByText("tool calls", { exact: true })).toBeVisible();
  await expect(trace.getByText("2 / 5")).toBeVisible();

  // 상단 상태바에 마지막 호출 시간이 올라간다
  await expect(page.getByRole("contentinfo").getByText(/last \d+ ms/)).toBeVisible();

  // 메시지 복사 (끝난 메시지의 푸터에 복사 버튼이 붙는다)
  await expect(page.getByText("1 tool call", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy message" }).last().click();
  await expect(page.getByText("Copied to clipboard").first()).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("Mock summary of 1 tool call");
});

test("card and span are linked in both directions", async ({ page }) => {
  await ask(page, "[[tool:list_repositories]] [[sleep:50]]");
  const card = page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" });
  await expect(card.getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });

  const trace = page.getByRole("region", { name: "Trace" });
  const toolRow = trace.getByRole("option", { name: /list_repositories mock-repo-mcp/ });

  // 카드의 "추적에서 보기" -> 스팬이 선택되고 상세에 입력과 결과가 보인다
  await card.getByRole("button", { name: "Show in trace" }).click();
  await expect(toolRow).toHaveAttribute("aria-selected", "true");
  const detail = page.getByRole("region", { name: "Span details" });
  await expect(detail.getByRole("heading", { name: "mock-repo-mcp / list_repositories" })).toBeVisible();
  await expect(detail).toContainText("alpha-service");
  await expect(card).toHaveAttribute("data-selected", "true");

  // 다른 스팬(LLM #1)을 고르면 카드 강조가 풀리고, 도구 스팬을 다시 고르면 카드가 강조된다
  await trace.getByRole("option", { name: /^LLM, LLM #1/ }).click();
  await expect(card).not.toHaveAttribute("data-selected", "true");
  await expect(detail.getByRole("heading", { name: "claude-sonnet-4-6" })).toBeVisible();
  await toolRow.click();
  await expect(card).toHaveAttribute("data-selected", "true");

  // 스팬 위에 마우스를 올리면 카드가 연하게 강조된다
  await trace.getByRole("option", { name: /^LLM, LLM #2/ }).hover();
  await expect(card).not.toHaveAttribute("data-linked", "true");
  await toolRow.hover();
  await expect(card).toHaveAttribute("data-linked", "true");
});

test("isError result shows an isError card and an error span", async ({ page }) => {
  await ask(page, '[[tool:list_repositories {"limit":-1}]] [[sleep:20]]');
  const card = page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" });
  await expect(card.getByText("isError", { exact: true })).toBeVisible({ timeout: 15_000 });
  const trace = page.getByRole("region", { name: "Trace" });
  await expect(trace.getByRole("option", { name: /list_repositories mock-repo-mcp, .*Failed$/ })).toBeVisible();
});

test("Stop (Esc) cancels the run and keeps what was received", async ({ page }) => {
  await ask(page, "[[sleep:9000]]");
  const stop = page.getByRole("button", { name: "Stop the run" });
  await expect(stop).toBeVisible();
  // 진행 중에는 LLM 스팬이 running 으로 자란다
  const trace = page.getByRole("region", { name: "Trace" });
  await expect(trace.getByRole("option", { name: /^LLM, LLM #1, .*Running$/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Stopped by you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  // 포커스는 입력창으로 돌아간다
  await expect(composer(page)).toBeFocused();
  // 멈춘 LLM 스팬은 취소로 표시된다
  await expect(trace.getByRole("option", { name: /^LLM, LLM #1, .*Cancelled$/ })).toBeVisible();

  // 이어서 다시 물을 수 있고, 멈춘 턴이 요청을 깨뜨리지 않는다
  await ask(page, "hello again");
  await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });
});

test("iteration limit shows the stopped-after notice", async ({ page }) => {
  await ask(page, "[[tool:list_repositories]] [[loop]] [[sleep:5]]");
  await expect(page.getByText(/Stopped after 5 iterations/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Trace" }).getByText("5 / 5")).toBeVisible();
});

test("clear chat asks for confirmation, then clears with a toast", async ({ page }) => {
  await ask(page, "hello");
  await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Clear chat" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  // 취소하면 대화가 그대로다
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("log").getByText("hello")).toBeVisible();

  await page.getByRole("button", { name: "Clear chat" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Chat cleared").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask about your data" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Trace" }).getByText("idle")).toBeVisible();
});

test("keyboard: Enter sends, Shift+Enter adds a line, Ctrl+Enter sends", async ({ page }) => {
  const box = composer(page);
  await box.click();
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(box).toHaveValue("first\nsecond");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("");
  await expect(page.getByRole("log").getByText("first", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });
  // 답이 끝나 Send 버튼이 돌아와야 다음 질문을 보낼 수 있다
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

  await page.keyboard.type("third");
  await page.keyboard.press("Control+Enter");
  await expect(box).toHaveValue("");
  await expect(page.getByRole("log").getByText("third").first()).toBeVisible();
});

test("exposed servers: the sidebar checkbox controls what the model can use", async ({ page }) => {
  const sidebar = page.getByRole("complementary");
  const repo = sidebar.getByRole("checkbox", { name: /mock-repo-mcp/ });
  await expect(repo).toBeChecked();
  // 마지막 서버를 끄면 보낼 수 없다
  await repo.click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByText(/No server is exposed/)).toBeVisible();
  await repo.click();
  await expect(page.getByText(/can call the tools of|can be called by the model/)).toBeVisible();
});

test("thread follows new content, stops when the user scrolls up, and Jump to latest returns", async ({ page }) => {
  // 긴 대화를 먼저 만든다 (도구 결과 카드가 길어서 스레드가 스크롤된다)
  await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
  await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const log = page.getByRole("log");
  const gap = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(gap).toBeLessThan(60);

  // 두 번째 질문이 진행되는 동안 사용자가 위로 스크롤한다
  await ask(page, "[[tool:list_repositories]] [[sleep:1500]]");
  await log.evaluate((el) => {
    el.scrollTop = 0;
  });
  const jump = page.getByRole("button", { name: "Jump to latest" });
  await expect(jump).toBeVisible();
  await expect(page.getByText("Mock summary of 1 tool call").nth(1)).toBeVisible({ timeout: 15_000 });
  // 새 내용이 왔어도 끌려 내려가지 않는다
  expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(40);
  await expect(jump).toBeVisible();

  await jump.click();
  await expect.poll(gap).toBeLessThan(60);
  await expect(jump).toBeHidden();
});

test("trace split handle exposes aria values, moves with arrow keys and keeps the ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChat(page);

  const handle = page.getByRole("separator", { name: "Resize the trace panel" });
  for (const attr of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) {
    await expect(handle).toHaveAttribute(attr, /^\d/);
  }
  // 기본 Trace 폭은 --trace-w (1440px 에서 420px)
  const trace = page.getByRole("region", { name: "Trace" });
  const width = (await trace.boundingBox())!.width;
  expect(width).toBeGreaterThan(400);
  expect(width).toBeLessThan(440);

  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  const after = Number(await handle.getAttribute("aria-valuenow"));
  expect(after).not.toBe(before);

  // 새로고침해도 폭 구간(wide)별로 저장한 비율이 돌아온다.
  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 15_000 });
  const restored = Number(await page.getByRole("separator", { name: "Resize the trace panel" }).getAttribute("aria-valuenow"));
  expect(Math.abs(restored - after)).toBeLessThan(0.5);
});

test.describe("mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Thread and Trace tabs, Show in trace jumps to the trace", async ({ page }) => {
    await ask(page, "[[tool:list_repositories]] [[sleep:30]]");
    const card = page.getByRole("group", { name: /Tool call mock-repo-mcp/ });
    await expect(card.getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });

    const threadTab = page.getByRole("tab", { name: "Thread" });
    const traceTab = page.getByRole("tab", { name: "Trace" });
    await expect(threadTab).toHaveAttribute("aria-selected", "true");
    await traceTab.click();
    await expect(page.getByRole("listbox", { name: /^Turn 1:/ })).toBeVisible();
    // 스레드의 입력 중이던 글은 탭을 오가도 남는다
    await threadTab.click();
    await composer(page).fill("keep me");
    await traceTab.click();
    await threadTab.click();
    await expect(composer(page)).toHaveValue("keep me");

    await card.getByRole("button", { name: "Show in trace" }).click();
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("option", { name: /list_repositories mock-repo-mcp/ })).toHaveAttribute("aria-selected", "true");

    // 가로 넘침 없음
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
