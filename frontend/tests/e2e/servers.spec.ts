import { expect, test, type Page } from "@playwright/test";

import { gotoReady } from "./helpers";

// Phase 5-B (P5-5) 서버 연결 관리 회귀: 런타임 서버 추가(브라우저 직결, 서버 프록시), 사이드바 Runtime 그룹, Dashboard Runtime 섹션,
// Inspector 호출, 세션 한정 저장, 연결 실패 안내, 클라이언트 설정 복사.
// 표적은 starter-mcp-http (port 8001). 직결은 starter 의 CORS 기본값(http://localhost:3000)이 이 테스트의 앱 주소와 같아서 동작한다.
// 프록시 방식은 개발 서버가 MCP_ALLOW_RUNTIME_PROXY=true 로 떠 있어야 해서 playwright.config.ts 가 그 값을 준다.
// 헤더 값은 가짜 (_test_fixture) 다.

const STARTER_URL = "http://localhost:8001/mcp";
const SECRET = "header_value_test_fixture";

// 사이드바 Runtime 그룹의 서버 항목 버튼 (같은 줄의 "Actions for" 메뉴 버튼이 아니라 서버를 여는 버튼)
const runtimeItem = (page: Page, name: string) =>
  page.locator('[data-explorer-group="runtime"] li').filter({ hasText: name }).locator("button").first();

async function openAddDialog(page: Page) {
  await page.getByRole("button", { name: "Add server" }).first().click();
  await expect(page.getByRole("dialog", { name: "Add runtime server" })).toBeVisible();
}

async function addServer(
  page: Page,
  opts: { name: string; url?: string; mode?: "direct" | "proxy"; header?: [string, string] },
) {
  await openAddDialog(page);
  const dialog = page.getByRole("dialog", { name: "Add runtime server" });
  await dialog.getByLabel("Streamable HTTP URL").fill(opts.url ?? STARTER_URL);
  await dialog.getByLabel("Name", { exact: true }).fill(opts.name);
  if (opts.mode === "proxy") await dialog.getByRole("radio", { name: /Server proxy/ }).click();
  if (opts.header) {
    await dialog.getByRole("button", { name: "Add header" }).click();
    await dialog.getByLabel("Header 1 name").fill(opts.header[0]);
    await dialog.getByLabel("Header 1 value").fill(opts.header[1]);
  }
  await dialog.getByRole("button", { name: "Connect and add" }).click();
}

test("add a runtime server in direct mode, inspect it and keep it session-only", async ({ page }) => {
  await page.goto("/inspector?server=starter-mcp-http");
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });

  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await addServer(page, { name: "ext-direct", header: ["X-Test-Key", SECRET] });
  await expect(page.getByRole("dialog", { name: "Add runtime server" })).toBeHidden({ timeout: 15_000 });

  // 사이드바 Runtime 그룹
  await expect(runtimeItem(page, "ext-direct")).toBeVisible();
  await runtimeItem(page, "ext-direct").click();
  await expect(page).toHaveURL(/server=ext-direct/);
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });

  // 호출: 브라우저가 대상에 직접 보낸다 (프록시 경로를 지나지 않는다)
  await page.getByRole("option", { name: /^echo/ }).click();
  await page.getByLabel("text", { exact: true }).fill("hello runtime");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByRole("region", { name: "Response" }).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(requests.some((u) => u.startsWith(STARTER_URL))).toBe(true);
  expect(requests.some((u) => u.includes("/api/mcp-runtime"))).toBe(false);

  // 새로고침해도 같은 탭 세션이라 딥링크가 유지된다
  await page.reload();
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 20_000 });
  await expect(runtimeItem(page, "ext-direct")).toBeVisible();

  // 저장 위치: sessionStorage 에만 있고 localStorage 와 URL 에는 헤더 값이 없다
  const stores = await page.evaluate(() => ({
    session: JSON.stringify({ ...sessionStorage }),
    local: JSON.stringify({ ...localStorage }),
    url: location.href,
  }));
  expect(stores.session).toContain(SECRET);
  expect(stores.local).not.toContain(SECRET);
  expect(stores.url).not.toContain(SECRET);

  // 호출 기록과 JSON-RPC 로그에도 헤더 값이 없다
  await page.getByRole("tab", { name: /^Server info/ }).click();
  await expect(page.getByText(/X-Test-Key \(values hidden/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);
});

