import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoReady } from "./helpers";

// 스크린 리더 자동 근사 점검 (Phase 7, P7-6). 실제 VoiceOver/NVDA 실기 점검은 사람이 하고
// (docs/revamp/screen-reader-checklist.md), 여기서는 "읽힐 재료"가 회귀하지 않게 잠근다.
//   - 랜드마크 구조와 이름, 제목 수준, axe(WCAG 2.1 AA + best-practice)
//   - 라이브 영역: 토스트, Inspector 실행 상태, Chat 실행 상태(스트리밍 글자는 읽지 않음)
//   - 포커스 관리: 건너뛰기 링크, 대화상자 포커스 가두기와 되돌리기, 실행 중 버튼, 검증 오류 칸
//   - 이름: 아이콘 버튼, 보이는 글자가 이름에 들어가는지(WCAG 2.5.3), 폼 오류 연결(aria-describedby)
// 표적 서버는 global-setup 이 띄우는 starter-mcp-http 와 mock-repo-mcp 다. Chat 은 가짜 LLM(CHAT_MOCK_LLM=1)이 필요하다.

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function expectNoAxeViolations(page: Page) {
  // 진행 중인 CSS 전환(버튼 색 등)이 끝난 뒤에 잰다. 중간 색으로 대비를 재면 거짓 실패가 난다. 무한 반복(스피너)은 기다리지 않는다.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.html.slice(0, 120)} ${n.failureSummary ?? ""}`).join(" || ")}`,
  );
  expect(summary).toEqual([]);
}

// 보이는 랜드마크를 "역할 이름" 문자열로 모은다 (aria-hidden 과 display:none 제외).
async function landmarkList(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const implicit: Record<string, string> = { HEADER: "banner", NAV: "navigation", MAIN: "main", ASIDE: "complementary", FOOTER: "contentinfo", SECTION: "region" };
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("header,nav,main,aside,footer,section,[role]")) {
      if (el.closest("[aria-hidden='true']") || el.closest("[inert]")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const role = el.getAttribute("role") ?? implicit[el.tagName];
      if (!role) continue;
      // header/footer 는 main 이나 section 안에 있으면 랜드마크가 아니다.
      if ((el.tagName === "HEADER" || el.tagName === "FOOTER") && !el.getAttribute("role") && el.parentElement?.closest("main,section,article,aside,nav")) continue;
      const labelledby = el.getAttribute("aria-labelledby");
      const name =
        el.getAttribute("aria-label") ??
        (labelledby ? labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ") : "");
      // 이름 없는 section 은 region 이 아니다.
      if (role === "region" && !name) continue;
      if (!["banner", "navigation", "main", "complementary", "contentinfo", "region", "search", "form"].includes(role)) continue;
      out.push(name ? `${role} ${name}` : role);
    }
    return out;
  });
}

async function headingLevels(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6")]
      .filter((h) => !h.closest("[aria-hidden='true']"))
      .map((h) => Number(h.tagName.slice(1))),
  );
}

// 라이브 영역(role status, alert, aria-live polite/assertive)에 들어온 문장을 순서대로 모은다.
async function recordLive(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __live: string[] };
    w.__live = [];
    const sel = "[aria-live]:not([aria-live='off']),[role='status'],[role='alert']";
    const seen = new WeakSet<Element>();
    const attach = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      new MutationObserver(() => {
        const text = el.textContent?.trim() ?? "";
        if (text && w.__live.at(-1) !== text) w.__live.push(text);
      }).observe(el, { childList: true, subtree: true, characterData: true });
    };
    document.querySelectorAll(sel).forEach(attach);
    new MutationObserver(() => document.querySelectorAll(sel).forEach(attach)).observe(document.body, { childList: true, subtree: true });
  });
}
const liveLog = (page: Page) => page.evaluate(() => (window as unknown as { __live: string[] }).__live);

// ready: MCP 연결 뒤 그려지는 부분. axe 와 제목 순서는 그 뒤 상태를 봐야 한다 (SSE 때문에 networkidle 은 오지 않는다).
const SCREENS = [
  { url: "/", h1: "Servers", aside: "complementary Server explorer", ready: (p: Page) => p.getByRole("table", { name: "Registered servers" }) },
  { url: "/inspector?server=starter-mcp-http", h1: "Inspector", aside: "complementary Server explorer", ready: (p: Page) => p.getByRole("option", { name: /^echo/ }) },
  { url: "/chat?server=mock-repo-mcp", h1: "Chat", aside: "complementary Sidebar", ready: (p: Page) => p.getByRole("textbox", { name: "Message" }) },
  { url: "/settings", h1: "Settings", aside: null, ready: (p: Page) => p.getByRole("navigation", { name: "Sections" }) },
] as const;

