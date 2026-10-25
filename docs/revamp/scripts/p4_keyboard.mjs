#!/usr/bin/env node
/*
 * Phase 4 (P4-9) 키보드와 reduced-motion 점검. 앱(next start 권장, Chat 은 CHAT_MOCK_LLM=1)과 MCP 서버가 떠 있어야 한다.
 *   node docs/revamp/scripts/p4_keyboard.mjs [--base http://localhost:3000]
 * 점검: skip link, 팔레트와 드로어의 포커스 가둠과 복귀, 단축키(⌘K, ⌘↵, Esc, /, ⌘S), 키보드 함정 없음, reduced-motion.
 * 실패가 있으면 종료 코드 1.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { chromium } = createRequire(path.join(repoRoot, "frontend", "package.json"))("playwright");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

const browser = await chromium.launch();
async function newPage(width = 1280, theme = "light", extra = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 }, colorScheme: theme, ...extra });
  await ctx.addCookies([{ name: "mcpc-lang", value: "en", url: base }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  return page;
}
// Tab 뒤 포커스 이동(포커스 가둠의 가드 요소 처리)은 비동기라 잠시 기다린 뒤 읽는다.
const tab = async (page, ms = 90) => { await page.keyboard.press("Tab"); await page.waitForTimeout(ms); };
const active = (page) => page.evaluate(() => { const e = document.activeElement; return e ? { tag: e.tagName, id: e.id, label: e.getAttribute("aria-label") || (e.innerText || "").trim().slice(0, 40), inDialog: !!e.closest("[role=dialog],[role=alertdialog]") } : null; });

/* 1. skip link */
{
  const page = await newPage();
  await page.goto(base + "/", { waitUntil: "load" }); await page.waitForTimeout(800);
  await tab(page, 400);
  const a = await active(page);
  check("skip link is the first Tab stop", /skip to content/i.test(a.label), a.label);
  const box = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const cs = getComputedStyle(document.activeElement); return { x: r.x, y: r.y, w: r.width, h: r.height, op: cs.opacity }; });
  check("skip link is visible when focused", box.w > 20 && box.h > 12 && box.x >= 0 && box.y >= 0 && Number(box.op) > 0.9, JSON.stringify(box));
  await page.keyboard.press("Enter");
  const b = await active(page);
  check("skip link moves focus to #main", b.id === "main", JSON.stringify(b));
  await page.context().close();
}

/* 2. command palette: open, trap, Esc, restore */
{
  const page = await newPage();
  await page.goto(base + "/", { waitUntil: "load" }); await page.waitForTimeout(800);
  const opener = page.getByRole("button", { name: /command palette|search commands/i }).first();
  await opener.focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").waitFor({ timeout: 4000 });
  const first = await active(page);
  check("palette: focus moves into the dialog (search input)", first.inDialog && first.tag === "INPUT", JSON.stringify(first));
  let stayed = true;
  for (let i = 0; i < 12; i++) { await tab(page); if (!(await active(page))?.inDialog) stayed = false; }
  check("palette: Tab stays inside the dialog (focus trap)", stayed);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("palette: Esc closes", (await page.getByRole("dialog").count()) === 0);
  const back = await active(page);
  check("palette: focus returns to the opener", /palette|search/i.test(back.label || ""), JSON.stringify(back));
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").waitFor({ timeout: 4000 });
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(300);
  check("palette: the same shortcut toggles it closed", (await page.getByRole("dialog").count()) === 0);
  await page.context().close();
}

/* 3. mobile drawer */
{
  const page = await newPage(390);
  await page.goto(base + "/", { waitUntil: "load" }); await page.waitForTimeout(800);
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.focus(); await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor({ timeout: 4000 });
  let stayed = true;
  for (let i = 0; i < 15; i++) { await tab(page); if (!(await active(page))?.inDialog) stayed = false; }
  check("drawer: Tab stays inside the drawer", stayed);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  check("drawer: Esc closes", (await page.getByRole("dialog").count()) === 0);
  check("drawer: focus returns to the menu button", /open menu/i.test((await active(page)).label), JSON.stringify(await active(page)));
  // 닫힌 드로어 안의 요소가 Tab 으로 잡히지 않아야 한다
  let leaked = false;
  for (let i = 0; i < 25; i++) { await tab(page, 40); const hid = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return false; const r = e.getBoundingClientRect(); return r.right <= 0 || r.left >= innerWidth || !!e.closest("[aria-hidden='true'],[inert]"); }); if (hid) leaked = true; }
  check("drawer: closed drawer does not receive Tab focus", !leaked);
  await page.context().close();
}

