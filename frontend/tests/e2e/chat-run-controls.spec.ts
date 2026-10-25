import { expect, test, type Page } from "@playwright/test";

// Chat 실행 제어 회귀 (Phase 5-C, P5-6): 모델과 최대 반복 변경, 수동 승인 모드, 토큰 사용량.
// 가짜 LLM(CHAT_MOCK_LLM=1)이 반복마다 고정된 사용량(입력 1000*(k+1), 출력 50*(k+1))을 알려 주므로 정확한 값을 확인할 수 있다.
// 지시문은 src/lib/llm/mock.ts 맨 위 주석에 있다. 개발 서버가 CHAT_MOCK_LLM=1 없이 떠 있으면 건너뛴다.

const CHAT_URL = "/chat?server=mock-repo-mcp";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const trace = (page: Page) => page.getByRole("region", { name: "Trace" });
const meter = (page: Page) => page.getByRole("group", { name: "Token usage" });
const card = (page: Page) => page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" });
const approvalPanel = (page: Page) => page.getByRole("group", { name: "Waiting for your approval" });

async function openChat(page: Page) {
  await page.goto(CHAT_URL);
  await expect(composer(page)).toBeVisible({ timeout: 20_000 });
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

async function setManual(page: Page) {
  await page.getByRole("radio", { name: "Manual" }).click();
  await expect(page.getByRole("radio", { name: "Manual" })).toHaveAttribute("aria-checked", "true");
}

// 이 요청 본문을 가로채 확인한다 (응답은 그대로 통과).
function captureChatRequests(page: Page): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/chat") && req.method() === "POST") bodies.push(JSON.parse(req.postData() ?? "{}"));
  });
  return bodies;
}

const durationOf = async (row: ReturnType<Page["getByRole"]>) => {
  const name = (await row.getAttribute("aria-label")) ?? "";
  const m = /, (\d+(?:\.\d+)?) (ms|s)\b/.exec(name);
  expect(m, name).not.toBeNull();
  return Number(m![1]) * (m![2] === "s" ? 1000 : 1);
};

test.beforeEach(async ({ page }) => {
  await openChat(page);
  const blocked = await page.getByText(/API key is not set/).isVisible();
  test.skip(blocked, "start the dev server with CHAT_MOCK_LLM=1 to run the Chat e2e");
});