test("proxy mode goes through /api/mcp-runtime, shows on the Dashboard and is usable in Chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
  const section = page.locator('[data-section="runtime-servers"]');
  await expect(section.getByText("No runtime servers yet")).toBeVisible();

  const proxied: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/mcp-runtime")) proxied.push(r.url());
  });
  await addServer(page, { name: "ext-proxy", mode: "proxy", header: ["X-Test-Key", SECRET] });
  await expect(page.getByRole("dialog", { name: "Add runtime server" })).toBeHidden({ timeout: 15_000 });

  // Dashboard Runtime 섹션: 상태와 지연이 등록 서버처럼 나온다
  const row = section.getByRole("row").filter({ hasText: "ext-proxy" }).first();
  await expect(row).toContainText("Online", { timeout: 15_000 });
  expect(proxied.length).toBeGreaterThan(0);
  // 대상 주소와 연결 방식은 보이지만 헤더 값은 어디에도 없다
  await expect(row).toContainText("proxy");
  await expect(page.locator("body")).not.toContainText(SECRET);

  // Inspector 에서 도구 호출
  await row.getByRole("link", { name: /Inspect/ }).click();
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("option", { name: /^echo/ }).click();
  await page.getByLabel("text", { exact: true }).fill("hello proxy");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByRole("region", { name: "Response" }).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });

  // 응답에 프록시의 Server-Timing 이 있다 (등록 서버와 같은 코어)
  const timing = await page.evaluate(async () => {
    const res = await fetch("/api/mcp-runtime", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-mcp-runtime-target": "http://localhost:8001/mcp" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } }),
    });
    return { status: res.status, timing: res.headers.get("server-timing") };
  });
  expect(timing.status).toBe(200);
  expect(timing.timing).toContain("upstream;dur=");

  // Chat: 프록시 서버는 선택할 수 있고, 가짜 LLM 이 그 서버의 도구를 부른다
  await page.goto("/chat?server=ext-proxy");
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 20_000 });
  test.skip(await page.getByText(/API key is not set/).isVisible(), "start the dev server with CHAT_MOCK_LLM=1 to run the Chat part");
  await composer.fill('[[tool:echo {"text":"via runtime proxy"}]]');
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const card = page.getByRole("group", { name: "Tool call ext-proxy / echo" });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("via runtime proxy", { timeout: 20_000 });

  // 삭제: 확인을 거쳐 Runtime 섹션에서 사라진다
  await page.goto("/");
  await page.locator('[data-section="runtime-servers"]').getByRole("button", { name: "Actions for ext-proxy" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.locator('[data-section="runtime-servers"]').getByText("No runtime servers yet")).toBeVisible();
});

test("a direct-mode runtime server is listed in Chat but cannot be selected", async ({ page }) => {
  await page.goto("/");
  await addServer(page, { name: "ext-direct-chat" });
  await expect(page.getByRole("dialog", { name: "Add runtime server" })).toBeHidden({ timeout: 15_000 });
  await page.goto("/chat");
  const checkbox = page.getByRole("checkbox", { name: /ext-direct-chat/ });
  await expect(checkbox).toBeDisabled({ timeout: 20_000 });
  await expect(page.getByText(/Browser direct servers cannot be used in Chat/)).toBeVisible();
});

