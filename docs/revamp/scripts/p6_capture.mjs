#!/usr/bin/env node
/*
 * Phase 6 (P6-2) README 와 docs 용 화면 캡처와 데모 GIF.
 * 실제 앱(docker compose 스택 권장)에 Playwright 로 붙어 화면을 찍는다. 화면의 데이터는 모두 실제 호출 결과다(가짜 데이터 주입 없음).
 * 손대는 것은 두 가지뿐이다: Getting started 카드를 숨김 상태로 시작하고(localStorage), GIF 에는 마우스 위치를 보여 주는 커서 점을 그린다.
 *
 *   스크린샷: 1440x900, deviceScaleFactor 2, 라이트와 다크, EN. docs/assets/screenshots/<name>-<theme>.png
 *   데모 GIF: 1200x750, deviceScaleFactor 1, 라이트. 일정 간격으로 찍은 프레임을 p6_capture_post.py 가 GIF 로 묶는다. docs/assets/demo/<name>.gif
 *
 * Chat 은 실제 Anthropic API 를 쓴다. 키는 브라우저에 넣지 않고 서버 키를 쓴다:
 *   CHAT_ALLOW_SERVER_KEYS=true docker compose up -d --build --wait   (루트 .env 의 ANTHROPIC_API_KEY 를 compose 가 넘김)
 * 모델은 --model (기본 claude-haiku-4-5) 로 고르고 Settings 저장값(localStorage)으로만 넣는다.
 *
 * 사용 (저장소 루트에서):
 *   node docs/revamp/scripts/p6_capture.mjs [--base http://localhost:3000] [--only shots|gifs] [--themes light,dark]
 *        [--model claude-haiku-4-5] [--raw <dir>] [--no-post]
 *   --raw 는 원본 PNG 와 GIF 프레임을 둘 임시 폴더(기본: OS 임시 폴더). 끝나면 p6_capture_post.py 로 최적화해 docs/assets 에 쓴다.
 *
 * Playwright 는 frontend/node_modules 에서 읽는다.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const req = createRequire(path.join(repoRoot, "frontend", "package.json"));
const { chromium } = req("playwright");

const argv = process.argv.slice(2);
const opt = { base: "http://localhost:3000", only: "all", themes: "light,dark", model: "claude-haiku-4-5", raw: null, post: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") opt.base = argv[++i];
  else if (a === "--only") opt.only = argv[++i];
  else if (a === "--themes") opt.themes = argv[++i];
  else if (a === "--model") opt.model = argv[++i];
  else if (a === "--raw") opt.raw = argv[++i];
  else if (a === "--no-post") opt.post = false;
}
const raw = opt.raw ?? fs.mkdtempSync(path.join(os.tmpdir(), "p6-capture-"));
const rawShots = path.join(raw, "shots");
const rawGifs = path.join(raw, "gifs");
fs.mkdirSync(rawShots, { recursive: true });
fs.mkdirSync(rawGifs, { recursive: true });

const CHAT_QUESTION = "Which tables hold customer payments? Show me the columns of the payment table.";
const SQL = "SELECT title, rental_rate, length FROM film ORDER BY length DESC LIMIT 5";

// 시작 상태: Getting started 는 1단계만 끝난 채 숨김, 테마, 모델. API 키 필드는 비워 둔다(서버 키 사용).
function initState({ theme, model }) {
  try {
    localStorage.setItem("mcpc-theme", theme);
    localStorage.setItem("mcpc-getting-started", JSON.stringify({ v: 1, done: { startServer: true }, hidden: true }));
    localStorage.setItem("mcp-connectors.settings", JSON.stringify({ llmProvider: "anthropic", anthropicModel: model }));
  } catch {}
}

// GIF 용 커서 점. 마우스 이동만 따라가고 클릭을 가로채지 않는다.
function cursorScript() {
  const install = () => {
    if (document.getElementById("p6-cursor")) return;
    const c = document.createElement("div");
    c.id = "p6-cursor";
    c.style.cssText = "position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;"
      + "background:rgba(234,88,12,.35);border:2px solid rgba(234,88,12,.95);pointer-events:none;z-index:2147483647;transition:transform .12s";
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { c.style.transform = "scale(.7)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = ""; }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
}

async function newContext(browser, { theme, width = 1440, height = 900, dpr = 2, mobile = false, cursor = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: theme,
    hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "mcpc-lang", value: "en", url: opt.base }]);
  await ctx.addInitScript(initState, { theme, model: opt.model });
  if (cursor) await ctx.addInitScript(cursorScript);
  return ctx;
}

async function open(page, route) {
  await page.goto(opt.base + route, { waitUntil: "load" });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1500);
}

async function shot(page, name, theme) {
  await page.waitForTimeout(400);
  // 포커스 링과 깜빡이는 caret 이 그림에 남지 않게
  await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  // Refresh all 같은 동작의 확인 토스트는 화면을 가리므로 그림에서만 감춘다
  await page.addStyleTag({ content: "[data-sonner-toaster]{visibility:hidden!important}" });
  const file = path.join(rawShots, `${name}-${theme}.png`);
  await page.screenshot({ path: file, caret: "hide", animations: "disabled" });
  console.log("shot", path.basename(file));
}

// 헬스 체크를 몇 번 돌려 첫 연결(콜드 스타트) 지연이 p50 을 대표하지 않게 한다.
async function warmDashboard(page) {
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Refresh all" }).first().click();
    await page.waitForTimeout(1200);
  }
}

async function waitChatDone(page, timeout = 120000) {
  const stop = page.getByRole("button", { name: "Stop the run" });
  await stop.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await stop.waitFor({ state: "hidden", timeout });
  await page.waitForTimeout(800);
}

async function runInspectorSql(page) {
  await page.getByRole("option", { name: /^run_sql_query/ }).click();
  const sql = page.getByRole("textbox", { name: "sql" });
  await sql.fill(SQL);
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("tabpanel", { name: "Content" }).getByText(/rows?/i).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function captureShots(browser, theme) {
  // 1) Dashboard
  {
    const ctx = await newContext(browser, { theme });
    const page = await ctx.newPage();
    await open(page, "/");
    await warmDashboard(page);
    await shot(page, "dashboard", theme);
    // 2) Add server 대화상자 (빈 폼)
    await page.getByRole("button", { name: "Add server" }).first().click();
    await page.getByRole("dialog").waitFor();
    await shot(page, "add-server", theme);
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  // 3) Inspector: nl2sql run_sql_query 응답, JSON-RPC 로그 펼침, 클라이언트 설정 대화상자
  {
    const ctx = await newContext(browser, { theme });
    const page = await ctx.newPage();
    await open(page, "/inspector?server=nl2sql-mcp-http");
    await runInspectorSql(page);
    await shot(page, "inspector-call", theme);
    // 로그 도크: tools/call 응답 줄을 펼친다. 도크를 키워 본문이 보이게 한다.
    const sep = page.getByRole("separator", { name: "Resize panel" });
    const box = await sep.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, 330, { steps: 8 });
      await page.mouse.up();
    }
    await page.locator('[data-rpc-row][data-method="tools/call"][data-kind="response"]').first().click().catch(() => {});
    await shot(page, "inspector-log", theme);
    await ctx.close();
  }
  {
    const ctx = await newContext(browser, { theme });
    const page = await ctx.newPage();
    await open(page, "/inspector?server=starter-mcp-http");
    await page.locator("[data-dock-tab=server]").click();
    await page.getByRole("button", { name: "Copy client config" }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(500);
    await shot(page, "client-config", theme);
    await page.keyboard.press("Escape");
    await page.locator("[data-dock-tab=log]").click();
    // 4) Resources 탭: markdown 리소스 읽기
    await page.getByRole("tab", { name: /^Resources/ }).click();
    await page.getByRole("option", { name: /^about/ }).click();
    await page.getByRole("button", { name: /^Read/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, "inspector-resources", theme);
    await ctx.close();
  }
  // 5) Chat: 실제 LLM 으로 도구 사용 실행 완료, Trace 와 스팬 상세
  {
    const ctx = await newContext(browser, { theme });
    const page = await ctx.newPage();
    await open(page, "/chat");
    await page.getByRole("textbox", { name: "Message" }).fill(CHAT_QUESTION);
    await page.getByRole("button", { name: "Send" }).click();
    await waitChatDone(page);
    // 첫 도구 스팬을 골라 상세(입력, 출력, 시간)를 보인다
    const spans = page.locator("[data-span][data-kind=tool]");
    if (await spans.count()) await spans.first().click().catch(() => {});
    // 스팬을 고르면 대화가 그 도구 카드로 스크롤된다. 최종 답이 보이게 맨 아래로 돌아간다(상세 패널은 유지)
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Jump to latest" }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "chat", theme);
    await ctx.close();
  }
  // 6) Settings
  {
    const ctx = await newContext(browser, { theme });
    const page = await ctx.newPage();
    await open(page, "/settings");
    await shot(page, "settings", theme);
    await ctx.close();
  }
  // 7) 모바일 Dashboard (390)
  {
    const ctx = await newContext(browser, { theme, width: 390, height: 844, dpr: 2, mobile: true });
    const page = await ctx.newPage();
    await open(page, "/");
    await warmDashboard(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "mobile-dashboard", theme);
    await ctx.close();
  }
}

// 프레임 기록기: 동작과 함께 interval 마다 화면을 찍고, 끝나면 frames.json(파일, 시각) 을 쓴다.
function recorder(page, dir, interval = 110) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let on = true;
  let n = 0;
  const loop = (async () => {
    while (on) {
      const t = Date.now();
      const file = path.join(dir, `f${String(n++).padStart(4, "0")}.png`);
      // caret 깜빡임은 프레임만 늘리므로 숨긴다
      try { await page.screenshot({ path: file, caret: "hide" }); frames.push({ file: path.basename(file), t }); } catch {}
      const wait = interval - (Date.now() - t);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
  return {
    async stop(hold = 2500) {
      await new Promise((r) => setTimeout(r, hold));
      on = false;
      await loop;
      fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ frames, end: Date.now() }, null, 1));
    },
  };
}

async function glide(page, locator, { click = true } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  await page.mouse.move(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, { steps: 14 });
  await page.waitForTimeout(250);
  if (click) await page.mouse.click(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
}

async function gifInspector(browser) {
  const ctx = await newContext(browser, { theme: "light", width: 1200, height: 750, dpr: 1, cursor: true });
  const page = await ctx.newPage();
  await open(page, "/inspector?server=starter-mcp-http");
  await page.mouse.move(600, 400);
  const rec = recorder(page, path.join(rawGifs, "inspector-call"));
  await page.waitForTimeout(800);
  await glide(page, page.getByRole("button", { name: /nl2sql-mcp-http/ }));
  await page.getByRole("option", { name: /^run_sql_query/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  await glide(page, page.getByRole("option", { name: /^run_sql_query/ }));
  await page.waitForTimeout(600);
  const sql = page.getByRole("textbox", { name: "sql" });
  await glide(page, sql);
  await page.keyboard.type(SQL, { delay: 28 });
  await page.waitForTimeout(400);
  await glide(page, page.getByRole("button", { name: "Run" }));
  await page.getByRole("tabpanel", { name: "Content" }).getByText(/rows?/i).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.mouse.move(1150, 700, { steps: 10 });
  await rec.stop(2800);
  await ctx.close();
}

async function gifChat(browser) {
  const ctx = await newContext(browser, { theme: "light", width: 1200, height: 750, dpr: 1, cursor: true });
  const page = await ctx.newPage();
  await open(page, "/chat");
  await page.mouse.move(600, 400);
  const rec = recorder(page, path.join(rawGifs, "chat-tool-use"), 140);
  await page.waitForTimeout(700);
  const box = page.getByRole("textbox", { name: "Message" });
  await glide(page, box);
  await page.keyboard.type(CHAT_QUESTION, { delay: 22 });
  await page.waitForTimeout(400);
  await glide(page, page.getByRole("button", { name: "Send" }));
  // Stop 버튼 글자를 가리지 않게 커서를 Trace 쪽으로 옮긴다
  await page.mouse.move(1180, 600, { steps: 8 });
  await waitChatDone(page);
  await page.mouse.move(1150, 720, { steps: 10 });
  await rec.stop(3500);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  if (opt.only === "all" || opt.only === "shots") for (const th of opt.themes.split(",")) await captureShots(browser, th);
  if (opt.only === "all" || opt.only === "gifs") { await gifInspector(browser); await gifChat(browser); }
} finally {
  await browser.close();
}
console.log("raw:", raw);

if (opt.post) {
  const args = ["run", "--no-project", "--with", "pillow", "python", path.join(here, "p6_capture_post.py"), "--raw", raw,
    "--shots", path.join(repoRoot, "docs/assets/screenshots"), "--demo", path.join(repoRoot, "docs/assets/demo")];
  execFileSync("uv", args, { stdio: "inherit", cwd: repoRoot });
}
