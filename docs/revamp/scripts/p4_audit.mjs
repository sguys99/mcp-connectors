#!/usr/bin/env node
/*
 * Phase 4 (P4-9) 접근성 감사: 실제 앱(next start 권장)을 대상으로 axe-core(wcag2a/2aa/21a/21aa/22aa, best-practice)와
 * Phase 3 의 qa_check.mjs 사용자 정의 검사(가로 넘침, 잘림, 대비 표본, 겹침, 타깃 크기, 이름 없는 버튼)를 돌린다.
 * 화면 5종 x 폭 5종 x 라이트/다크 x EN/KO 와 주요 상태(팔레트, 드로어, Inspector 응답과 isError와 Timing, Chat 완료 실행, Settings 대화상자).
 *
 * 사용 (저장소 루트에서, 앱과 MCP 서버가 떠 있어야 함. Chat 상태는 CHAT_MOCK_LLM=1 로 띄운 서버가 필요):
 *   node docs/revamp/scripts/p4_audit.mjs --out <dir> [--base http://localhost:3000] [--widths 390,1280]
 *        [--themes light,dark] [--langs en,ko] [--routes /,/inspector] [--no-states] [--no-shots] [--concurrency 3]
 *
 * Playwright 와 axe-core 는 frontend/node_modules 에서 읽는다. 문제가 있으면 종료 코드 1.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const req = createRequire(path.join(repoRoot, "frontend", "package.json"));
const { chromium } = req("playwright");
const axeSource = fs.readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");

const argv = process.argv.slice(2);
const opt = { out: null, base: "http://localhost:3000", widths: "390,768,1024,1280,1440", themes: "light,dark", langs: "en,ko",
  routes: "/,/inspector,/chat,/settings,/__nope", states: true, shots: true, concurrency: 3, dict: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--base") opt.base = argv[++i];
  else if (a === "--widths") opt.widths = argv[++i];
  else if (a === "--themes") opt.themes = argv[++i];
  else if (a === "--langs") opt.langs = argv[++i];
  else if (a === "--routes") opt.routes = argv[++i];
  else if (a === "--dict") opt.dict = argv[++i];
  else if (a === "--no-states") opt.states = false;
  else if (a === "--no-shots") opt.shots = false;
  else if (a === "--concurrency") opt.concurrency = Number(argv[++i]);
}
if (!opt.out) { console.error("--out <dir> required"); process.exit(2); }
fs.mkdirSync(opt.out, { recursive: true });

// 문구 사전: 상태 조작에 쓰는 버튼 이름을 언어별로 얻기 위해 en.ts/ko.ts 를 JSON 으로 덤프한 파일(--dict)을 읽는다.
// 없으면 EN 고정 문구로 폴백한다.
const DICT = opt.dict && fs.existsSync(opt.dict) ? JSON.parse(fs.readFileSync(opt.dict, "utf8")) : null;
const tr = (lang, key, fallback) => {
  let cur = DICT && DICT[lang];
  for (const p of key.split(".")) cur = cur && cur[p];
  return typeof cur === "string" ? cur : fallback;
};

// qa_check.mjs 의 audit() 본문을 그대로 재사용한다 (같은 판정 기준).
const qaSrc = fs.readFileSync(path.join(repoRoot, "docs/revamp/design/scripts/qa_check.mjs"), "utf8");
const auditSrc = qaSrc.slice(qaSrc.indexOf("function audit("), qaSrc.indexOf("/* ---------- runner"));
// 줄 수 제한(line-clamp)은 의도된 말줄임이라 "ellipsis 없는 잘림" 검사에서 뺀다.
const auditSrcPatched = auditSrc.replace("if (cs.textOverflow === \"ellipsis\") { out.ellipsized++; continue; }",
  "if (cs.textOverflow === \"ellipsis\" || (cs.webkitLineClamp && cs.webkitLineClamp !== \"none\") || cs.display === \"-webkit-box\") { out.ellipsized++; continue; }");
// 가로 스크롤 칩 줄처럼 조상이 스크롤 영역이면 넘치는 flex 행은 의도된 것이라 "spill" 검사에서 뺀다.
const auditSrcFinal = auditSrcPatched.replace("const er = el.getBoundingClientRect();\n    const kids",
  "if ((() => { for (let q = el.parentElement; q; q = q.parentElement) { const o = getComputedStyle(q).overflowX; if (o === \"auto\" || o === \"scroll\") return true; } return false; })()) continue;\n    const er = el.getBoundingClientRect();\n    const kids");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const results = [];
const focusResults = [];

async function snap(page, name, meta, errors) {
  await page.waitForTimeout(250);
  const a = await page.evaluate(`(${auditSrcFinal.replace(/^function audit/, "function")})(${JSON.stringify({ width: meta.width, checkTargets: true })})`);
  const axe = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
      nodes: v.nodes.slice(0, 5).map((n) => ({ t: n.target.join(" "), s: (n.failureSummary || "").split("\n").slice(0, 3).join(" | ").slice(0, 260) })) }));
  }, AXE_TAGS);
  if (opt.shots) await page.screenshot({ path: path.join(opt.out, `${name}.png`) });
  const problems = [];
  if (a.overflow.scrollWidth > a.overflow.innerWidth) problems.push(`h-overflow ${a.overflow.scrollWidth}>${a.overflow.innerWidth}`);
  if (errors.length) problems.push(...errors.map((e) => `console: ${e}`));
  if (a.clipped.length) problems.push(`clipped ${a.clipped.length}`);
  if (a.truncated.length) problems.push(`truncated ${a.truncated.length}`);
  if (a.contrast.length) problems.push(`contrast ${a.contrast.length}`);
  if (a.overlaps.length) problems.push(`overlap ${a.overlaps.length}`);
  if (a.smallTargets.length) problems.push(`small-target ${a.smallTargets.length}`);
  if (a.unnamed.length) problems.push(`unnamed ${a.unnamed.length}`);
  for (const v of axe) problems.push(`axe:${v.id}(${v.impact}) x${v.n}`);
  results.push({ name, ...meta, pass: problems.length === 0, problems, axeCount: axe.reduce((s, v) => s + v.n, 0), detail: { ...a, axe } });
  errors.length = 0;
}

async function open(page, base, route) {
  await page.goto(base + route, { waitUntil: "load" });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.addScriptTag({ content: axeSource });
}

async function runCombo(browser, width, theme, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : width <= 768 ? 1024 : 900 }, colorScheme: theme, hasTouch: width <= 390 });
  await ctx.addCookies([{ name: "mcpc-lang", value: lang, url: opt.base }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const tag = (r, s) => `${r.replace(/\W+/g, "") || "dashboard"}${s ? "-" + s : ""}-${width}-${theme}-${lang}`;
  const meta = (route, state) => ({ route, state: state || "base", width, theme, lang });
  const T = (k, f) => tr(lang, k, f);
  const routes = opt.routes.split(",");

  for (const route of routes) {
    const r = route === "/__nope" ? "/__nope" : route;
    await open(page, opt.base, r);
    await snap(page, tag(r, ""), meta(route), errors);
  }
  if (!opt.states) { await ctx.close(); return; }

  // 팔레트
  await open(page, opt.base, "/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").first().waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("/", "palette"), meta("/", "palette"), errors);
  await page.keyboard.press("Escape");
  // Dashboard: 30초 재확인이 한 번 돈 뒤 (Recent checks 에 "background" 표기 행이 생긴다. Lighthouse 가 이 상태의 대비 문제를 잡아 추가)
  const p2 = await ctx.newPage();
  await p2.clock.install();
  await open(p2, opt.base, "/");
  await p2.clock.fastForward(31000);
  await p2.waitForTimeout(2500);
  await snap(p2, tag("/", "recheck"), meta("/", "recheck"), []);
  await p2.close();
  // 드로어
  if (width <= 900) {
    await open(page, opt.base, "/");
    await page.getByRole("button", { name: T("shell.openMenu", "Open menu") }).click();
    await page.waitForTimeout(500);
    await snap(page, tag("/", "drawer"), meta("/", "drawer"), errors);
  }
  // Inspector: 정상 응답과 Timing
  await open(page, opt.base, "/inspector?server=mock-repo-mcp");
  if (width <= 900) await page.getByRole("tab").first().click().catch(() => {});
  await page.getByRole("option", { name: /^list_repositories/ }).click({ timeout: 8000 }).catch(() => {});
  if (width <= 900) await page.getByRole("tab").nth(1).click().catch(() => {});
  await page.getByRole("button", { name: new RegExp("^" + T("inspector.run", "Run")) }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (width <= 900) await page.getByRole("tab").nth(2).click().catch(() => {});
  await snap(page, tag("/inspector", "response"), meta("/inspector", "response"), errors);
  await page.getByRole("tab", { name: T("inspector.tabTiming", "Timing") }).click({ timeout: 3000 }).catch(() => {});
  await snap(page, tag("/inspector", "timing"), meta("/inspector", "timing"), errors);
  // Inspector: isError (가드레일 차단 예시)
  await open(page, opt.base, "/inspector?server=nl2sql-mcp-http");
  if (width <= 900) await page.getByRole("tab").first().click().catch(() => {});
  await page.getByRole("option", { name: /^run_sql_query/ }).click({ timeout: 8000 }).catch(() => {});
  if (width <= 900) await page.getByRole("tab").nth(1).click().catch(() => {});
  await page.getByRole("button", { name: T("inspector.exBlocked", "No WHERE") }).first().click({ timeout: 3000 }).catch(() => {});
  await page.getByRole("button", { name: new RegExp("^" + T("inspector.run", "Run")) }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (width <= 900) await page.getByRole("tab").nth(2).click().catch(() => {});
  await snap(page, tag("/inspector", "iserror"), meta("/inspector", "iserror"), errors);
  // Chat: 가짜 LLM 으로 도구 호출 1회 완료
  await open(page, opt.base, "/chat?server=mock-repo-mcp");
  await page.getByRole("textbox", { name: T("chat.message", "Message") }).fill("[[tool:list_repositories]]");
  await page.getByRole("button", { name: T("chat.send", "Send"), exact: true }).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await snap(page, tag("/chat", "run"), meta("/chat", "run"), errors);
  if (width <= 900) {
    await page.getByRole("tab", { name: T("chat.traceTab", "Trace") }).click({ timeout: 3000 }).catch(() => {});
    await snap(page, tag("/chat", "runtrace"), meta("/chat", "runtrace"), errors);
  }
  // Settings: 확인 대화상자
  await open(page, opt.base, "/settings");
  await page.getByRole("button", { name: T("settings.resetDefaults", "Reset settings to defaults") }).click({ timeout: 5000 }).catch(() => {});
  await page.getByRole("alertdialog").waitFor({ timeout: 3000 }).catch(() => {});
  await snap(page, tag("/settings", "dialog"), meta("/settings", "dialog"), errors);
  await ctx.close();
}

// 키보드 Tab 순회: 포커스 링 유무와 화면 밖 포커스(숨은 요소가 포커스를 받는 문제)를 찾는다.
async function focusWalk(browser, route, width, theme, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await ctx.addCookies([{ name: "mcpc-lang", value: lang, url: opt.base }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  await page.goto(opt.base + route, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const seen = new Set(); const issues = []; let count = 0;
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const has = (s) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
      let ring = has(cs); let p = el.parentElement;
      for (let k = 0; !ring && k < 3 && p; k++, p = p.parentElement) if (p.matches(":focus-within") && has(getComputedStyle(p))) ring = true;
      const hidden = r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= innerWidth || cs.visibility === "hidden" || !!el.closest("[aria-hidden='true'],[inert]");
      const name = el.getAttribute("aria-label") || (el.innerText || "").trim().slice(0, 30) || el.tagName;
      return { id: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), name, ring, hidden };
    });
    if (!info) continue;
    const k = info.id + info.name;
    if (seen.has(k)) break; seen.add(k); count++;
    if (!info.ring || info.hidden) issues.push(info);
  }
  focusResults.push({ route, width, theme, lang, stops: count, issues });
  await ctx.close();
}

async function pool(tasks, n) {
  const q = tasks.slice();
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const t = q.shift(); try { await t(); } catch (e) { console.error("task failed:", e.message.split("\n")[0]); results.push({ name: "crash", pass: false, problems: ["crash: " + e.message.split("\n")[0]], axeCount: 0, detail: {} }); } } }));
}

const browser = await chromium.launch();
const widths = opt.widths.split(",").map(Number), themes = opt.themes.split(","), langs = opt.langs.split(",");
const tasks = [];
for (const w of widths) for (const th of themes) for (const lg of langs) tasks.push(() => runCombo(browser, w, th, lg));
const t0 = Date.now();
await pool(tasks, opt.concurrency);
const ftasks = [];
for (const route of opt.routes.split(",").filter((r) => r !== "/__nope")) for (const w of [390, 1280]) for (const th of themes) ftasks.push(() => focusWalk(browser, route, w, th, "en"));
await pool(ftasks, opt.concurrency);
await browser.close();

results.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(opt.out, "results.json"), JSON.stringify({ results, focus: focusResults }, null, 1));
const total = results.length, failing = results.filter((r) => !r.pass);
const axeTotal = results.reduce((s, r) => s + (r.axeCount || 0), 0);
const agg = {};
for (const r of failing) for (const p of r.problems) { const id = p.replace(/ x?\d+$/, "").replace(/\d+>\d+/, "").replace(/^console: .*/, "console error"); agg[id] = (agg[id] || 0) + 1; }
console.log(`${total} states, ${failing.length} failing, axe nodes ${axeTotal}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("problem kinds (states):"); for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
const fIssues = focusResults.filter((f) => f.issues.length);
console.log(`focus walk: ${focusResults.length} runs, ${fIssues.length} with issues`);
for (const f of fIssues) console.log(`  ${f.route} ${f.width} ${f.theme}: ` + f.issues.slice(0, 6).map((i) => `${i.id}[${i.name}]${i.hidden ? "(hidden)" : ""}${i.ring ? "" : "(no ring)"}`).join(", "));
console.log("results: " + path.join(opt.out, "results.json"));
process.exit(failing.length || fIssues.length ? 1 : 0);
