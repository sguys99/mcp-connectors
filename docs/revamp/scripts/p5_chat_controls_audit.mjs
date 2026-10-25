#!/usr/bin/env node
/*
 * Phase 5 (P5-6) Chat 실행 제어 접근성 감사. p5_servers_audit.mjs 와 같은 판정(axe + 자체 검사)을 다음 상태에 돌린다:
 *   툴바(기본, 수동 선택, OpenRouter 입력), 승인 카드(대기, 호출 둘과 모두 승인 막대, 하나 승인 후 대기, 거부 결과),
 *   토큰 미터(보고됨, 컨텍스트 미터, 보고되지 않음), Trace(승인 대기 스팬, 대기 스팬 상세, LLM 스팬의 토큰 상세),
 *   반복 한도 알림, Settings 의 기본 최대 반복 필드.
 * 앱은 CHAT_MOCK_LLM=1 로, mock-repo-mcp(8002)는 떠 있어야 한다.
 *
 * 사용 (저장소 루트에서):
 *   node docs/revamp/scripts/p5_chat_controls_audit.mjs --out <dir> --dict /tmp/dict.json [--base http://localhost:3000] [--widths 390,1280]
 *        [--themes light,dark] [--langs en,ko] [--no-shots] [--concurrency 3]
 *   (--dict 는 en.ts/ko.ts 를 JSON 으로 덤프한 파일: node --experimental-strip-types 로 두 파일을 import 해 { en, ko } 를 쓰면 된다)
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
const opt = { out: null, base: "http://localhost:3000", widths: "390,768,900,1024,1440", themes: "light,dark", langs: "en,ko",
  routes: "/inspector?server=starter-mcp-http", states: true, shots: true, concurrency: 3, dict: null };
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

async function snap(page, name, meta, errors, opts = {}) {
  await page.waitForTimeout(250);
  const a = await page.evaluate(`(${auditSrcFinal.replace(/^function audit/, "function")})(${JSON.stringify({ width: meta.width, checkTargets: true })})`);
  const axe = await page.evaluate(async ([tags, noRegion]) => {
    // 열린 메뉴 팝업은 body 로 포털되어 랜드마크 밖이다. 그 상태에서는 region 규칙만 끈다 (나머지 규칙은 그대로).
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"], ...(noRegion ? { rules: { region: { enabled: false } } } : {}) });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
      nodes: v.nodes.slice(0, 5).map((n) => ({ t: n.target.join(" "), s: (n.failureSummary || "").split("\n").slice(0, 3).join(" | ").slice(0, 260) })) }));
  }, [AXE_TAGS, Boolean(opts.noRegion)]);
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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const tag = (s) => `chatctl-${s}-${width}-${theme}-${lang}`;
  const meta = (route, state) => ({ route, state, width, theme, lang });
  const T = (k, f) => tr(lang, k, f);
  const mobile = width <= 900;
  const chat = "/chat?server=mock-repo-mcp";
  const composer = () => page.getByRole("textbox", { name: T("chat.message", "Message") });
  const ask = async (text) => {
    await composer().fill(text);
    await page.getByRole("button", { name: T("chat.send", "Send"), exact: true }).click();
  };
  const click = async (loc, ms = 4000) => { await loc.click({ timeout: ms }).catch(() => {}); await page.waitForTimeout(300); };
  const manual = () => click(page.getByRole("radio", { name: T("chat.approvalManual", "Manual") }));
  const traceTab = () => click(page.getByRole("tab", { name: T("chat.traceTab", "Trace") }));
  const threadTab = () => click(page.getByRole("tab", { name: T("chat.threadTab", "Thread") }));
  const waitFor = (loc, ms = 15000) => loc.first().waitFor({ state: "visible", timeout: ms }).catch(() => {});
  const approve = () => page.getByRole("button", { name: T("chat.approve", "Approve"), exact: true });
  const done = () => waitFor(page.locator("[data-testid=turn-tokens], footer").first());

  // 1) 기본 툴바와 빈 대화
  await open(page, opt.base + chat, "");
  await waitFor(composer());
  await snap(page, tag("toolbar-default"), meta("/chat", "toolbar-default"), errors);
  // 2) 수동 선택
  await manual();
  await snap(page, tag("toolbar-manual"), meta("/chat", "toolbar-manual"), errors);
  // 3) 승인 대기 (호출 하나)
  await ask("[[tool:list_repositories]] [[sleep:30]]");
  await waitFor(approve());
  await page.waitForTimeout(600);
  await snap(page, tag("approval-pending"), meta("/chat", "approval-pending"), errors);
  if (mobile) { await traceTab(); await page.waitForTimeout(400); }
  await snap(page, tag("approval-trace-waiting"), meta("/chat", "approval-trace-waiting"), errors);
  const waitRow = page.getByRole("option", { name: /list_repositories.*(Waiting|대기)/ }).first();
  await click(waitRow);
  await snap(page, tag("approval-trace-detail"), meta("/chat", "approval-trace-detail"), errors);
  if (mobile) await threadTab();
  // 4) 승인 후 완료, 토큰
  await click(approve());
  await page.getByRole("log").getByText(/Mock summary|모의|mock/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, tag("approved-done"), meta("/chat", "approved-done"), errors);
  // LLM 스팬 상세 (토큰)
  if (mobile) await traceTab();
  await click(page.getByRole("option", { name: /^LLM, LLM #1/ }).first());
  await snap(page, tag("trace-llm-tokens"), meta("/chat", "trace-llm-tokens"), errors);
  if (mobile) await threadTab();
  // 5) 호출 둘: 모두 승인 막대, 하나 승인 후 대기, 거부 결과
  await ask("[[tool:list_repositories]] [[tool:list_repositories]] [[sleep:20]]");
  await waitFor(page.getByRole("button", { name: T("chat.approveAll", "Approve all") }));
  await page.waitForTimeout(500);
  await snap(page, tag("approval-two"), meta("/chat", "approval-two"), errors);
  await click(approve().first());
  await snap(page, tag("approval-one-decided"), meta("/chat", "approval-one-decided"), errors);
  await click(page.getByRole("button", { name: T("chat.deny", "Deny"), exact: true }).first());
  await page.getByRole("log").getByText(/Mock summary|모의|mock/i).nth(1).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, tag("denied-result"), meta("/chat", "denied-result"), errors);
  await ctx.close();

  // 6) 자동 모드: 토큰 미터(보고됨), 보고되지 않음, 반복 한도, OpenRouter 입력
  const ctx2 = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : width <= 768 ? 1024 : 900 }, colorScheme: theme, hasTouch: width <= 390 });
  await ctx2.addCookies([{ name: "mcpc-lang", value: lang, url: opt.base }]);
  const p2 = await ctx2.newPage();
  p2.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  await p2.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const page2 = p2;
  const ask2 = async (text) => {
    await page2.getByRole("textbox", { name: T("chat.message", "Message") }).fill(text);
    await page2.getByRole("button", { name: T("chat.send", "Send"), exact: true }).click();
  };
  await open(page2, opt.base + chat, "");
  await page2.getByRole("textbox", { name: T("chat.message", "Message") }).waitFor({ timeout: 15000 }).catch(() => {});
  await ask2("[[tool:list_repositories]] [[sleep:20]]");
  await page2.getByRole("log").getByText(/Mock summary|모의|mock/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page2.waitForTimeout(500);
  await snap(page2, tag("tokens-reported"), meta("/chat", "tokens-reported"), errors);
  await page2.getByRole("button", { name: T("chat.clear", "Clear chat") }).click().catch(() => {});
  await page2.getByRole("alertdialog").getByRole("button", { name: T("chat.clearAction", "Clear") }).click().catch(() => {});
  await page2.waitForTimeout(500);
  await ask2("[[tool:list_repositories]] [[usage:off]] [[sleep:20]]");
  await page2.getByRole("log").getByText(/Mock summary|모의|mock/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page2.waitForTimeout(500);
  await snap(page2, tag("tokens-not-reported"), meta("/chat", "tokens-not-reported"), errors);
  const iter = page2.getByLabel(T("chat.maxIterations", "Max iterations"));
  await iter.fill("2").catch(() => {});
  await iter.blur().catch(() => {});
  await ask2("[[tool:list_repositories]] [[loop]] [[sleep:5]]");
  await page2.getByRole("log").getByText(/2/).last().waitFor({ timeout: 15000 }).catch(() => {});
  await page2.waitForTimeout(1500);
  await snap(page2, tag("iteration-limit"), meta("/chat", "iteration-limit"), errors);
  await page2.getByRole("combobox").first().click().catch(() => {});
  await page2.getByRole("option", { name: "OpenRouter" }).click().catch(() => {});
  await page2.waitForTimeout(400);
  await snap(page2, tag("toolbar-openrouter"), meta("/chat", "toolbar-openrouter"), errors);
  await open(page2, opt.base + "/settings", "");
  await page2.getByLabel(T("settings.maxIterations", "Default max iterations")).waitFor({ timeout: 10000 }).catch(() => {});
  await snap(page2, tag("settings-max-iterations"), meta("/settings", "settings-max-iterations"), errors);
  await ctx2.close();
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
await browser.close();

results.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(opt.out, "results.json"), JSON.stringify({ results }, null, 1));
const total = results.length, failing = results.filter((r) => !r.pass);
const axeTotal = results.reduce((s, r) => s + (r.axeCount || 0), 0);
const agg = {};
for (const r of failing) for (const p of r.problems) { const id = p.replace(/ x?\d+$/, "").replace(/\d+>\d+/, "").replace(/^console: .*/, "console error"); agg[id] = (agg[id] || 0) + 1; }
console.log(`${total} states, ${failing.length} failing, axe nodes ${axeTotal}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("problem kinds (states):"); for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
for (const r of failing.slice(0, 12)) console.log(`  FAIL ${r.name}: ${r.problems.join("; ")}`);
console.log("results: " + path.join(opt.out, "results.json"));
process.exit(failing.length ? 1 : 0);
