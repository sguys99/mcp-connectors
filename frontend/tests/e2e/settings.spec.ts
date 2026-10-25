import { expect, test, type Page } from "@playwright/test";

import { waitForShell } from "./helpers";

// Settings 회귀 (Phase 4-B P4-8). 저장, 새로고침 유지, 키 가림 토글, 검증 오류, 초기화 확인을 확인한다.
// 키는 모두 가짜 값이다. 서버 env 에 LLM 키가 있고 CHAT_ALLOW_SERVER_KEYS=true 이면 "키 필수" 검증은 건너뛴다.

const FAKE_KEY = "sk-ant-test-0123456789abcd";

const keyInput = (page: Page) => page.getByLabel("Anthropic API key", { exact: true });

async function openSettings(page: Page) {
  await page.goto("/settings");
  // 하이드레이션이 끝나기 전에 저장소를 비우면 늦게 도는 effect 가 값을 다시 쓸 수 있다.
  await waitForShell(page);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/settings");
  await waitForShell(page);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // 하이드레이션이 끝나 저장 버튼이 켜질 때까지
  await expect(page.getByRole("button", { name: /^Save/ })).toBeEnabled();
}

test("save persists across reload and shows only the last 4 characters", async ({ page }) => {
  await openSettings(page);
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  await keyInput(page).fill(FAKE_KEY);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/^Saved \d/)).toBeVisible();
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  // 저장 위치는 localStorage 평문이다 (안내문과 같은 사실)
  const stored = await page.evaluate(() => localStorage.getItem("mcp-connectors.settings"));
  expect(JSON.parse(stored ?? "{}").anthropicApiKey).toBe(FAKE_KEY);

  await page.reload();
  await expect(keyInput(page)).toHaveValue(FAKE_KEY);
  await expect(page.getByText("Configured, ends in abcd")).toBeVisible();
  // 화면에는 키 전체가 텍스트로 나오지 않는다 (입력칸은 password)
  await expect(keyInput(page)).toHaveAttribute("type", "password");
});

test("mask toggle shows and hides the key, clear empties the field", async ({ page }) => {
  await openSettings(page);
  await keyInput(page).fill(FAKE_KEY);
  await expect(keyInput(page)).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show Anthropic API key" }).click();
  await expect(keyInput(page)).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide Anthropic API key" }).click();
  await expect(keyInput(page)).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Clear Anthropic API key" }).click();
  await expect(keyInput(page)).toHaveValue("");
  await expect(page.getByText("Not set").first()).toBeVisible();
});

test("storage notice states where keys live", async ({ page }) => {
  await openSettings(page);
  const notice = page.getByRole("region", { name: "Keys are stored in this browser, in plain text" });
  await expect(notice).toContainText("localStorage");
  await expect(notice).toContainText("mcp-connectors.settings");
  await expect(notice).toContainText("/api/chat");
  await expect(notice).toContainText("CHAT_ALLOW_SERVER_KEYS");
  await expect(notice).toContainText("MCP_API_KEY");
});

test("missing key for the active provider shows an inline error and does not save", async ({ page }) => {
  await openSettings(page);
  test.skip(await page.getByText("Server key available").first().isVisible(), "server-side key is enabled");

  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/Anthropic API key is required/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("mcp-connectors.settings"))).toBeNull();
});

test("Ctrl/Cmd+S saves from inside an input", async ({ page }) => {
  await openSettings(page);
  await keyInput(page).fill(FAKE_KEY);
  await keyInput(page).press("ControlOrMeta+s");
  await expect(page.getByText(/^Saved \d/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("mcp-connectors.settings"))).toContain(FAKE_KEY);
});

test("discard changes restores the saved values", async ({ page }) => {
  await openSettings(page);
  await keyInput(page).fill(FAKE_KEY);
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(keyInput(page)).toHaveValue("");
  await expect(page.getByText("No unsaved changes")).toBeVisible();
});