/* 4. inspector shortcuts */
{
  const page = await newPage();
  await page.goto(base + "/inspector?server=mock-repo-mcp", { waitUntil: "load" });
  const opt = page.getByRole("option", { name: /^list_repositories/ });
  await opt.waitFor({ timeout: 15000 });
  await page.locator("body").click({ position: { x: 700, y: 500 } });
  await page.keyboard.press("/");
  check('inspector: "/" does nothing outside the tool list (WCAG 2.1.4)', !(await page.getByLabel("Filter tools").evaluate((e) => e === document.activeElement)));
  await opt.focus(); await page.keyboard.press("/");
  check('inspector: "/" focuses the filter when the tool list has focus', await page.getByLabel("Filter tools").evaluate((e) => e === document.activeElement));
  await page.keyboard.press("Escape");
  await opt.focus(); await page.keyboard.press("ArrowDown");
  check("inspector: ArrowDown moves between tools", (await active(page)).label.startsWith("get_file_content"), (await active(page)).label);
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.getByRole("region", { name: "Response" }).getByText("OK", { exact: true }).waitFor({ timeout: 15000 }).then(() => check("inspector: ⌘/Ctrl+↵ runs the selected tool", true), () => check("inspector: ⌘/Ctrl+↵ runs the selected tool", false));
  // 분할 핸들: 방향키로 크기 조절, aria-valuenow 갱신
  const handle = page.getByRole("separator").first();
  await handle.focus(); const v0 = await handle.getAttribute("aria-valuenow"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  const v1 = await handle.getAttribute("aria-valuenow");
  check("inspector: resize handle works with arrow keys and updates aria-valuenow", v0 !== v1, `${v0} -> ${v1}`);
  await page.context().close();
}

/* 5. chat: send with ⌘↵, stop with Esc */
{
  const page = await newPage();
  await page.goto(base + "/chat?server=mock-repo-mcp", { waitUntil: "load" });
  const box = page.getByRole("textbox", { name: "Message" });
  await box.waitFor({ timeout: 20000 });
  await box.fill("[[tool:list_repositories]] [[sleep:4000]]");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 8000 }).then(() => check("chat: ⌘/Ctrl+↵ sends", true), () => check("chat: ⌘/Ctrl+↵ sends", false));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Send", exact: true }).waitFor({ timeout: 8000 }).then(() => check("chat: Esc stops the run", true), () => check("chat: Esc stops the run", false));
  await page.context().close();
}

/* 6. settings: ⌘S and confirm dialog focus handling */
{
  const page = await newPage();
  await page.goto(base + "/settings", { waitUntil: "load" });
  await page.evaluate(() => { localStorage.clear(); }); await page.goto(base + "/settings", { waitUntil: "load" });
  const key = page.getByLabel("Anthropic API key", { exact: true });
  await key.waitFor({ timeout: 10000 });
  await key.fill("sk-ant-test-0123456789abcd");
  await page.keyboard.press("ControlOrMeta+s");
  await page.getByText(/^Saved \d/).waitFor({ timeout: 5000 }).then(() => check("settings: ⌘/Ctrl+S saves", true), () => check("settings: ⌘/Ctrl+S saves", false));
  const reset = page.getByRole("button", { name: "Reset settings to defaults" });
  await reset.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  await page.getByRole("alertdialog").waitFor({ timeout: 4000 });
  check("confirm dialog: first focus is the Cancel button", /cancel/i.test((await active(page)).label), JSON.stringify(await active(page)));
  let stayed = true;
  for (let i = 0; i < 8; i++) { await tab(page); if (!(await active(page))?.inDialog) stayed = false; }
  check("confirm dialog: Tab stays inside", stayed);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("confirm dialog: Esc closes and focus returns to the opener", (await page.getByRole("alertdialog").count()) === 0 && /reset settings/i.test((await active(page)).label), JSON.stringify(await active(page)));
  await page.context().close();
}