test.describe("landmarks, headings and axe", () => {
  for (const screen of SCREENS) {
    test(`${screen.url}: shell landmarks are named and unique, headings do not skip, axe is clean`, async ({ page }) => {
      await gotoReady(page, screen.url);
      await expect(page.getByRole("heading", { level: 1, name: screen.h1 })).toBeAttached();
      await expect(screen.ready(page)).toBeVisible({ timeout: 20_000 });

      const landmarks = await landmarkList(page);
      for (const required of ["banner", "navigation Location", "navigation Views", "main", "contentinfo Status bar", "region Notifications alt+T"]) {
        expect(landmarks, required).toContain(required);
      }
      if (screen.aside) expect(landmarks).toContain(screen.aside);
      expect(landmarks.filter((l) => l === "main")).toHaveLength(1);
      // 같은 역할과 이름의 랜드마크가 두 번 나오면 랜드마크 목록에서 구별할 수 없다.
      expect(landmarks.length, landmarks.join(" | ")).toBe(new Set(landmarks).size);

      const levels = await headingLevels(page);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1], levels.join(",")).toBeLessThanOrEqual(1);

      await expectNoAxeViolations(page);
    });
  }

  test("Korean UI names landmarks and the toast region in Korean", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "mcpc-lang", value: "ko", url: baseURL ?? "http://localhost:3000" }]);
    await gotoReady(page, "/");
    const landmarks = await landmarkList(page);
    for (const required of ["navigation 현재 위치", "navigation 화면", "complementary 서버 탐색기", "contentinfo 상태 표시줄", "region 알림 alt+T"]) {
      expect(landmarks, required).toContain(required);
    }
    await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeAttached();
    await expect(page.getByRole("button", { name: /^명령, 서버 검색/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^KO/ })).toBeVisible();
  });
});