test("reset settings asks for confirmation; cancel keeps the data, confirm clears it", async ({ page }) => {
  await openSettings(page);
  await keyInput(page).fill(FAKE_KEY);
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText("No unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Reset settings to defaults" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Reset settings?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(keyInput(page)).toHaveValue(FAKE_KEY);

  await page.getByRole("button", { name: "Reset settings to defaults" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset", exact: true }).click();
  await expect(keyInput(page)).toHaveValue("");
  await expect(page.getByText("Settings reset to defaults")).toBeVisible();
});

test("reset all local data clears settings, getting started and panel sizes but keeps the theme", async ({ page }) => {
  await openSettings(page);
  // 저장값은 새로 열리는 페이지의 스크립트보다 먼저 심는다. 지금 열려 있는 페이지에서 evaluate 로 심으면, 이 페이지가 늦게
  // 받은 서버 상태 응답으로 "시작하기"를 자동 완료하면서 메모리 캐시 전체를 다시 써 심은 값(hidden)을 덮어쓸 수 있다.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-seeded")) return;
    sessionStorage.setItem("e2e-seeded", "1");
    localStorage.setItem("mcp-connectors.settings", JSON.stringify({ anthropicApiKey: "sk-ant-x-0123456789" }));
    localStorage.setItem("mcpc-getting-started", JSON.stringify({ v: 1, done: { startServer: true }, hidden: true }));
    localStorage.setItem("react-resizable-panels:mcpc-chat-panes-wide:a:b", "{}");
    localStorage.setItem("mcpc-theme", "dark");
    sessionStorage.setItem("mcpc-tools-cache:starter-mcp", "{}");
  });
  await page.reload();
  await waitForShell(page);
  await expect(page.getByRole("button", { name: /^Save/ })).toBeEnabled();
  await expect(page.getByText("Hidden on the Dashboard. 1 of 4 steps done.")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Reset all local data" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Reset all local data?" });
  await expect(dialog).toContainText("Theme and language are kept");
  await dialog.getByRole("button", { name: "Reset everything" }).click();
  await expect(page.getByText("Local data reset")).toBeVisible({ timeout: 10_000 });

  const left = await page.evaluate(() => ({
    settings: localStorage.getItem("mcp-connectors.settings"),
    gs: localStorage.getItem("mcpc-getting-started"),
    panes: localStorage.getItem("react-resizable-panels:mcpc-chat-panes-wide:a:b"),
    theme: localStorage.getItem("mcpc-theme"),
    cache: sessionStorage.getItem("mcpc-tools-cache:starter-mcp"),
  }));
  expect(left).toEqual({ settings: null, gs: null, panes: null, theme: "dark", cache: null });
  await expect(page.getByText("Shown on the Dashboard. 0 of 4 steps done.")).toBeVisible();
});

test("local data lists saved conversations (IndexedDB) and runtime servers, and reset all clears both", async ({ page }) => {
  await openSettings(page);
  const conversationsRow = page.locator('[data-local-data="conversations"]');
  await expect(conversationsRow).toContainText("IndexedDB");
  await expect(conversationsRow.locator("[data-conversations-stored]")).toContainText("0 conversations");

  // 저장소는 설정 화면이 열 때 만들어진다. 대화 하나와 런타임 서버 하나를 직접 넣는다.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("mcpc-chat");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = {
      v: 1, id: "seed-1", title: "Seeded", titleAuto: false, createdAt: 1, updatedAt: 2, provider: "anthropic", model: "m",
      maxIterations: 5, approval: "auto", servers: [], runtimeServers: [], allowedTools: [], turns: [], usage: null,
    };
    const meta = { id: "seed-1", title: "Seeded", titleAuto: false, createdAt: 1, updatedAt: 2, provider: "anthropic", model: "m", messageCount: 0, tokens: 0, pending: false, truncated: false, size: 2048, searchText: "seeded" };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["conversations", "meta"], "readwrite");
      tx.objectStore("conversations").put(record);
      tx.objectStore("meta").put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    sessionStorage.setItem("mcpc-runtime-servers", JSON.stringify({ v: 1, servers: [{ name: "tmp-srv", url: "http://localhost:9/mcp", headers: [], mode: "direct", rev: 0 }] }));
  });
  await page.reload();
  await waitForShell(page);
  await expect(page.getByRole("button", { name: /^Save/ })).toBeEnabled();
  await expect(conversationsRow.locator("[data-conversations-stored]")).toContainText("1 conversation, 2.0 KB", { timeout: 10_000 });
  await expect(page.getByText("Runtime servers", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reset all local data" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Reset all local data?" });
  await expect(dialog).toContainText("saved Chat conversation");
  await expect(dialog).toContainText("runtime servers");
  await dialog.getByRole("button", { name: "Reset everything" }).click();
  await expect(page.getByText("Local data reset")).toBeVisible({ timeout: 10_000 });
  await expect(conversationsRow.locator("[data-conversations-stored]")).toContainText("0 conversations", { timeout: 10_000 });
  expect(await page.evaluate(() => sessionStorage.getItem("mcpc-runtime-servers"))).toBeNull();
});

test("section nav jumps to a section; theme and language rows are labeled", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("link", { name: "Local data" }).click();
  await expect(page).toHaveURL(/#data$/);
  await expect(page.getByRole("heading", { name: "Local data", level: 2 })).toBeInViewport();

  await expect(page.locator("#appearance").getByRole("toolbar", { name: "Theme" })).toBeVisible();
  await expect(page.locator("#appearance").getByRole("toolbar", { name: "Language" })).toBeVisible();
});

test("section chips show Unsaved only for the section that has unsaved edits", async ({ page }) => {
  await openSettings(page);
  const llm = page.locator("section#llm");
  const keys = page.locator("section#keys");
  await expect(page.locator("[data-section-state=dirty]")).toHaveCount(0);
  await expect(llm.getByText("Applies on Save", { exact: true })).toBeVisible();
  await expect(keys.getByText("Applies on Save", { exact: true })).toBeVisible();

  await keyInput(page).fill(FAKE_KEY);
  await expect(keys.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(llm.getByText("Applies on Save", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator("[data-section-state=dirty]")).toHaveCount(0);
});
