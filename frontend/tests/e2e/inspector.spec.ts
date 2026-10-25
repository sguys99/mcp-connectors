import { expect, test, type Page } from "@playwright/test";

import { waitForShell } from "./helpers";

// Inspector 회귀 (PRD §9 인수 기준 #5, Phase 4-B 개편 화면 기준).
//   1) 서버는 셸 탐색기가 ?server= 로 고른다. mock-repo-mcp 의 list_repositories 를 폼으로 호출한다.
//   2) 응답은 Content 탭의 블록(구문 강조 JSON)과 Timing 탭의 워터폴(프록시의 Server-Timing 실측)로 본다.
//   3) 원본 JSON 모드, 도구 필터(/), 호출 취소(notifications/cancelled), 분할 핸들 접근성을 확인한다.
//   4) 모든 MCP 요청은 같은 origin 의 프록시(/api/mcp/<name>)로만 나간다.
//
// fixture 정본: src/mcp-servers/mock_repo_mcp/fixtures/repos.json
//   → 3개 repo (alpha-service / beta-frontend / gamma-utils) + total_count=3

const SERVER_URL = "/inspector?server=mock-repo-mcp";

async function openInspector(page: Page) {
  await page.goto(SERVER_URL);
  // 3분할은 마운트 후 폭을 재서 그린다. 도구 목록이 보이면 준비된 것이다.
  await expect(page.getByRole("option", { name: /^list_repositories/ })).toBeVisible({ timeout: 15_000 });
}

const responsePane = (page: Page) => page.getByRole("region", { name: "Response" });

test("Inspector → mock-repo-mcp.list_repositories happy path (form, content, timing)", async ({ page, baseURL }) => {
  // 브라우저는 MCP 서버에 직접 붙지 않고 같은 origin 의 프록시만 쓴다.
  const mcpRequests: string[] = [];
  const serverTimings: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.endsWith("/mcp") || url.pathname.startsWith("/api/mcp/")) mcpRequests.push(req.url());
  });
  page.on("response", (res) => {
    const timing = res.headers()["server-timing"];
    if (timing && res.url().includes("/api/mcp/") && res.request().method() === "POST") serverTimings.push(timing);
  });

  await openInspector(page);
  await expect(page.getByRole("heading", { name: "Inspector", level: 1 })).toBeAttached();

  // 도구 선택 → 요청 패널에 폼이 나타난다.
  await page.getByRole("option", { name: /^list_repositories/ }).click();
  await expect(page.getByRole("heading", { name: "list_repositories", level: 2 })).toBeVisible();

  // list_repositories 는 모든 인자가 선택이라 빈 입력으로 실행한다.
  await page.getByRole("button", { name: /^Run/ }).click();

  // 상태 줄: OK 배지와 메서드, 소요 시간
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).getByText("tools/call").first()).toBeVisible();

  // 내용 블록: 구문 강조된 JSON 텍스트에 fixture 의 repo 3개와 total_count=3
  const content = responsePane(page).locator("pre").first();
  await expect(content).toContainText('"repositories"');
  await expect(content).toContainText("alpha-service");
  await expect(content).toContainText("beta-frontend");
  await expect(content).toContainText("gamma-utils");
  await expect(content).toContainText('"total_count": 3');

  // Timing 탭: 브라우저 총합 아래에 프록시 헤더(Server-Timing)로 잰 proxy 와 upstream 구간이 있다.
  await page.getByRole("tab", { name: "Timing" }).click();
  const waterfall = page.getByRole("listbox", { name: "Request timing of this call" });
  await expect(waterfall.getByRole("option", { name: /browser/ })).toBeVisible();
  await expect(waterfall.getByRole("option", { name: /proxy/ })).toBeVisible();
  await expect(waterfall.getByRole("option", { name: /upstream/ })).toBeVisible();
  expect(serverTimings.some((v) => /proxy;dur=[\d.]+/.test(v) && /upstream;dur=[\d.]+/.test(v))).toBe(true);

  // MCP 트래픽이 모두 프록시 경로였는지 (X-MCP-API-Key 는 서버가 붙이므로 브라우저에 없음)
  expect(mcpRequests.length).toBeGreaterThan(0);
  for (const url of mcpRequests) {
    expect(url.startsWith(`${baseURL}/api/mcp/`)).toBe(true);
  }
});

test("Inspector raw JSON mode syncs with the form and runs", async ({ page }) => {
  await openInspector(page);
  await page.getByRole("option", { name: /^list_repositories/ }).click();

  await page.getByLabel("name_pattern").fill("alpha");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const raw = page.getByLabel("arguments");
  // 폼 값이 JSON 으로 옮겨진다.
  expect(JSON.parse(await raw.inputValue())).toEqual({ name_pattern: "alpha" });

  // 깨진 JSON 은 입력칸 아래에 오류가 보이고 폼으로 돌아갈 수 없다.
  await raw.fill("{bad");
  await expect(page.getByText(/Invalid JSON:/)).toBeVisible();
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(raw).toBeVisible();

  // 고치고 실행하면 응답이 오고, 폼으로 돌아가면 값이 유지된다.
  await raw.fill('{"name_pattern": "beta"}');
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(responsePane(page).locator("pre").first()).toContainText("beta-frontend", { timeout: 15_000 });
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(page.getByLabel("name_pattern")).toHaveValue("beta");
});

