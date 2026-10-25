import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { waitForShell } from "./helpers";

// Phase 5-A (P5-4) Inspector 관측 회귀. 표적은 starter-mcp-http (port 8001)다.
//   1) JSON-RPC 로그 탭: 호출 뒤 요청, 응답 짝과 소요 시간, 펼친 JSON, 필터, 복사, 지우기, 비밀 값 가리기
//   2) 호출 기록: 기록, 새로고침 뒤 유지, 열기, 다시 실행, 삭제, 비밀 값이 가려진 기록의 재실행 차단
//   3) 시나리오 내보내기: 대화상자, 내려받은 YAML 을 `mcp_cli.py test` 로 실행해 통과하는지 (왕복 증명)
//   4) 명령 팔레트의 Resources, Prompts 이동

const STARTER = "/inspector?server=starter-mcp-http";
const REPO_ROOT = path.resolve(__dirname, "../../..");

async function openStarter(page: Page, query = "") {
  await page.goto(STARTER + query);
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
  // 기록은 브라우저에 남으므로 테스트마다 비운다
  await page.evaluate(() => localStorage.removeItem("mcp-connectors.recentCalls"));
}

const dockOf = (page: Page) => page.getByRole("region", { name: "Inspector panel" });
const responsePane = (page: Page) => page.getByRole("region", { name: "Response" });
const dockTab = (page: Page, name: "JSON-RPC log" | "History" | "Server info") => dockOf(page).getByRole("tab", { name: new RegExp(`^${name}`) });

async function runTool(page: Page, tool: RegExp, fields: Record<string, string>) {
  await page.getByRole("option", { name: tool }).click();
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
}

test("JSON-RPC log pairs request and response, expands, filters, copies and clears", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openStarter(page);
  const dock = dockOf(page);
  // 기본 탭은 로그이고, 연결하면서 오간 initialize 부터 보인다.
  await expect(dockTab(page, "JSON-RPC log")).toHaveAttribute("aria-selected", "true");
  await expect(dock.locator('[data-rpc-row][data-method="initialize"]')).toHaveCount(2, { timeout: 15_000 });
  await expect(dock.locator('[data-rpc-row][data-method="notifications/initialized"]')).toHaveCount(1);
  await expect(dock.locator('[data-rpc-row][data-method="tools/list"]').first()).toBeVisible();

  await runTool(page, /^add/, { a: "2", b: "3" });
  const request = dock.locator('[data-rpc-row][data-method="tools/call"][data-kind="request"]');
  const response = dock.locator('[data-rpc-row][data-method="tools/call"][data-kind="response"]');
  await expect(request).toHaveCount(1);
  await expect(response).toHaveCount(1);
  await expect(request).toHaveAttribute("data-status", "ok");
  await expect(response).toHaveAttribute("data-status", "ok");
  await expect(request).toHaveAttribute("data-dir", "out");
  await expect(response).toHaveAttribute("data-dir", "in");
  // 응답 줄에는 소요 시간(ms)과 크기가 있다
  await expect(response).toContainText(/\d+ ?B/);
  await expect(response.locator("span").nth(5)).toHaveText(/^\d+$/);

  // 펼치면 비밀을 가린 원본 JSON 이 나온다
  await request.click();
  const json = dock.locator("[data-rpc-json]");
  await expect(json).toContainText('"method": "tools/call"');
  await expect(json).toContainText('"name": "add"');
  await expect(json).toContainText('"a": 2');
  await expect(request).toHaveAttribute("aria-expanded", "true");
  await request.click();
  await expect(json).toBeHidden();

  // 필터
  const filter = dock.getByRole("searchbox", { name: "Filter messages" });
  const total = await dock.locator("[data-rpc-row]").count();
  await filter.fill("tools/call");
  await expect(dock.locator("[data-rpc-row]")).toHaveCount(2);
  await expect(dock.locator("[data-rpc-count]")).toContainText(`2 of ${total}`);
  await filter.fill("zzz-no-such-text");
  await expect(dock.locator("[data-rpc-nomatch]")).toBeVisible();
  await filter.fill("");

  // 전체 복사: 필터가 걸린 목록이 JSON 배열로 복사된다
  await filter.fill("tools/call");
  await dock.getByRole("button", { name: "Copy all as JSON" }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as Array<{ method: string; direction: string }>;
  expect(copied).toHaveLength(2);
  expect(copied.map((c) => c.direction)).toEqual(["client->server", "server->client"]);
  expect(copied.every((c) => c.method === "tools/call")).toBe(true);
  await filter.fill("");

  // 지우기
  await dock.getByRole("button", { name: "Clear" }).click();
  await expect(dock.locator("[data-rpc-empty]")).toBeVisible();
  await expect(dock.locator("[data-rpc-row]")).toHaveCount(0);

  // 새 호출은 다시 쌓인다
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(dock.locator('[data-rpc-row][data-method="tools/call"]')).toHaveCount(2, { timeout: 15_000 });
});