test.describe("shell focus and names", () => {
  test("skip link is the first stop and moves focus to main", async ({ page }) => {
    await gotoReady(page, "/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    // 활동 바의 현재 화면 링크는 aria-current 로 읽힌다.
    await expect(page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  test("visible text is part of the accessible name (palette button, language toggle)", async ({ page }) => {
    await gotoReady(page, "/");
    // WCAG 2.5.3: 음성 입력 사용자가 보이는 글자를 말해도 눌려야 한다.
    await expect(page.getByRole("banner").getByRole("button", { name: /^Search commands and servers/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "EN (English)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "KO (한국어)" })).toBeVisible();
  });

  test("command palette: named dialog, focus in the combobox, Tab stays inside, Esc returns focus", async ({ page }) => {
    await gotoReady(page, "/");
    const opener = page.getByRole("banner").getByRole("button", { name: /^Search commands and servers/ });
    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription("Jump to a page, open a server or change preferences.");
    // 콤보 상자 이름은 cmdk 가 목록 이름(Command palette)으로 잇고, 안내는 placeholder 로 읽힌다.
    const combobox = dialog.getByRole("combobox");
    await expect(combobox).toBeFocused();
    await expect(combobox).toHaveAttribute("placeholder", "Type a command or a server name");
    await expect(combobox).toHaveAttribute("aria-expanded", "true");

    // 화살표로 고른 항목은 aria-activedescendant 로 알린다 (포커스는 입력칸에 남음).
    await page.keyboard.press("ArrowDown");
    await expect(combobox).toHaveAttribute("aria-activedescendant", /.+/);

    // 포커스 가두기: Base UI 포커스 가드는 다음 프레임에 포커스를 되돌리므로 사람 속도로 누른다.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"))).toBe(true);
    }

    await combobox.fill("zzzz");
    await expect(dialog.getByText("No commands match")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("add server dialog: focus on the URL, errors are tied to the fields, Esc returns focus", async ({ page }) => {
    await gotoReady(page, "/");
    const opener = page.getByRole("main").getByRole("button", { name: "Add server" }).first();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add runtime server" });
    await expect(dialog).toBeVisible();
    const url = dialog.getByRole("textbox", { name: "Streamable HTTP URL" });
    await expect(url).toBeFocused();

    await dialog.getByRole("button", { name: "Connect and add" }).click();
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(url).toHaveAccessibleDescription(/Enter a URL/);
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription(/Enter a name/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("Refresh all keeps focus while busy and the result is announced in the toast region", async ({ page }) => {
    await gotoReady(page, "/");
    await recordLive(page);
    const refresh = page.getByRole("main").getByRole("button", { name: "Refresh all" });
    await refresh.focus();
    await page.keyboard.press("Enter");
    const toasts = page.getByRole("region", { name: "Notifications alt+T" });
    await expect(toasts).toHaveAttribute("aria-live", "polite");
    await expect(toasts).toContainText(/Checked \d+ HTTP servers?/);
    // 실행 중에 disabled 가 되면 포커스가 body 로 빠진다 (focusableWhenDisabled 로 막음).
    await expect(page.getByRole("main").getByRole("button", { name: /Refresh all|Checking/ })).toBeFocused();
    expect((await liveLog(page)).some((t) => /Checked \d+ HTTP servers?/.test(t))).toBe(true);
  });

  test("Getting started Hide and Show move focus to the counterpart", async ({ page }) => {
    await gotoReady(page, "/");
    const hide = page.getByRole("button", { name: "Hide Getting started" });
    await hide.focus();
    await page.keyboard.press("Enter");
    const show = page.getByRole("button", { name: /^Getting started/ });
    await expect(show).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Getting started", level: 2 })).toBeFocused();
  });
});

test.describe("Inspector", () => {
  test("required argument, validation focus, run status and tool error alert", async ({ page }) => {
    await gotoReady(page, "/inspector?server=starter-mcp-http");
    const echo = page.getByRole("option", { name: /^echo/ });
    await expect(echo).toBeVisible({ timeout: 15_000 });
    await echo.click();
    await expect(echo).toHaveAttribute("aria-selected", "true");

    const request = page.getByRole("region", { name: "Request" });
    const text = request.getByRole("textbox", { name: "text" });
    await expect(text).toHaveAttribute("aria-required", "true");
    await expect(text).toHaveAccessibleDescription(/Text to echo/);

    // 빈 값으로 실행하면 첫 오류 칸으로 포커스가 옮겨 오류 문구가 함께 읽힌다.
    await request.getByRole("button", { name: /^Run/ }).click();
    await expect(text).toBeFocused();
    await expect(text).toHaveAttribute("aria-invalid", "true");
    await expect(text).toHaveAccessibleDescription(/Required/);

    // 실행 상태는 role status 한 곳에서만 바뀐다 (Ready, Running, Finished).
    const status = request.getByRole("status");
    await expect(status).toHaveText("Ready");
    await recordLive(page);
    await text.fill("hello");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(status).toHaveText(/Finished in \d+/, { timeout: 15_000 });
    const runLog = (await liveLog(page)).filter((t) => /Running|Finished/.test(t));
    // 0.1초마다 읽히지 않는다: 짧은 호출에서 상태 변화는 몇 번 이하다.
    expect(runLog.length).toBeLessThanOrEqual(4);

    const response = page.getByRole("region", { name: "Response" });
    await expect(response.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");

    // 도구 오류(isError)는 alert 로 알린다. add 에 문자열을 넣어 서버가 거절하게 한다.
    await page.getByRole("option", { name: /^add/ }).click();
    await request.getByRole("button", { name: "JSON", exact: true }).click();
    await request.getByRole("textbox", { name: /arguments/i }).fill('{"a": "x", "b": 1}');
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(response.getByRole("alert")).toContainText("isError", { timeout: 15_000 });

    // Reset 은 폭이 좁아 글자가 숨어도 이름이 남는다.
    await expect(request.getByRole("button", { name: "Reset" })).toBeVisible();
    // JSON-RPC 로그는 이름 있는 영역이고 새 줄을 저절로 읽지 않는다.
    const rpc = page.getByRole("region", { name: "JSON-RPC log" });
    await expect(rpc).toBeAttached();
    expect(await rpc.getAttribute("aria-live")).not.toBe("polite");
  });
});

test.describe("Chat", () => {
  const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

  test.beforeEach(async ({ page }) => {
    await gotoReady(page, "/chat?server=mock-repo-mcp");
    await expect(composer(page)).toBeVisible({ timeout: 20_000 });
    const blocked = await page.getByText(/API key is not set/).isVisible();
    test.skip(blocked, "start the dev server with CHAT_MOCK_LLM=1 to run the Chat e2e");
  });

  test("run status is announced once per phase, the thread is not live, Esc stop is announced", async ({ page }) => {
    // 대화 영역은 log 이지만 aria-live off: 스트리밍 글자가 하나씩 읽히지 않는다.
    await expect(page.getByRole("log", { name: "Conversation" })).toHaveAttribute("aria-live", "off");
    await expect(page.getByRole("radiogroup", { name: "Approval" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Token usage" })).toBeVisible();

    await recordLive(page);
    await composer(page).fill("[[tool:list_repositories]] [[sleep:300]]");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Tool call mock-repo-mcp / list_repositories" })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => liveLog(page), { timeout: 15_000 }).toContain("Response complete.");
    const log = await liveLog(page);
    const working = log.indexOf("The model is working.");
    const done = log.indexOf("Response complete.");
    expect(working, log.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(done, log.join(" | ")).toBeGreaterThan(working);
    // 도구 호출 단계는 호출이 한 프레임보다 짧으면 그려지지 않을 수 있다(CI). 나왔다면 작업 중과 완료 사이다.
    const calling = log.indexOf("Calling list_repositories.");
    if (calling >= 0) {
      expect(calling).toBeGreaterThan(working);
      expect(calling).toBeLessThan(done);
    }
    // 답변 본문(스트리밍 글자)은 라이브 영역에 들어오지 않는다.
    expect(log.some((t) => t.includes("Mock summary"))).toBe(false);
    await expect(composer(page)).toBeFocused();

    await recordLive(page);
    await composer(page).fill("[[sleep:3000]] long");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop the run" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => liveLog(page)).toContain("Response stopped.");
    await expect(composer(page)).toBeFocused();
  });

  test("manual approval is announced and its card has named Approve and Deny buttons", async ({ page }) => {
    await page.getByRole("radio", { name: "Manual" }).click();
    await recordLive(page);
    await composer(page).fill("[[tool:list_repositories]]");
    await composer(page).press("Enter");
    const card = page.getByRole("group", { name: "Waiting for your approval" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => liveLog(page)).toContain("list_repositories is waiting for your approval.");
    await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Deny" })).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => liveLog(page), { timeout: 15_000 }).toContain("Response complete.");
  });

  test("conversation menu and rename dialog return focus to the row button", async ({ page }) => {
    await composer(page).fill("[[sleep:50]] hello");
    await page.keyboard.press("Enter");
    const more = page.getByRole("button", { name: "Actions for [[sleep:50]] hello" });
    await expect(more).toBeVisible({ timeout: 15_000 });
    await more.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Actions for [[sleep:50]] hello" });
    await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();

    await page.keyboard.press("Enter");
    await menu.getByRole("menuitem", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename conversation" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test.describe("Settings", () => {
  test("key toggle names carry the state, save is announced, reset confirm focuses Cancel and returns", async ({ page }) => {
    await gotoReady(page, "/settings");
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();

    const show = page.getByRole("button", { name: "Show Anthropic API key" });
    // 이름이 Show/Hide 로 바뀌므로 aria-pressed 를 함께 쓰지 않는다 ("Hide ..., pressed" 이중 표현 방지).
    await expect(show).not.toHaveAttribute("aria-pressed", /.*/);
    await show.click();
    await expect(page.getByRole("button", { name: "Hide Anthropic API key" })).toBeFocused();

    await recordLive(page);
    await page.getByRole("textbox", { name: "Anthropic API key" }).fill("sk-ant-a11y");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => liveLog(page)).toContainEqual(expect.stringMatching(/^Saved /));
    await expect(page.getByRole("status").filter({ hasText: "No unsaved changes" })).toBeVisible();

    const reset = page.getByRole("button", { name: /^Reset settings/ });
    await reset.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog", { name: "Reset settings?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAccessibleDescription(/resets all settings/);
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(reset).toBeFocused();
  });
});

test.describe("mobile width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bottom tab bar is the Views navigation and the drawer returns focus to the menu button", async ({ page }) => {
    await gotoReady(page, "/inspector?server=starter-mcp-http");
    const landmarks = await landmarkList(page);
    expect(landmarks.filter((l) => l === "navigation Views")).toHaveLength(1);
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close menu" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