test("Inspector tool filter: / focuses it, matches are highlighted, arrows move, Esc clears", async ({ page }) => {
  await openInspector(page);

  // "/" 는 한 글자 단축키라 도구 목록에 포커스가 있을 때만 동작한다 (WCAG 2.1.4).
  await page.locator("body").click({ position: { x: 700, y: 500 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Filter tools")).not.toBeFocused();
  await page.getByRole("option").first().focus();
  await page.keyboard.press("/");
  const filter = page.getByLabel("Filter tools");
  await expect(filter).toBeFocused();

  await filter.fill("search");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.locator("mark").first()).toHaveText(/search/i);

  await filter.fill("no-such-tool");
  await expect(page.getByText(/No match for/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(3);

  // 방향키로 목록을 움직이고 Enter 로 고른다.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
});

test("Inspector cancel sends notifications/cancelled and the next call still works", async ({ page }) => {
  await openInspector(page);
  await page.getByRole("option", { name: /^list_repositories/ }).click();

  // tools/call 응답만 길게 붙잡아 "느린 도구"를 흉내 낸다. 취소 알림은 바로 통과시킨다.
  const cancelBodies: string[] = [];
  let hold = true;
  await page.route("**/api/mcp/mock-repo-mcp", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("notifications/cancelled")) cancelBodies.push(body);
    if (hold && body.includes('"tools/call"')) {
      await new Promise((r) => setTimeout(r, 4_000));
      await route.abort("aborted").catch(() => undefined);
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: /^Run/ }).click();
  const cancel = page.getByRole("button", { name: /^Cancel/ });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  // 상태: Cancelled 배지와 안내, 취소 알림 전송
  await expect(responsePane(page).getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(responsePane(page).getByText(/notifications\/cancelled/)).toBeVisible();
  await expect.poll(() => cancelBodies.length).toBeGreaterThan(0);
  expect(cancelBodies[0]).toContain('"reason":"User cancelled from Inspector"');
  await expect(page.getByRole("button", { name: /^Run/ })).toBeEnabled();

  // 취소가 연결을 깨뜨리지 않는다: 같은 세션으로 다음 호출이 성공한다.
  hold = false;
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).locator("pre").first()).toContainText("alpha-service");
});

test("Inspector split handles expose aria values, move with arrow keys and keep the ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openInspector(page);

  const handle = page.getByRole("separator", { name: "Resize tool list" });
  for (const attr of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) {
    await expect(handle).toHaveAttribute(attr, /^\d/);
  }
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const after = Number(await handle.getAttribute("aria-valuenow"));
  expect(after).toBeGreaterThan(before);

  // 새로고침해도 폭 구간(wide)별로 저장한 비율이 돌아온다.
  await page.reload();
  await expect(page.getByRole("option", { name: /^list_repositories/ })).toBeVisible({ timeout: 15_000 });
  const restored = Number(await page.getByRole("separator", { name: "Resize tool list" }).getAttribute("aria-valuenow"));
  expect(Math.abs(restored - after)).toBeLessThan(0.5);
});

test("Inspector on a phone shows Tools / Request / Response tabs and jumps to Response on run", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SERVER_URL);
  await expect(page.getByRole("option", { name: /^list_repositories/ })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("option", { name: /^list_repositories/ }).click();
  await expect(page.getByRole("tab", { name: "Request" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByRole("tab", { name: "Response" })).toHaveAttribute("aria-selected", "true");
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("Inspector keyboard flow: Enter selects a tool in the list, then Ctrl/Cmd+Enter runs it", async ({ page }) => {
  await openInspector(page);
  await page.getByRole("option", { name: /^list_repositories/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "list_repositories", level: 2 })).toBeVisible();
  // 포커스가 도구 목록에 남아 있어도 전역 실행 단축키가 동작한다.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("⌘K palette lists 'Tools on <server>' and opens the chosen tool in Inspector", async ({ page }) => {
  await openInspector(page);
  await waitForShell(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  // 선택된 서버의 도구 그룹 (목록 캐시 또는 lazy tools/list)
  const group = palette.getByRole("group", { name: "Tools on mock-repo-mcp" });
  await expect(group).toBeVisible({ timeout: 15_000 });
  const item = group.getByRole("option", { name: /search_code/ });
  await expect(item).toBeVisible();

  await item.click();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/inspector\?server=mock-repo-mcp&tool=search_code/);
  await expect(page.getByRole("heading", { name: "search_code", level: 2 })).toBeVisible();
});