test("secret-looking values are masked in the log and in history, and a masked call cannot be re-run blindly", async ({ page }) => {
  await openStarter(page);
  const dock = dockOf(page);
  const secret = "Bearer sk-live-aaaaaaaaaaaaaaaaaaaa";
  await page.getByRole("option", { name: /^echo/ }).click();
  await page.getByLabel("text", { exact: true }).fill(secret);
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });

  const request = dock.locator('[data-rpc-row][data-method="tools/call"][data-kind="request"]');
  await request.click();
  await expect(dock.locator("[data-rpc-json]")).toContainText("[REDACTED]");
  await expect(dock.locator("[data-rpc-json]")).not.toContainText("sk-live");
  expect(await page.evaluate(() => localStorage.getItem("mcp-connectors.recentCalls") ?? "")).not.toContain("sk-live");

  await dockTab(page, "History").click();
  const rows = dock.locator("[data-history-row]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("[REDACTED]");
  // 다시 실행은 보내지 않고 입력만 채운 뒤 안내한다
  await rows.first().getByRole("button", { name: /^Re-run/ }).click();
  await expect(page.getByText(/secret value was masked/).first()).toBeVisible();
  await expect(rows).toHaveCount(1);
});

test("history records tool, resource and prompt calls, survives a reload, reopens and re-runs", async ({ page }) => {
  await openStarter(page);
  const dock = dockOf(page);
  await runTool(page, /^add/, { a: "2", b: "3" });

  await page.getByRole("tab", { name: /^Resources/ }).click();
  await page.getByRole("option", { name: /^about/ }).click();
  await page.getByRole("button", { name: /^Read/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("tab", { name: /^Prompts/ }).click();
  await page.getByRole("option", { name: /^explain_tool/ }).click();
  await page.getByLabel("tool_name", { exact: true }).fill("add");
  await page.getByRole("button", { name: /^Get/ }).click();
  await expect(responsePane(page).locator("[data-message-role]").first()).toBeVisible({ timeout: 15_000 });

  await dockTab(page, "History").click();
  const rows = dock.locator("[data-history-row]");
  await expect(rows).toHaveCount(3);
  // 최근 순: 프롬프트, 리소스, 도구
  await expect(rows.nth(0)).toHaveAttribute("data-kind", "prompt");
  await expect(rows.nth(1)).toHaveAttribute("data-kind", "resource");
  await expect(rows.nth(2)).toHaveAttribute("data-kind", "tool");
  await expect(rows.nth(2)).toContainText('{"a":2,"b":3}');
  await expect(dockTab(page, "History")).toContainText("3");

  // 새로고침 뒤에도 남는다 (localStorage)
  await page.reload();
  await expect(page.getByRole("option", { name: /^echo|^add/ }).first()).toBeVisible({ timeout: 15_000 });
  await dockTab(page, "History").click();
  await expect(dock.locator("[data-history-row]")).toHaveCount(3);

  // 열기: 도구 탭으로 돌아가 입력을 채우되 보내지는 않는다
  const toolCalls = () => dock.locator("[data-history-row][data-kind=tool]").count();
  await dock.locator("[data-history-row][data-kind=tool]").getByRole("button", { name: /^Open/ }).click();
  await expect(page.getByRole("heading", { name: "add", level: 2 })).toBeVisible();
  await expect(page.getByLabel("a", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("b", { exact: true })).toHaveValue("3");
  expect(await toolCalls()).toBe(1);

  // 다시 실행: 다른 값으로 바꿔 둔 뒤에도 기록의 값으로 보낸다
  await page.getByLabel("a", { exact: true }).fill("40");
  await dock.locator("[data-history-row][data-kind=tool]").getByRole("button", { name: /^Re-run/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).locator("pre").first()).toContainText("5");
  await expect.poll(toolCalls).toBe(2);
  await expect(page.getByLabel("a", { exact: true })).toHaveValue("2");

  // 리소스 다시 실행, 삭제, 지우기(확인)
  await dock.locator("[data-history-row][data-kind=resource]").first().getByRole("button", { name: /^Re-run/ }).click();
  await expect(dock.locator("[data-history-row][data-kind=resource]")).toHaveCount(2, { timeout: 15_000 });
  await dock.locator("[data-history-row]").first().getByRole("button", { name: /^Delete/ }).click();
  await expect(dock.locator("[data-history-row]")).toHaveCount(4);
  await dock.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear" }).click();
  await expect(dock.locator("[data-history-empty]")).toBeVisible();
});

test.describe("scenario export", () => {
  test("exports selected history to YAML that mcp_cli.py test accepts", async ({ page }) => {
    test.setTimeout(120_000);
    await openStarter(page);
    const dock = dockOf(page);

    await runTool(page, /^add/, { a: "2", b: "3" });
    await runTool(page, /^echo/, { text: "hi" });
    // 오류 경로: JSON 모드로 빈 text 를 보낸다
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await page.getByLabel("arguments").fill('{"text": ""}');
    await page.getByRole("button", { name: /^Run/ }).click();
    await expect(responsePane(page).getByText("isError", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: /^Resources/ }).click();
    await page.getByRole("option", { name: /^about/ }).click();
    await page.getByRole("button", { name: /^Read/ }).click();
    await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: /^Prompts/ }).click();
    await page.getByRole("option", { name: /^explain_tool/ }).click();
    await page.getByLabel("tool_name", { exact: true }).fill("add");
    await page.getByRole("button", { name: /^Get/ }).click();
    await expect(responsePane(page).locator("[data-message-role]").first()).toBeVisible({ timeout: 15_000 });

    await dockTab(page, "History").click();
    await expect(dock.locator("[data-history-row]")).toHaveCount(5);

    // 선택하지 않으면 전체, 선택하면 선택한 것만
    await dock.getByRole("button", { name: "Export scenario" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-export-yaml]")).toContainText("cases:");
    await expect(dialog.locator("[data-export-derived]")).toContainText("derived");
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await dock.getByRole("checkbox", { name: "Select add" }).check();
    await dock.getByRole("button", { name: "Export 1 as scenario" }).click();
    await expect(dialog.locator("[data-export-yaml]")).not.toContainText("tool: echo");
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await dock.getByRole("checkbox", { name: "Select add" }).uncheck();

    await dock.getByRole("button", { name: "Export scenario" }).click();
    const yamlText = await dialog.locator("[data-export-yaml]").innerText();
    expect(yamlText).toContain("server: starter-mcp-http");
    expect(yamlText).toContain("op: note");
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^starter-mcp-http-history-\d{4}-\d{2}-\d{2}\.yaml$/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpc-export-"));
    const file = path.join(dir, download.suggestedFilename());
    await download.saveAs(file);
    expect(fs.readFileSync(file, "utf8")).toContain("cases:");

    // 왕복 증명: 내려받은 파일을 CLI 러너가 starter HTTP 서버(8001)에 실행해 모두 통과해야 한다.
    let uvOk = true;
    try {
      execFileSync("uv", ["--version"], { stdio: "ignore" });
    } catch {
      uvOk = false;
    }
    test.skip(!uvOk, "uv is not installed, so the CLI round trip cannot run");
    let output = "";
    try {
      output = execFileSync("uv", ["run", "python", "scripts/mcp_cli.py", "test", file], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      throw new Error(`mcp_cli.py test failed (exit ${e.status})\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
    }
    // 5 케이스 모두 통과 (도구 2개, 도구 오류 1개, 리소스, 프롬프트). execFileSync 는 종료 코드 0 이 아니면 위에서 던진다.
    expect(output).toMatch(/PASS=5 FAIL=0 ERROR=0 SKIP=0/);
    expect(output).toMatch(/Result: OK/);
  });
});

test.describe("command palette", () => {
  test("lists resources and prompts of the selected server and navigates by deep link", async ({ page }) => {
    await page.goto(STARTER);
    await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
    // 캐시를 비워 팔레트가 직접 불러오는 경로(지연 로드)도 거친다
    await page.evaluate(() => sessionStorage.clear());
    await waitForShell(page);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByText("Resources on starter-mcp-http")).toBeVisible({ timeout: 15_000 });
    await expect(palette.getByText("Prompts on starter-mcp-http")).toBeVisible();
    await expect(palette.getByText("Tools on starter-mcp-http")).toBeVisible();

    await palette.getByRole("combobox").fill("about");
    await palette.getByRole("option", { name: /about/ }).first().click();
    await expect(page).toHaveURL(/resource=starter%3A%2F%2Fabout/);
    await expect(page.getByRole("tab", { name: /^Resources/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "about", level: 2 })).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ControlOrMeta+k");
    await palette.getByRole("combobox").fill("explain_tool");
    await palette.getByRole("option", { name: /explain_tool/ }).first().click();
    await expect(page).toHaveURL(/prompt=explain_tool/);
    await expect(page.getByRole("tab", { name: /^Prompts/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "explain_tool", level: 2 })).toBeVisible({ timeout: 15_000 });

    // template 도 resource= 딥링크로 열린다
    await page.keyboard.press("ControlOrMeta+k");
    await palette.getByRole("combobox").fill("greeting");
    await palette.getByRole("option", { name: /greeting/ }).first().click();
    await expect(page).toHaveURL(/resource=starter%3A%2F%2Fgreeting/);
    await expect(page.getByTestId("resource-uri")).toBeVisible({ timeout: 15_000 });
  });
});

// P5-10: 도킹 패널 높이 조절(끌기, 키보드, 저장, 두 번 눌러 초기화)과 모바일 기본 접힘
test("dock height: keyboard and drag resize, persists across reload, double-click resets", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openStarter(page);
  await page.evaluate(() => localStorage.removeItem("mcpc-inspector-dock-h-desktop"));
  await page.reload();
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
  const handle = page.getByRole("separator", { name: "Resize panel" });
  await expect(handle).toBeVisible();
  const value = async () => Number(await handle.getAttribute("aria-valuenow"));
  await expect.poll(value).toBe(216);

  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(value).toBe(248);
  const dockBox = async () => (await dockOf(page).boundingBox())!.height;
  expect(Math.round(await dockBox())).toBeGreaterThanOrEqual(246);
  await page.keyboard.press("Home");
  await expect.poll(value).toBe(96);

  // 끌기: 위로 100px 끌면 그만큼 커진다
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(value).toBeGreaterThanOrEqual(190);
  const dragged = await value();
  expect(await page.evaluate(() => localStorage.getItem("mcpc-inspector-dock-h-desktop"))).toBe(String(dragged));

  await page.reload();
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
  await expect.poll(value).toBe(dragged);

  await handle.dblclick();
  await expect.poll(value).toBe(216);
  expect(await page.evaluate(() => localStorage.getItem("mcpc-inspector-dock-h-desktop"))).toBeNull();

  // 접으면 핸들이 사라진다
  await dockOf(page).getByRole("button", { name: /Toggle panel/ }).click();
  await expect(handle).toHaveCount(0);
  await dockOf(page).getByRole("button", { name: /Toggle panel/ }).click();
});

test("dock on mobile starts collapsed; choosing a tab opens it and the choice is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STARTER);
  await page.evaluate(() => localStorage.removeItem("mcpc-inspector-dock-mobile"));
  await page.reload();
  const dock = dockOf(page);
  await expect(dock).toHaveAttribute("data-dock", "closed", { timeout: 15_000 });
  await dockTab(page, "History").click();
  await expect(dock).toHaveAttribute("data-dock", "open");
  await expect(dockTab(page, "History")).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(dockOf(page)).toHaveAttribute("data-dock", "open", { timeout: 15_000 });
  // 데스크톱의 펼침 상태와는 따로 저장된다
  expect(await page.evaluate(() => localStorage.getItem("mcpc-inspector-dock-mobile"))).toBe("open");
});