test("failed direct connection explains CORS and the proxy option, and can be added anyway", async ({ page }) => {
  await page.goto("/");
  await addServer(page, { name: "ext-down", url: "http://localhost:9/mcp" });
  const error = page.locator("[data-connect-error]");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText("MCP_CORS_ORIGINS");
  await expect(error).toContainText("server proxy");
  await page.getByRole("button", { name: "Add without connecting" }).click();
  await expect(page.locator('[data-section="runtime-servers"]').getByText("ext-down", { exact: true })).toBeVisible();
  await expect(page.locator('[data-section="runtime-servers"]').getByText("Offline", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("validation: name collisions, schemes and header names are rejected before connecting", async ({ page }) => {
  await page.goto("/");
  await openAddDialog(page);
  const dialog = page.getByRole("dialog", { name: "Add runtime server" });
  await dialog.getByLabel("Streamable HTTP URL").fill("ftp://example.com/mcp");
  await dialog.getByLabel("Name", { exact: true }).fill("starter-mcp-http");
  await dialog.getByRole("button", { name: "Add header" }).click();
  await dialog.getByLabel("Header 1 name").fill("Host");
  await dialog.getByRole("button", { name: "Connect and add" }).click();
  await expect(dialog.getByText("Only http and https URLs are supported.")).toBeVisible();
  await expect(dialog.getByText("This name is already used by another server.")).toBeVisible();
  await expect(dialog.getByText("This header is set by the connection itself and cannot be overridden.")).toBeVisible();
});

test("copy client config for each client from the Dashboard row menu", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Actions for starter-mcp-http" }).click();
  await page.getByRole("menuitem", { name: "Copy client config" }).click();
  const dialog = page.getByRole("dialog", { name: "Client config for starter-mcp-http" });
  await expect(dialog).toBeVisible();

  const text = () => dialog.locator('[role="tabpanel"]:visible [data-config-text]').first();
  await expect(text()).toContainText("mcp-remote");
  await expect(text()).toContainText("X-MCP-API-Key:${MCP_API_KEY}");

  await dialog.getByRole("tab", { name: "Cursor" }).click();
  await expect(text()).toContainText('"mcpServers"');
  await expect(text()).toContainText("${env:MCP_API_KEY}");

  await dialog.getByRole("tab", { name: "VS Code" }).click();
  await expect(text()).toContainText('"servers"');
  await expect(text()).toContainText("${input:mcp-api-key}");

  await dialog.getByRole("tab", { name: "Claude Code" }).click();
  await expect(dialog.locator('[role="tabpanel"]:visible [data-config-block="cli"]')).toContainText("claude mcp add --transport http starter-mcp-http http://localhost:8001/mcp");

  // 복사 버튼은 클립보드에 실제 텍스트를 넣는다. 비밀 값은 없다.
  await dialog.locator('[role="tabpanel"]:visible [data-config-block="cli"]').getByRole("button", { name: /^Copy for/ }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("claude mcp add --transport http starter-mcp-http");
  expect(clip).toContain("${MCP_API_KEY}");

  // 키 헤더를 빼면 설정에서도 사라진다
  await dialog.getByRole("checkbox").click();
  await expect(dialog.locator('[role="tabpanel"]:visible [data-config-block="cli"]')).not.toContainText("--header");
});

test("stdio servers get a uv --directory config with a repo path note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Actions for starter-mcp", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy client config" }).click();
  const dialog = page.getByRole("dialog", { name: "Client config for starter-mcp" });
  await expect(dialog.locator('[role="tabpanel"]:visible [data-config-text]').first()).toContainText('"--directory"');
  await expect(dialog.locator('[role="tabpanel"]:visible [data-config-notes]')).toContainText("/absolute/path/to/mcp-connectors");
});

test("palette Actions: Add server", async ({ page }) => {
  await gotoReady(page, "/");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("option", { name: "Add server" })).toBeVisible();
  await page.getByRole("option", { name: "Add server" }).click();
  await expect(page.getByRole("dialog", { name: "Add runtime server" })).toBeVisible();
});
