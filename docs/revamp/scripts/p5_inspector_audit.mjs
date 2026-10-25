#!/usr/bin/env node
/*
 * Phase 5 (P5-3, P5-4) Inspector 프리미티브와 관측(JSON-RPC 로그, 호출 기록, 내보내기, 팔레트) 접근성 감사. p4_audit.mjs 와 같은 판정(axe + 자체 검사)을 Resources, Prompts, 서버 정보,
 * 콘텐츠 블록 상태에 돌린다. 표적은 starter-mcp-http(8001)와 mock-repo-mcp(8002)다.
 * 아래는 P4 설명이다.
 *
 * Phase 4 (P4-9) 접근성 감사: 실제 앱(next start 권장)을 대상으로 axe-core(wcag2a/2aa/21a/21aa/22aa, best-practice)와
 * Phase 3 의 qa_check.mjs 사용자 정의 검사(가로 넘침, 잘림, 대비 표본, 겹침, 타깃 크기, 이름 없는 버튼)를 돌린다.
 * 화면 5종 x 폭 5종 x 라이트/다크 x EN/KO 와 주요 상태(팔레트, 드로어, Inspector 응답과 isError와 Timing, Chat 완료 실행, Settings 대화상자).
 *
 * 사용 (저장소 루트에서, 앱과 MCP 서버가 떠 있어야 함. Chat 상태는 CHAT_MOCK_LLM=1 로 띄운 서버가 필요):
 *   node docs/revamp/scripts/p5_inspector_audit.mjs --out <dir> --dict /tmp/dict.json [--base http://localhost:3000] [--widths 390,1280]
 *        [--themes light,dark] [--langs en,ko] [--no-shots] [--concurrency 3]
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
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|502)/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const tag = (s) => `inspector-${s}-${width}-${theme}-${lang}`;
  const meta = (state) => ({ route: "/inspector", state, width, theme, lang });
  const T = (k, f) => tr(lang, k, f);
  const mobile = width <= 900;
  const U = opt.base + "/inspector?server=starter-mcp-http";
  const go = async (query = "") => { await open(page, U + query, ""); };
  const paneTab = async (n) => { if (mobile) await page.getByRole("tab").nth(n).click().catch(() => {}); };
  const primTab = async (key, fb) => { await page.getByRole("tab", { name: new RegExp("^" + T(key, fb)) }).click({ timeout: 8000 }).catch(() => {}); };
  const press = async (key, fb) => { await page.getByRole("button", { name: new RegExp("^" + T(key, fb)) }).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); };

  // 1) Resources 탭, 읽기 전 (모바일은 목록 패널)
  await go();
  await primTab("inspector.tabResources", "Resources");
  await page.waitForTimeout(600);
  await snap(page, tag("resources-list"), meta("resources-list"), errors);
  // 2) markdown 리소스 응답
  await page.getByRole("option", { name: /^about/ }).click({ timeout: 8000 }).catch(() => {});
  await snap(page, tag("resource-request"), meta("resource-request"), errors);
  await press("inspector.read", "Read");
  await paneTab(2);
  await snap(page, tag("resource-markdown"), meta("resource-markdown"), errors);
  // 3) 이진 이미지 리소스 응답
  await paneTab(0);
  await page.getByRole("option", { name: /^logo/ }).click({ timeout: 8000 }).catch(() => {});
  await press("inspector.read", "Read");
  await paneTab(2);
  await snap(page, tag("resource-image"), meta("resource-image"), errors);
  // 4) template: 검증 오류 후 채워서 읽기
  await paneTab(0);
  await page.getByRole("option", { name: /^greeting/ }).click({ timeout: 8000 }).catch(() => {});
  await press("inspector.read", "Read");
  await snap(page, tag("template-error"), meta("template-error"), errors);
  await page.locator("input[id$='-name']").fill("Ada").catch(() => {});
  await press("inspector.read", "Read");
  await paneTab(2);
  await snap(page, tag("template-json"), meta("template-json"), errors);
  // 5) Prompts 탭: 목록, 인자 폼, 응답
  await go();
  await primTab("inspector.tabPrompts", "Prompts");
  await page.waitForTimeout(600);
  await snap(page, tag("prompts-list"), meta("prompts-list"), errors);
  await page.getByRole("option", { name: /^code_review_session/ }).click({ timeout: 8000 }).catch(() => {});
  await press("inspector.get", "Get");
  await snap(page, tag("prompt-error"), meta("prompt-error"), errors);
  await page.locator("input[id$='-language']").fill("Python").catch(() => {});
  await press("inspector.get", "Get");
  await paneTab(2);
  await snap(page, tag("prompt-messages"), meta("prompt-messages"), errors);
  // 6) sample_content (text, image, resource 블록)
  await go();
  await page.getByRole("option", { name: /^sample_content/ }).click({ timeout: 8000 }).catch(() => {});
  await press("inspector.run", "Run");
  await paneTab(2);
  await snap(page, tag("sample-content"), meta("sample-content"), errors);
  // 7) 도킹 패널 (P5-4): JSON-RPC 로그(기본 탭), 호출 기록, 시나리오 내보내기, 서버 정보, 접힘
  await go();
  await page.evaluate(() => { try { localStorage.removeItem("mcp-connectors.recentCalls"); } catch {} });
  await page.waitForTimeout(800);
  await snap(page, tag("log-connect"), meta("log-connect"), errors);
  await page.getByRole("option", { name: /^add/ }).click({ timeout: 8000 }).catch(() => {});
  await page.locator("input[id$='-a']").fill("2").catch(() => {});
  await page.locator("input[id$='-b']").fill("3").catch(() => {});
  await press("inspector.run", "Run");
  await page.getByRole("option", { name: /^echo/ }).click({ timeout: 8000 }).catch(() => {});
  await page.getByRole("button", { name: /^JSON$/ }).click({ timeout: 5000 }).catch(() => {});
  await page.locator("textarea").first().fill('{"text": ""}').catch(() => {});
  await press("inspector.run", "Run");
  await snap(page, tag("log-calls"), meta("log-calls"), errors);
  // 펼친 줄 (tools/call 요청)
  await page.locator('[data-rpc-row][data-method="tools/call"][data-kind="request"]').first().click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("log-expanded"), meta("log-expanded"), errors);
  await page.locator('[data-rpc-row][aria-expanded=true]').first().click({ timeout: 5000 }).catch(() => {});
  // 필터: 일치 없음
  await page.locator("[data-rpc-filter]").fill("zzz-no-match").catch(() => {});
  await snap(page, tag("log-nomatch"), meta("log-nomatch"), errors);
  await page.locator("[data-rpc-filter]").fill("").catch(() => {});
  // 호출 기록 탭
  await page.locator("[data-dock-tab=history]").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await snap(page, tag("history-rows"), meta("history-rows"), errors);
  await page.locator("[data-history-row] input[type=checkbox], [data-history-row] [role=checkbox]").first().click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("history-selected"), meta("history-selected"), errors);
  await page.locator("[data-action=export-scenario]").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await snap(page, tag("export-dialog"), meta("export-dialog"), errors);
  await page.keyboard.press("Escape");
  // 기록 지우기 확인 대화상자
  await page.locator("[data-action=clear-dock]").click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await snap(page, tag("history-clear-confirm"), meta("history-clear-confirm"), errors);
  await page.keyboard.press("Escape");
  // 빈 상태: 기록을 지운 뒤, 로그를 지운 뒤
  await page.evaluate(() => { try { localStorage.removeItem("mcp-connectors.recentCalls"); } catch {} });
  await go();
  await page.locator("[data-dock-tab=history]").click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("history-empty"), meta("history-empty"), errors);
  await page.locator("[data-dock-tab=log]").click({ timeout: 5000 }).catch(() => {});
  await page.locator("[data-action=clear-dock]").click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("log-empty"), meta("log-empty"), errors);
  // 명령 팔레트: 서버의 Tools / Resources / Prompts 그룹
  await go();
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(1500);
  await snap(page, tag("palette-groups"), meta("palette-groups"), errors);
  await page.keyboard.press("Escape");
  await go();
  await page.waitForTimeout(800);
  await page.locator("[data-dock-tab=server]").click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("dock-open"), meta("dock-open"), errors);
  await page.locator("[data-action=toggle-dock]").click({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("dock-closed"), meta("dock-closed"), errors);
  await page.evaluate(() => { try { localStorage.removeItem("mcpc-inspector-dock"); } catch {} });
  // 8) capability 를 선언하지 않은 서버의 빈 상태
  await page.route("**/api/mcp/mock-repo-mcp", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"initialize"')) return route.continue();
    const res = await route.fetch();
    const text = (await res.text()).replace(/"resources":\{[^}]*\},?/, "").replace(/"prompts":\{[^}]*\},?/, "");
    await route.fulfill({ response: res, body: text });
  });
  await open(page, opt.base + "/inspector?server=mock-repo-mcp", "");
  await primTab("inspector.tabResources", "Resources");
  await page.waitForTimeout(800);
  await snap(page, tag("not-declared"), meta("not-declared"), errors);
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
