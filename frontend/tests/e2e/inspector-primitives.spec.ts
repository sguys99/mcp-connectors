import { expect, test, type Page } from "@playwright/test";

// Phase 5-A (P5-3) Inspector 프리미티브 회귀. 표적은 starter-mcp-http (port 8001)이고 global-setup 이 필요하면 띄운다.
//   1) Resources 탭: 목록(개수), 텍스트(markdown 렌더링/원문), JSON, template(변수 폼, URI 미리보기), 바이너리 이미지
//   2) Prompts 탭: 필수 인자 검사, 인자를 채워 prompts/get, 메시지 렌더링
//   3) 서버 정보 패널(도킹): serverInfo, protocolVersion, capabilities, instructions, 접기(⌘J)
//   4) sample_content 도구 결과의 text, image, resource 블록
//   5) capability 를 선언하지 않은 서버의 빈 상태, ?resource= ?prompt= 딥링크

const STARTER = "/inspector?server=starter-mcp-http";

async function openStarter(page: Page, query = "") {
  await page.goto(STARTER + query);
  await expect(page.getByRole("option", { name: /^echo/ })).toBeVisible({ timeout: 15_000 });
}

const responsePane = (page: Page) => page.getByRole("region", { name: "Response" });
const listTab = (page: Page, name: "Tools" | "Resources" | "Prompts") => page.getByRole("tab", { name: new RegExp(`^${name}`) });

async function openTab(page: Page, name: "Resources" | "Prompts") {
  await listTab(page, name).click();
  await expect(listTab(page, name)).toHaveAttribute("aria-selected", "true");
}

test("Resources tab: counts, markdown, JSON and the Raw toggle", async ({ page }) => {
  await openStarter(page);
  // 개수는 서버가 선언한 목록을 불러온 뒤 채워진다.
  await expect(listTab(page, "Resources")).toContainText("4", { timeout: 15_000 });
  await expect(listTab(page, "Prompts")).toContainText("2");
  await openTab(page, "Resources");
  await expect(page.getByRole("option")).toHaveCount(4);

  await page.getByRole("option", { name: /^about/ }).click();
  await expect(page.getByRole("heading", { name: "about", level: 2 })).toBeVisible();
  await expect(page.getByText("resources/read").first()).toBeVisible();
  await page.getByRole("button", { name: /^Read/ }).click();

  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  // markdown 은 렌더링돼 보인다 (제목과 목록), 원문으로 바꾸면 # 이 보인다.
  const rendered = responsePane(page).locator("[data-rendered=markdown]");
  await expect(rendered.getByText("Canonical learning example")).toBeVisible();
  await responsePane(page).getByRole("button", { name: "Raw", exact: true }).click();
  await expect(responsePane(page).locator("pre").first()).toContainText("# starter-mcp");

  // JSON 리소스는 구문 강조된 JSON 으로 보인다.
  await page.getByRole("option", { name: /^config/ }).click();
  await page.getByRole("button", { name: /^Read/ }).click();
  await expect(responsePane(page).locator("pre").first()).toContainText('"auth_enabled"', { timeout: 15_000 });
});

test("Resources tab: a template asks for its variable, previews the URI and reads it", async ({ page }) => {
  await openStarter(page);
  await openTab(page, "Resources");
  await page.getByRole("option", { name: /^greeting/ }).click();

  // 변수가 비어 있으면 읽지 않고 오류를 보여 준다.
  await expect(page.getByTestId("resource-uri")).toHaveValue("starter://greeting/");
  await page.getByRole("button", { name: /^Read/ }).click();
  await expect(page.getByText("Required", { exact: true })).toBeVisible();

  await page.getByLabel("name").fill("Ada Lovelace");
  await expect(page.getByTestId("resource-uri")).toHaveValue("starter://greeting/Ada%20Lovelace");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).locator("pre").first()).toContainText("Ada Lovelace");
});

test("Resources tab: a binary PNG resource renders as an image", async ({ page }) => {
  await openStarter(page);
  await openTab(page, "Resources");
  await page.getByRole("option", { name: /^logo/ }).click();
  await page.getByRole("button", { name: /^Read/ }).click();

  const img = responsePane(page).locator("img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
  // 실제로 디코딩된 PNG 인지 (16x16 샘플)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(16);
  await expect(responsePane(page).getByText("image/png").first()).toBeVisible();
});

test("Prompts tab: required argument check, then prompts/get shows the messages", async ({ page }) => {
  await openStarter(page);
  await openTab(page, "Prompts");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: /^explain_tool/ }).click();
  await expect(page.getByText("prompts/get").first()).toBeVisible();

  // 필수 인자 tool_name 이 비어 있으면 보내지 않는다.
  await page.getByRole("button", { name: /^Get/ }).click();
  await expect(page.getByText("Required", { exact: true })).toBeVisible();

  await page.getByLabel("tool_name").fill("echo");
  await page.getByLabel("audience").fill("expert");
  await page.getByRole("button", { name: /^Get/ }).click();
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).getByText("prompts/get").first()).toBeVisible();
  const message = responsePane(page).locator('[data-message-role="user"]');
  await expect(message).toContainText("`echo`");
  await expect(message).toContainText("expert");

  // 여러 메시지(user, assistant, user)를 돌려주는 프롬프트
  await page.getByRole("option", { name: /^code_review_session/ }).click();
  await page.getByRole("textbox", { name: "language" }).fill("Python");
  await page.getByRole("button", { name: /^Get/ }).click();
  await expect(responsePane(page).locator("[data-message-role]")).toHaveCount(3, { timeout: 15_000 });
  await expect(responsePane(page).locator('[data-message-role="assistant"]')).toHaveCount(1);
});