/* 7. no keyboard traps on any route */
for (const route of ["/", "/inspector?server=mock-repo-mcp", "/chat?server=mock-repo-mcp", "/settings", "/__nope"]) {
  const page = await newPage();
  await page.goto(base + route, { waitUntil: "load" }); await page.waitForTimeout(1500);
  let last = "", same = 0, stops = 0, trapped = false;
  for (let i = 0; i < 160; i++) {
    await tab(page, 25);
    const a = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return "BODY"; return e.tagName + "#" + e.id + "." + (e.getAttribute("aria-label") || (e.innerText || "").slice(0, 20)) + "@" + Math.round(e.getBoundingClientRect().x) + "," + Math.round(e.getBoundingClientRect().y); });
    if (a === last) { if (++same >= 3) { trapped = true; break; } } else same = 0;
    last = a; stops++;
    if (a === "BODY") break;
  }
  const back = await (async () => { for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+Tab"); return true; })();
  check(`no keyboard trap: ${route}`, !trapped && back, `${stops} Tab stops`);
  await page.context().close();
}

/* 8. reduced motion: 모든 요소의 애니메이션과 전환이 사실상 0 */
for (const route of ["/", "/inspector?server=mock-repo-mcp", "/chat?server=mock-repo-mcp"]) {
  const page = await newPage(1280, "light", { reducedMotion: "reduce" });
  await page.goto(base + route, { waitUntil: "load" }); await page.waitForTimeout(1500);
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const dur = (s) => Math.max(...s.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000) || 0));
      if (cs.animationName !== "none" && dur(cs.animationDuration) > 20 && cs.animationIterationCount !== "0") out.push(`${el.tagName}.${(el.getAttribute("class") || "").slice(0, 40)} anim ${cs.animationName} ${cs.animationDuration}`);
      else if (dur(cs.transitionDuration) > 20) out.push(`${el.tagName}.${(el.getAttribute("class") || "").slice(0, 40)} transition ${cs.transitionDuration}`);
    }
    return out.slice(0, 8);
  });
  check(`reduced-motion: no animation or transition on ${route}`, offenders.length === 0, offenders.slice(0, 3).join(" | "));
  await page.context().close();
}

/* 9. 아이콘 버튼: 이름(aria-label)과 툴팁(또는 title)이 모두 있는가 (데스크톱 폭, 포인터 hover) */
for (const route of ["/", "/inspector?server=mock-repo-mcp", "/chat?server=mock-repo-mcp", "/settings"]) {
  const page = await newPage();
  await page.goto(base + route, { waitUntil: "load" }); await page.waitForTimeout(1500);
  const handles = await page.evaluateHandle(() => [...document.querySelectorAll("button,a[href],[role=button]")].filter((e) => {
    const r = e.getBoundingClientRect(); const txt = (e.innerText || "").trim();
    return r.width > 0 && r.height > 0 && !txt && !e.closest("[aria-hidden=true]");
  }));
  const n = await handles.evaluate((a) => a.length);
  const missing = [];
  for (let i = 0; i < n; i++) {
    const info = await handles.evaluate((a, i) => ({ label: a[i].getAttribute("aria-label") || a[i].getAttribute("aria-labelledby") || "", title: a[i].getAttribute("title") || "" }), i);
    if (!info.label && !info.title) { missing.push("no accessible name"); continue; }
    await page.mouse.move(0, 0);
    await (await handles.evaluateHandle((a, i) => a[i], i)).asElement().hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(650);
    const tip = await page.evaluate(() => document.querySelectorAll("[role=tooltip],[data-slot=tooltip-content]").length);
    if (!tip && !info.title) missing.push(info.label);
  }
  check(`icon-only controls have a name and a tooltip: ${route}`, missing.length === 0, `${n} icon-only controls; missing tooltip: ${[...new Set(missing)].join(", ")}`);
  await page.context().close();
}

await browser.close();
const fail = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fail.length}/${checks.length} passed`);
process.exit(fail.length ? 1 : 0);