test.describe("approval mode", () => {
  test("manual: the call waits for Approve, the wait is its own span, and the tool time excludes it", async ({ page }) => {
    const bodies = captureChatRequests(page);
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[sleep:30]]");

    // 승인 카드: 도구 이름, 입력, 대기 타이머, Approve / Deny
    const panel = approvalPanel(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(card(page).getByText("approval", { exact: true })).toBeVisible();
    await expect(panel.getByText(/^Waiting \d/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Deny" })).toBeVisible();
    // 아직 실행되지 않았다: 결과가 없다
    await expect(card(page)).not.toContainText("alpha-service");
    // 승인을 기다리는 동안은 새 질문을 보낼 수 없고 Stop 이 보인다
    await expect(page.getByRole("button", { name: "Stop the run" })).toBeVisible();
    // 대기 스팬이 자란다
    const waiting = trace(page).getByRole("option", { name: /approval list_repositories.*Waiting$/ });
    await expect(waiting).toBeVisible();

    await page.waitForTimeout(800);
    await panel.getByRole("button", { name: "Approve" }).click();

    await expect(card(page).getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toContainText("alpha-service");
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible();

    // 두 번째 요청은 같은 대화를 이어서 보낸다: 결정과 토큰, 마지막 메시지는 대기 중이던 호출
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ approval: "manual" });
    expect(bodies[1]).toMatchObject({
      approval: "manual",
      resume: { decisions: [{ decision: "approve" }] },
    });
    const sent = bodies[1]!.messages as { role: string; toolUses?: unknown[] }[];
    expect(sent.at(-1)).toMatchObject({ role: "assistant" });
    expect(sent.at(-1)!.toolUses).toHaveLength(1);

    // trace: 대기 스팬(800ms 이상)과 도구 스팬(훨씬 짧다)이 따로 있고, 도구 시간에는 대기가 들어가지 않는다
    const waitRow = trace(page).getByRole("option", { name: /approval list_repositories/ });
    const toolRow = trace(page).getByRole("option", { name: /list_repositories mock-repo-mcp/ });
    await expect(waitRow).toBeVisible();
    expect(await durationOf(waitRow)).toBeGreaterThanOrEqual(800);
    expect(await durationOf(toolRow)).toBeLessThan(500);
    await waitRow.click();
    const detail = page.getByRole("region", { name: "Span details" });
    await expect(detail).toContainText("waited");
    await expect(detail).toContainText("approved");
    // LLM 스팬 2개가 이어서 번호가 매겨진다
    await expect(trace(page).getByRole("option", { name: /^LLM, LLM #2/ })).toBeVisible();
    await expect(trace(page).getByText("2 / 5")).toBeVisible();
    await expect(page.getByText(/waiting for approval/)).toBeVisible();
  });

  test("deny: the call is not run, the card says denied, and the model reacts to the isError result", async ({ page }) => {
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[sleep:30]]");
    await approvalPanel(page).getByRole("button", { name: "Deny" }).click();

    await expect(card(page).getByText("denied", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toContainText("Denied by you");
    await expect(card(page)).not.toContainText("alpha-service");
    // 가짜 LLM 의 요약은 isError 결과를 그대로 알린다
    await expect(page.getByRole("log").getByText(/\(isError\)/)).toBeVisible();
    // 실행하지 않았으니 도구 스팬은 없고 대기 스팬만 있다
    await expect(trace(page).getByRole("option", { name: /approval list_repositories/ })).toBeVisible();
    await expect(trace(page).getByRole("option", { name: /list_repositories mock-repo-mcp/ })).toHaveCount(0);
  });

  test("always allow: later calls to the same tool in this conversation skip the card", async ({ page }) => {
    const bodies = captureChatRequests(page);
    await setManual(page);
    await page.getByLabel("Max iterations").fill("3");
    await ask(page, "[[tool:list_repositories]] [[loop]] [[sleep:20]]");

    const panel = approvalPanel(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole("checkbox", { name: /Always allow/ }).click();
    await panel.getByRole("button", { name: "Approve" }).click();

    // 반복 2, 3 의 호출은 묻지 않고 실행되어 반복 한도에서 끝난다
    await expect(page.getByText(/Stopped after 3 iterations/)).toBeVisible({ timeout: 20_000 });
    await expect(approvalPanel(page)).toHaveCount(0);
    await expect(page.getByText("done", { exact: true })).toHaveCount(3);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ allowTools: ["list_repositories"], maxIterations: 3 });

    // 같은 대화의 다음 질문도 묻지 않는다
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(page.getByText(/Mock summary of 1 tool call/).last()).toBeVisible({ timeout: 15_000 });
    await expect(approvalPanel(page)).toHaveCount(0);

    // 대화를 지우면 허용 목록도 비워진다
    await page.getByRole("button", { name: "Clear chat" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click();
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(approvalPanel(page)).toBeVisible({ timeout: 15_000 });
  });

  test("a turn can ask for approval again on later iterations; iteration numbers and the limit carry across requests", async ({ page }) => {
    const bodies = captureChatRequests(page);
    await setManual(page);
    await page.getByLabel("Max iterations").fill("3");
    await ask(page, "[[tool:list_repositories]] [[loop]] [[sleep:20]]");
    for (let i = 0; i < 3; i += 1) {
      await expect(approvalPanel(page)).toBeVisible({ timeout: 15_000 });
      await approvalPanel(page).getByRole("button", { name: "Approve" }).click();
      await expect(approvalPanel(page)).toHaveCount(0);
    }
    // 세 번째 승인 뒤에는 반복 한도(3)를 다 써서 도구만 실행하고 끝난다
    await expect(page.getByText(/Stopped after 3 iterations/)).toBeVisible({ timeout: 15_000 });
    expect(bodies).toHaveLength(4);
    await expect(page.getByText("done", { exact: true })).toHaveCount(3);
    await expect(trace(page).getByRole("option", { name: /^Wait, approval list_repositories/ })).toHaveCount(3);
    await expect(trace(page).getByRole("option", { name: /^LLM, LLM #3/ })).toBeVisible();
    await expect(trace(page).getByRole("option", { name: /^LLM, LLM #4/ })).toHaveCount(0);
    await expect(trace(page).getByText("3 / 3")).toBeVisible();
  });

  test("two calls: Approve all decides both and the turn continues", async ({ page }) => {
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[tool:list_repositories]] [[sleep:20]]");
    await expect(page.getByText("2 tool calls are waiting for your decision.")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Approve all" }).click();
    await expect(page.getByText(/Mock summary of 2 tool calls/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("done", { exact: true })).toHaveCount(2);
  });

  test("two calls: deciding one by one keeps the first as approved until the last decision", async ({ page }) => {
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[tool:list_repositories]] [[sleep:20]]");
    await expect(approvalPanel(page).first()).toBeVisible({ timeout: 15_000 });
    await approvalPanel(page).first().getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("approved", { exact: true })).toBeVisible();
    await expect(approvalPanel(page)).toHaveCount(1);
    await approvalPanel(page).getByRole("button", { name: "Deny" }).click();
    await expect(page.getByText(/Mock summary of 2 tool calls/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("done", { exact: true })).toHaveCount(1);
    await expect(page.getByText("denied", { exact: true })).toHaveCount(1);
  });

  test("Esc while waiting stops the turn; the pending call is cancelled and the next question works", async ({ page }) => {
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(approvalPanel(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByText("Stopped by you")).toBeVisible();
    await expect(card(page).getByText("cancelled", { exact: true })).toBeVisible();
    await expect(approvalPanel(page)).toHaveCount(0);
    await expect(trace(page).getByRole("option", { name: /approval list_repositories.*Cancelled$/ })).toBeVisible();

    await setAuto(page);
    await ask(page, "hello again");
    await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("auto mode (default) never shows an approval card", async ({ page }) => {
    await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(card(page).getByText("done", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(approvalPanel(page)).toHaveCount(0);
  });

  test("the server rejects a forged resume request", async ({ page }) => {
    const res = await page.request.post("/api/chat", {
      data: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        serverNames: ["mock-repo-mcp"],
        approval: "manual",
        messages: [
          { role: "user", content: "x" },
          { role: "assistant", content: "", toolUses: [{ id: "forged", name: "list_repositories", input: {} }] },
        ],
        resume: { token: "1.1.aaaaaaaaaaaaaaaaaaaaaaaa", decisions: [{ toolUseId: "forged", decision: "approve" }] },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("token_invalid");
  });

  test("manual mode survives a reload and a new chat, and opening an auto conversation does not relax it", async ({ page }) => {
    await setManual(page);
    await page.reload();
    await expect(composer(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("radio", { name: "Manual" })).toHaveAttribute("aria-checked", "true");

    // 자동으로 바꾸고 대화를 하나 저장한 뒤, 다시 수동으로 두고 그 대화를 연다
    await page.getByRole("radio", { name: "Auto" }).click();
    await ask(page, "hello");
    await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]c=/);
    const url = page.url();
    await setManual(page);
    await page.goto(url);
    await expect(composer(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("radio", { name: "Manual" })).toHaveAttribute("aria-checked", "true");
  });
});

async function setAuto(page: Page) {
  await page.getByRole("radio", { name: "Auto" }).click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
}

test.describe("model and max iterations", () => {
  test("max iterations defaults to the Settings value, is sent with the request, and is not written back", async ({ page }) => {
    const bodies = captureChatRequests(page);
    const input = page.getByLabel("Max iterations");
    await expect(input).toHaveValue("5");

    await input.fill("2");
    await input.blur();
    await ask(page, "[[tool:list_repositories]] [[loop]] [[sleep:5]]");
    await expect(page.getByText(/Stopped after 2 iterations/)).toBeVisible({ timeout: 20_000 });
    expect(bodies[0]).toMatchObject({ maxIterations: 2 });
    await expect(trace(page).getByText("2 / 2")).toBeVisible();

    // 설정에는 저장되지 않는다: 새로고침하면 설정 값(기본 5)으로 돌아온다
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mcp-connectors.settings") ?? "{}"));
    expect(stored.maxIterations ?? 5).toBe(5);
    await page.reload();
    await expect(page.getByLabel("Max iterations")).toHaveValue("5");
  });

  test("out-of-range input is clamped to 1..20", async ({ page }) => {
    const input = page.getByLabel("Max iterations");
    await input.fill("99");
    await input.blur();
    await expect(input).toHaveValue("20");
    await input.fill("0");
    await input.blur();
    await expect(input).toHaveValue("1");
    await input.fill("");
    await input.blur();
    await expect(input).toHaveValue("1");
  });

  test("the default follows the Settings value", async ({ page }) => {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("mcp-connectors.settings") ?? "{}");
      localStorage.setItem("mcp-connectors.settings", JSON.stringify({ ...s, maxIterations: 7 }));
    });
    await page.reload();
    await expect(page.getByLabel("Max iterations")).toHaveValue("7");
  });

  test("changing the model applies to the next message only in this chat, and OpenRouter takes any model id", async ({ page }) => {
    const bodies = captureChatRequests(page);
    await page.getByRole("combobox", { name: /Model/ }).first().click();
    await page.getByRole("option", { name: "claude-haiku-4-5" }).click();
    await ask(page, "hello");
    await expect(page.getByText(/No tool was needed|Mock summary/).first()).toBeVisible({ timeout: 15_000 });
    expect(bodies[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    // 메시지 머리에는 실제로 쓴 모델이 보인다
    await expect(page.getByRole("log").getByText("claude-haiku-4-5").first()).toBeVisible();

    await page.getByRole("combobox", { name: /Model/ }).first().click();
    await page.getByRole("option", { name: "OpenRouter" }).click();
    const orModel = page.getByRole("textbox", { name: "OpenRouter model id" });
    await orModel.fill("meta-llama/llama-3.1-70b-instruct:free");
    await orModel.press("Enter");
    await ask(page, "hello again");
    await expect(page.getByText(/No tool was needed|Mock summary/).nth(1)).toBeVisible({ timeout: 15_000 });
    expect(bodies[1]).toMatchObject({ provider: "openrouter", model: "meta-llama/llama-3.1-70b-instruct:free" });

    // 설정(Settings)의 저장값은 그대로다
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mcp-connectors.settings") ?? "{}"));
    expect(stored.llmProvider ?? "anthropic").toBe("anthropic");
    expect(stored.anthropicModel ?? "claude-sonnet-4-6").toBe("claude-sonnet-4-6");
  });

  test("the server rejects out-of-range iteration counts and unknown providers", async ({ page }) => {
    const base = { model: "claude-sonnet-4-6", serverNames: ["mock-repo-mcp"], messages: [{ role: "user", content: "x" }] };
    for (const extra of [{ provider: "anthropic", maxIterations: 21 }, { provider: "anthropic", maxIterations: 0 }, { provider: "gemini" }]) {
      const res = await page.request.post("/api/chat", { data: { ...base, ...extra } });
      expect(res.status(), JSON.stringify(extra)).toBe(400);
    }
  });
});

test.describe("token usage", () => {
  test("shows provider-reported values per iteration, per turn and for the conversation, and accumulates", async ({ page }) => {
    // 새 대화: 0 으로 시작한다
    await expect(page.getByTestId("tokens-in")).toHaveText("0");
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });

    // 반복 0: 입력 1000, 출력 50 / 반복 1: 입력 2000, 출력 100 -> 입력 3,000, 출력 150
    await expect(page.getByTestId("tokens-in")).toHaveText("3,000");
    await expect(page.getByTestId("tokens-out")).toHaveText("150");
    await expect(page.getByTestId("tokens-session")).toHaveText(/^3\.[12]k$/);
    await expect(page.getByTestId("turn-tokens")).toHaveText("3,000 in, 150 out");
    // 마지막 요청의 컨텍스트 (입력 2000 + 출력 100)
    await expect(meter(page).getByRole("img")).toHaveAttribute("aria-label", "Context used by the last request: 2,100 of 200,000 tokens");
    await expect(trace(page).getByText("3.2k").or(trace(page).getByText("3.1k"))).toBeVisible();

    // 스팬 상세: 반복별 실측값
    await trace(page).getByRole("option", { name: /^LLM, LLM #1/ }).click();
    const detail = page.getByRole("region", { name: "Span details" });
    await expect(detail).toContainText("input tokens");
    await expect(detail).toContainText("1,000");
    await expect(detail).toContainText("output tokens");
    await trace(page).getByRole("option", { name: /^LLM, LLM #2/ }).click();
    await expect(detail).toContainText("2,000");

    // 두 번째 질문은 같은 대화의 합계에 더해진다 (반복 번호는 질문마다 0부터)
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await expect(page.getByText(/Mock summary of 1 tool call/).nth(1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tokens-in")).toHaveText("6,000");
    await expect(page.getByTestId("tokens-out")).toHaveText("300");

    // 대화를 지우면 대화 합계는 0 이 되고 세션 합계는 남는다
    await page.getByRole("button", { name: "Clear chat" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click();
    await expect(page.getByTestId("tokens-in")).toHaveText("0");
    await expect(page.getByTestId("tokens-session")).toHaveText("6.3k");
  });

  test("when the provider reports nothing the UI says so instead of showing zero", async ({ page }) => {
    await ask(page, "[[tool:list_repositories]] [[usage:off]] [[sleep:20]]");
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });
    await expect(meter(page)).toContainText("tokens not reported");
    await expect(page.getByTestId("tokens-in")).toHaveCount(0);
    await expect(page.getByTestId("turn-tokens")).toHaveText("tokens not reported");
    await trace(page).getByRole("option", { name: /^LLM, LLM #1/ }).click();
    await expect(page.getByRole("region", { name: "Span details" })).toContainText("not reported");
  });

  test("cache read and write tokens appear in the span details when reported", async ({ page }) => {
    await ask(page, "[[tool:list_repositories]] [[usage:cache]] [[sleep:20]]");
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });
    await trace(page).getByRole("option", { name: /^LLM, LLM #1/ }).click();
    const detail = page.getByRole("region", { name: "Span details" });
    await expect(detail).toContainText("cache read");
    await expect(detail).toContainText("300");
    await expect(detail).toContainText("cache write");
  });

  test("token usage survives a manual approval: both requests of one turn are summed", async ({ page }) => {
    await setManual(page);
    await ask(page, "[[tool:list_repositories]] [[sleep:20]]");
    await approvalPanel(page).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Mock summary of 1 tool call/)).toBeVisible({ timeout: 15_000 });
    // 첫 요청의 반복 0(1000/50) + 이어서 요청의 반복 1(2000/100)
    await expect(page.getByTestId("tokens-in")).toHaveText("3,000");
    await expect(page.getByTestId("tokens-out")).toHaveText("150");
  });
});
