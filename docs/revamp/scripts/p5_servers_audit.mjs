#!/usr/bin/env node
/*
 * Phase 5 (P5-5) 서버 연결 관리 접근성 감사. p5_inspector_audit.mjs 와 같은 판정(axe + 자체 검사)을 다음 상태에 돌린다:
 *   Dashboard Runtime 섹션(빈 상태, 서버 행, 오프라인 경고), 서버 추가 대화상자(빈 입력, 검증 오류, 헤더 행, CORS 연결 실패 안내, 수정),
 *   사이드바 Runtime 그룹, 행 메뉴, 삭제 확인, Inspector Server info(런타임), 클라이언트 설정 복사 대화상자(클라이언트 4종 + stdio),
 *   명령 팔레트 Actions, Chat 도구 목록의 직결 서버 안내.
 * 앱은 MCP_ALLOW_RUNTIME_PROXY=true CHAT_MOCK_LLM=1 로, starter-mcp-http(8001)와 mock-repo-mcp(8002)는 떠 있어야 한다.
 * --proxy-off: 서버 프록시가 꺼진 앱(MCP_ALLOW_RUNTIME_PROXY 미설정, 기본값)에서 서버 추가 대화상자 상태만 감사한다
 *   (P5-10 추가). 프록시 라디오가 비활성이고 꺼짐 안내가 보이는지도 확인한다. 앱을 그 설정으로 따로 띄워 한 번 더 돌린다.
 *
 * 사용 (저장소 루트에서):
 *   node docs/revamp/scripts/p5_servers_audit.mjs --out <dir> --dict /tmp/dict.json [--base http://localhost:3000] [--widths 390,1280]
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
  routes: "/inspector?server=starter-mcp-http", states: true, shots: true, concurrency: 3, dict: null, proxyOff: false };
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
  else if (a === "--proxy-off") opt.proxyOff = true;
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
  const tag = (s) => `servers-${s}-${width}-${theme}-${lang}`;
  const meta = (state) => ({ route: "/", state, width, theme, lang });
  const T = (k, f) => tr(lang, k, f);
  const mobile = width <= 900;
  const go = async (route) => { await open(page, opt.base + route, ""); };
  const click = async (loc, ms = 4000) => { await loc.click({ timeout: ms }).catch(() => {}); await page.waitForTimeout(300); };
  const openAdd = async () => { await click(page.getByRole("button", { name: T("runtime.addServer", "Add server") }).first()); await page.waitForTimeout(400); };
  const dialog = () => page.getByRole("dialog");
  // 토스트는 대화상자 배경막 뒤에 깔리면 대비 측정이 왜곡되므로, 다음 상태로 가기 전에 사라질 때까지 기다린다.
  const settle = async () => { await page.locator("li.cn-toast").first().waitFor({ state: "detached", timeout: 8000 }).catch(() => {}); };
  // 모바일에서는 탐색기가 드로어 안이라 헤더/Dashboard 의 버튼을 쓴다.
  const fillAdd = async (url, name, mode) => {
    await dialog().getByLabel(T("runtime.url", "Streamable HTTP URL")).fill(url);
    await dialog().getByLabel(T("runtime.name", "Name"), { exact: true }).fill(name);
    if (mode === "proxy") await dialog().getByRole("radio", { name: new RegExp(T("runtime.modeProxy", "Server proxy")) }).click().catch(() => {});
  };
  const addHeader = async (n, v) => {
    await dialog().getByRole("button", { name: T("runtime.addHeader", "Add header") }).click();
    const i = (await dialog().locator("[data-header-row]").count());
    await dialog().getByLabel(T("runtime.headerName", "Header {n} name").replace("{n}", String(i)), { exact: true }).fill(n);
    await dialog().getByLabel(T("runtime.headerValue", "Header {n} value").replace("{n}", String(i)), { exact: true }).fill(v);
  };

  if (opt.proxyOff) {
    // 프록시가 꺼진 기본 설정: 대화상자의 서버 프록시 라디오는 비활성이고 이유를 안내한다.
    await go("/");
    await openAdd();
    const proxyRadio = dialog().getByRole("radio", { name: new RegExp(T("runtime.modeProxy", "Server proxy")) });
    const disabled = await proxyRadio.isDisabled().catch(() => false);
    const hint = await dialog().getByText(T("runtime.modeProxyOff", "__missing__")).isVisible().catch(() => false);
    if (!disabled) errors.push("proxy radio is not disabled with the proxy off");
    if (!hint) errors.push("proxy-off hint is not visible");
    await snap(page, tag("add-proxy-off"), meta("add-proxy-off"), errors);
    await fillAdd("ftp://x", "Bad Name");
    await click(dialog().getByRole("button", { name: T("runtime.connectAdd", "Connect and add") }));
    await snap(page, tag("add-proxy-off-errors"), meta("add-proxy-off-errors"), errors);
    await ctx.close();
    return;
  }

  // 1) Dashboard Runtime 빈 상태
  await go("/");
  await snap(page, tag("dash-runtime-empty"), meta("dash-runtime-empty"), errors);
  // 2) 서버 추가 대화상자: 빈 입력, 검증 오류
  await openAdd();
  await snap(page, tag("add-empty"), meta("add-empty"), errors);
  await fillAdd("ftp://x", "Bad Name");
  await addHeader("Host", "a");
  await click(dialog().getByRole("button", { name: T("runtime.connectAdd", "Connect and add") }));
  await snap(page, tag("add-errors"), meta("add-errors"), errors);
  await page.keyboard.press("Escape");
  // 3) CORS/네트워크 실패 안내 + 연결하지 않고 추가
  await go("/");
  await openAdd();
  await fillAdd("http://localhost:9/mcp", "ext-down");
  await click(dialog().getByRole("button", { name: T("runtime.connectAdd", "Connect and add") }));
  await page.waitForSelector("[data-connect-error]", { timeout: 15000 }).catch(() => {});
  await snap(page, tag("add-cors-error"), meta("add-cors-error"), errors);
  await click(dialog().getByRole("button", { name: T("runtime.addAnyway", "Add without connecting") }));
  await page.waitForTimeout(1500);
  await settle();
  // 4) 직결과 프록시 서버를 추가한 Dashboard
  await openAdd();
  await fillAdd("http://localhost:8001/mcp", "ext-direct");
  await addHeader("X-Api-Key", "audit_value_test_fixture");
  await dialog().locator("[data-header-row] button[aria-pressed]").first().click().catch(() => {});
  await snap(page, tag("add-header-revealed"), meta("add-header-revealed"), errors);
  await click(dialog().getByRole("button", { name: T("runtime.connectAdd", "Connect and add") }));
  await page.waitForTimeout(2000);
  await settle();
  await openAdd();
  await fillAdd("http://localhost:8002/mcp", "ext-proxy", "proxy");
  await snap(page, tag("add-proxy-selected"), meta("add-proxy-selected"), errors);
  await click(dialog().getByRole("button", { name: T("runtime.connectAdd", "Connect and add") }));
  await page.waitForTimeout(2500);
  await settle();
  await snap(page, tag("dash-runtime-rows"), meta("dash-runtime-rows"), errors);
  // 5) 행 메뉴, 수정, 삭제 확인
  await click(page.locator('[data-section="runtime-servers"]').getByRole("button", { name: T("runtime.menuLabel", "Actions for {name}").replace("{name}", "ext-direct") }));
  await snap(page, tag("row-menu"), meta("row-menu"), errors, { noRegion: true });
  await click(page.getByRole("menuitem", { name: T("runtime.menuEdit", "Edit") }));
  await snap(page, tag("edit-dialog"), meta("edit-dialog"), errors);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await click(page.locator('[data-section="runtime-servers"]').getByRole("button", { name: T("runtime.menuLabel", "Actions for {name}").replace("{name}", "ext-proxy") }));
  await click(page.getByRole("menuitem", { name: T("runtime.menuRemove", "Remove") }));
  await snap(page, tag("remove-confirm"), meta("remove-confirm"), errors);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 6) 클라이언트 설정 복사 (등록 http: 클라이언트 4종, stdio, 런타임)
  const openConfig = async (name) => {
    await click(page.getByRole("button", { name: T("runtime.menuLabel", "Actions for {name}").replace("{name}", name) }).last());
    await click(page.getByRole("menuitem", { name: T("runtime.menuCopyConfig", "Copy client config") }));
    await page.waitForTimeout(400);
  };
  await openConfig("starter-mcp-http");
  await snap(page, tag("config-desktop"), meta("config-desktop"), errors);
  for (const [id, label] of [["cursor", "Cursor"], ["vscode", "VS Code"], ["claude-code", "Claude Code"]]) {
    await click(dialog().getByRole("tab", { name: label }));
    await snap(page, tag("config-" + id), meta("config-" + id), errors);
  }
  await dialog().getByRole("button", { name: new RegExp("^" + T("clientConfig.copyLabel", "Copy for").split("{")[0]) }).first().click().catch(() => {});
  await snap(page, tag("config-copied"), meta("config-copied"), errors);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await openConfig("starter-mcp");
  await snap(page, tag("config-stdio"), meta("config-stdio"), errors);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await openConfig("ext-direct");
  await snap(page, tag("config-runtime"), meta("config-runtime"), errors);
  await page.keyboard.press("Escape");
  // 7) Inspector: 사이드바 Runtime 그룹, Server info 탭(런타임), 팔레트 Actions
  await go("/inspector?server=ext-direct");
  await page.waitForTimeout(1200);
  if (mobile) { await click(page.getByRole("button", { name: T("shell.openMenu", "Open menu") })); await page.waitForTimeout(400); }
  await snap(page, tag("sidebar-runtime"), meta("sidebar-runtime"), errors);
  if (mobile) await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await click(page.locator("[data-dock-tab=server]"));
  await snap(page, tag("inspector-server-info"), meta("inspector-server-info"), errors);
  await click(page.locator("[data-action=open-config]"));
  await snap(page, tag("inspector-config-open"), meta("inspector-config-open"), errors);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(1200);
  await snap(page, tag("palette-actions"), meta("palette-actions"), errors);
  await page.keyboard.press("Escape");
  // 8) Chat: 직결 서버는 선택할 수 없고 이유를 보여 준다
  await go("/chat");
  await page.waitForTimeout(1200);
  if (mobile) { await click(page.getByRole("button", { name: T("shell.openMenu", "Open menu") })); await page.waitForTimeout(500); }
  await snap(page, tag("chat-runtime-unavailable"), meta("chat-runtime-unavailable"), errors);
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