test("Server info panel shows the initialize result and collapses with the shortcut", async ({ page }) => {
  await openStarter(page);
  const dock = page.getByRole("region", { name: "Inspector panel" });
  await expect(dock.getByRole("tab", { name: "Server info" })).toBeVisible();
  // 도킹 패널의 기본 탭은 JSON-RPC 로그다 (P5-4). Server info 는 탭을 눌러 연다.
  await dock.getByRole("tab", { name: "Server info" }).click();
  const info = dock.locator("[data-server-info]");
  await expect(info).toBeVisible({ timeout: 15_000 });
  await expect(info).toContainText("starter-mcp");
  await expect(info).toContainText("Streamable HTTP");
  await expect(info).toContainText("/api/mcp/starter-mcp-http");
  // 협상된 프로토콜 버전 (날짜 형식)
  await expect(info.getByText(/^\d{4}-\d{2}-\d{2}$/).first()).toBeVisible();
  await expect(info.locator('[data-capability="resources"]')).toHaveAttribute("data-declared", "true");
  await expect(info.locator('[data-capability="prompts"]')).toHaveAttribute("data-declared", "true");
  await expect(info.getByText("initialize result")).toBeVisible();
  // 원문 JSON 에 서버가 보낸 capabilities 가 그대로 있다.
  await expect(info.locator("pre")).toContainText('"capabilities"');

  // 접기: 버튼과 ⌘J
  await dock.getByRole("button", { name: /Toggle panel/ }).click();
  await expect(info).toBeHidden();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(info).toBeVisible();
});

test("sample_content renders text, image and embedded resource blocks", async ({ page }) => {
  await openStarter(page);
  await page.getByRole("option", { name: /^sample_content/ }).click();
  await page.getByRole("button", { name: /^Run/ }).click();

  const pane = responsePane(page);
  await expect(pane.getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(pane.locator("[data-block=text]")).toBeVisible();
  await expect(pane.locator("[data-block=image] img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const resource = pane.locator("[data-block=resource]");
  await expect(resource).toContainText("starter://about");
  await expect(resource.locator("[data-rendered=markdown]")).toBeVisible();
  // 블록 이름이 content[0], content[1], content[2] 로 구분된다.
  await expect(pane.getByText("content[2]")).toBeVisible();
});

test("a server that does not declare resources shows the not-declared empty state", async ({ page }) => {
  // initialize 응답에서 resources, prompts capability 를 지워 "선언하지 않은 서버"를 흉내 낸다.
  await page.route("**/api/mcp/mock-repo-mcp", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"initialize"')) return route.continue();
    const res = await route.fetch();
    const text = (await res.text()).replace(/"resources":\{[^}]*\},?/, "").replace(/"prompts":\{[^}]*\},?/, "");
    await route.fulfill({ response: res, body: text });
  });
  await page.goto("/inspector?server=mock-repo-mcp");
  await expect(page.getByRole("option", { name: /^list_repositories/ })).toBeVisible({ timeout: 15_000 });
  await openTab(page, "Resources");
  await expect(page.getByText("Not declared by this server")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/has no resources capability/)).toBeVisible();
  await openTab(page, "Prompts");
  await expect(page.getByText("Not declared by this server")).toBeVisible();
  // 서버 정보 패널에도 선언되지 않은 것으로 표시된다 (도킹 패널의 기본 탭은 로그라 Server info 탭을 연다).
  await page.getByRole("region", { name: "Inspector panel" }).getByRole("tab", { name: "Server info" }).click();
  await expect(page.locator('[data-capability="resources"]')).toHaveAttribute("data-declared", "false");
});

test("deep links ?resource= and ?prompt= pick the tab and the item", async ({ page }) => {
  await page.goto(`${STARTER}&resource=${encodeURIComponent("starter://config")}`);
  await expect(listTab(page, "Resources")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "config", level: 2 })).toBeVisible({ timeout: 15_000 });

  await page.goto(`${STARTER}&prompt=code_review_session`);
  await expect(listTab(page, "Prompts")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "code_review_session", level: 2 })).toBeVisible({ timeout: 15_000 });
});
