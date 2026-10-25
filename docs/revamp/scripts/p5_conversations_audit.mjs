#!/usr/bin/env node
/*
 * Phase 5 (P5-7) Chat 대화 저장 접근성 감사. p5_chat_controls_audit.mjs 와 같은 판정(axe + 자체 검사)을 다음 상태에 돌린다:
 *   대화 목록(비어 있음, 25개, 열린 대화 강조와 승인 만료 알림, 검색 결과, 검색 결과 없음, 행 메뉴 열림),
 *   이름 바꾸기, 삭제 확인, 내보내기(한 대화, 전체), 가져오기(비어 있음, 형식 오류, 가져올 수 있음),
 *   IndexedDB 를 쓸 수 없는 안내, Settings 의 로컬 데이터(IndexedDB 행).
 * 모바일(900px 이하)은 사이드바가 드로어라서 목록 상태마다 드로어를 열어 검사한다.
 * 앱은 CHAT_MOCK_LLM=1 로, mock-repo-mcp(8002)는 떠 있어야 한다.
 *
 * 사용 (저장소 루트에서):
 *   node docs/revamp/scripts/p5_conversations_audit.mjs --out <dir> --dict /tmp/dict.json [--base http://localhost:3000] [--widths 390,1280]
 *        [--themes light,dark] [--langs en,ko] [--no-shots] [--concurrency 3]
 *   (--dict 는 en.ts/ko.ts 를 JSON 으로 덤프한 파일)
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


// 저장소(IndexedDB)에 대화 n개를 직접 넣는다. 앱이 DB 를 한 번 열어 둔 뒤(스키마 생성)에 쓴다.
async function seed(page, count, lang) {
  await page.evaluate(async ({ count, lang }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("mcpc-chat");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const titlesEn = ["List the repositories", "Show the schema for rentals", "Explain this SQL error", "Compare two servers by latency", "A very long conversation title that should be cut with an ellipsis in the narrow sidebar column"];
    const titlesKo = ["저장소 목록 보기", "대여 테이블 스키마 보기", "이 SQL 오류 설명", "두 서버의 지연 시간 비교", "아주 긴 대화 제목은 좁은 사이드바 열에서 말줄임표로 잘려야 합니다"];
    const titles = lang === "ko" ? titlesKo : titlesEn;
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < count; i++) {
      const awaiting = i === 1;
      const truncated = i === 3;
      const title = titles[i % titles.length] + (i >= titles.length ? ` ${i + 1}` : "");
      const turns = [
        { id: `u${i}`, role: "user", content: title, at: now - i * 3_600_000 },
        awaiting
          ? { id: `a${i}`, role: "assistant", stopReason: "awaiting_approval", model: "claude-sonnet-4-6", endT: 500,
              iterations: [{ text: "", startT: 0, llmEndT: 400, toolUses: [{ id: "p1", name: "list_repositories", server: "mock-repo-mcp", tool: "list_repositories", input: { limit: 3 }, result: null, approval: { state: "pending", waitStartT: 500 } }] }] }
          : { id: `a${i}`, role: "assistant", stopReason: "end_turn", model: "claude-sonnet-4-6", startedAt: now - i * 3_600_000, endT: 900,
              iterations: [{ text: "", startT: 0, llmEndT: 300, usage: { input: 120 + i, output: 30 }, toolUses: [{ id: "t1", name: "list_repositories", server: "mock-repo-mcp", tool: "list_repositories", input: { limit: 5 }, result: { content: '{"repos":["alpha-service"]}', isError: false }, startT: 310, endT: 420 }] },
                { text: "Done.", toolUses: [], startT: 430, llmEndT: 880, usage: { input: 200, output: 40 } }] },
      ];
      const usage = awaiting ? null : { input: 320 + i, output: 70 };
      const record = { v: 1, id: `seed-${i}`, title, titleAuto: true, createdAt: now - i * 3_600_000 - 1000, updatedAt: now - i * (i < 3 ? 600_000 : 7_200_000), provider: "anthropic", model: "claude-sonnet-4-6", maxIterations: 5, approval: awaiting ? "manual" : "auto", servers: ["mock-repo-mcp"], runtimeServers: [], allowedTools: [], turns, usage, ...(truncated ? { truncated: true } : {}) };
      const meta = { id: record.id, title, titleAuto: true, createdAt: record.createdAt, updatedAt: record.updatedAt, provider: "anthropic", model: record.model, messageCount: 2, tokens: usage ? usage.input + usage.output : 0, pending: awaiting, truncated, size: 3000, searchText: (title + " list_repositories").toLowerCase() };
      rows.push([record, meta]);
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["conversations", "meta"], "readwrite");
      for (const [record, meta] of rows) { tx.objectStore("conversations").put(record); tx.objectStore("meta").put(meta); }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { count, lang });
}

async function runCombo(browser, width, theme, lang) {
  const height = width <= 390 ? 844 : width <= 768 ? 1024 : 900;
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: width <= 390 });
  await ctx.addCookies([{ name: "mcpc-lang", value: lang, url: opt.base }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const tag = (s) => `conv-${s}-${width}-${theme}-${lang}`;
  const meta = (route, state) => ({ route, state, width, theme, lang });
  const T = (k, f) => tr(lang, k, f);
  const mobile = width <= 900;
  const chat = "/chat?server=mock-repo-mcp";
  const click = async (loc, ms = 4000) => { await loc.click({ timeout: ms }).catch(() => {}); await page.waitForTimeout(300); };
  const composer = () => page.getByRole("textbox", { name: T("chat.message", "Message") });
  const drawerOpen = async () => { if (mobile) { await click(page.getByRole("button", { name: T("shell.openMenu", "Open menu") })); await page.waitForTimeout(450); } };
  const drawerClose = async () => { if (mobile) { await click(page.getByRole("button", { name: T("shell.closeMenu", "Close menu") })); await page.waitForTimeout(300); } };
  const list = () => page.locator("[data-conversation-list]");
  const row = (i) => list().locator("li[data-conversation-id]").nth(i);
  const waitList = () => list().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});

  // 1) 비어 있는 목록
  await open(page, opt.base + chat, "");
  await composer().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await drawerOpen();
  await snap(page, tag("list-empty"), meta("/chat", "list-empty"), errors, { noRegion: mobile });
  await drawerClose();

  // 2) 대화 25개 (승인 대기 하나, 잘림 하나 포함)
  await seed(page, 25, lang);
  await open(page, opt.base + chat, "");
  await composer().waitFor({ timeout: 20000 }).catch(() => {});
  await row(0).waitFor({ timeout: 10000 }).catch(() => {});
  await drawerOpen();
  await snap(page, tag("list-many"), meta("/chat", "list-many"), errors, { noRegion: mobile });

  // 3) 행 메뉴 열림
  await click(row(0).locator("[data-conversation-menu]"));
  await snap(page, tag("row-menu"), meta("/chat", "row-menu"), errors, { noRegion: true });

  // 4) 이름 바꾸기
  await click(page.getByRole("menuitem", { name: T("conversations.rename", "Rename") }));
  await page.getByRole("dialog").waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("rename-dialog"), meta("/chat", "rename-dialog"), errors, { noRegion: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 5) 삭제 확인
  await click(row(0).locator("[data-conversation-menu]"));
  await click(page.getByRole("menuitem", { name: T("conversations.delete", "Delete") }));
  await page.getByRole("alertdialog").waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("delete-dialog"), meta("/chat", "delete-dialog"), errors, { noRegion: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 6) 내보내기 (한 대화)
  await click(row(0).locator("[data-conversation-menu]"));
  await click(page.getByRole("menuitem", { name: T("conversations.exportOne", "Export…") }));
  await page.getByRole("dialog").waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("export-dialog"), meta("/chat", "export-dialog"), errors, { noRegion: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 7) 전체 내보내기와 가져오기 대화상자
  await click(list().locator("[data-action=conversation-more]"));
  await click(page.getByRole("menuitem", { name: T("conversations.exportAll", "Export all…") }));
  await page.getByRole("dialog").waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("export-all-dialog"), meta("/chat", "export-all-dialog"), errors, { noRegion: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await click(list().locator("[data-action=conversation-more]"));
  await click(page.getByRole("menuitem", { name: T("conversations.import", "Import…") }));
  await page.getByRole("dialog").waitFor({ timeout: 5000 }).catch(() => {});
  await snap(page, tag("import-dialog-empty"), meta("/chat", "import-dialog-empty"), errors, { noRegion: true });
  const input = page.locator("[data-import-input]");
  await input.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') }).catch(() => {});
  await page.waitForTimeout(400);
  await snap(page, tag("import-dialog-error"), meta("/chat", "import-dialog-error"), errors, { noRegion: true });
  const good = JSON.stringify({ format: "mcp-connectors.conversations", version: 1, exportedAt: new Date().toISOString(), conversations: [
    { v: 1, id: "imp-1", title: "Imported", titleAuto: false, createdAt: 1, updatedAt: 2, provider: "anthropic", model: "m", maxIterations: 5, approval: "auto", servers: [], runtimeServers: [], allowedTools: [], turns: [], usage: null },
    { v: 1, id: "imp-bad", provider: "nope" } ] });
  await input.setInputFiles({ name: "ok.json", mimeType: "application/json", buffer: Buffer.from(good) }).catch(() => {});
  await page.waitForTimeout(400);
  await snap(page, tag("import-dialog-ready"), meta("/chat", "import-dialog-ready"), errors, { noRegion: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 8) 검색 결과와 결과 없음
  const search = page.getByRole("searchbox", { name: T("conversations.searchLabel", "Search conversations by title or content") });
  await search.fill(lang === "ko" ? "스키마" : "schema").catch(() => {});
  await page.waitForTimeout(300);
  await snap(page, tag("search-results"), meta("/chat", "search-results"), errors, { noRegion: mobile });
  await search.fill("zzz-nothing").catch(() => {});
  await page.waitForTimeout(300);
  await snap(page, tag("search-none"), meta("/chat", "search-none"), errors, { noRegion: mobile });
  await search.fill("").catch(() => {});

  // 9) 대화를 열기: 열린 대화 강조 (모바일은 드로어가 닫힌 뒤 스레드)
  await click(row(0).locator("button").first());
  await page.waitForTimeout(700);
  if (mobile) await page.waitForTimeout(300);
  await snap(page, tag("opened-thread"), meta("/chat", "opened-thread"), errors);
  await drawerOpen();
  await snap(page, tag("list-active"), meta("/chat", "list-active"), errors, { noRegion: mobile });
  await drawerClose();

  // 10) 승인 대기로 저장된 대화를 열기 (만료 알림)
  await open(page, opt.base + "/chat?server=mock-repo-mcp&c=seed-1", "");
  await page.locator("[data-approval-expired]").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, tag("approval-expired"), meta("/chat", "approval-expired"), errors);
  await drawerOpen();
  await snap(page, tag("list-expired-active"), meta("/chat", "list-expired-active"), errors, { noRegion: mobile });
  await drawerClose();

  // 11) Settings 의 로컬 데이터
  await open(page, opt.base + "/settings#data", "");
  await page.locator('[data-local-data="conversations"]').waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, tag("settings-local-data"), meta("/settings", "settings-local-data"), errors);
  await ctx.close();

  // 12) IndexedDB 를 쓸 수 없는 브라우저
  const ctx2 = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: width <= 390 });
  await ctx2.addCookies([{ name: "mcpc-lang", value: lang, url: opt.base }]);
  await ctx2.addInitScript(() => { try { Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); } catch {} });
  const p2 = await ctx2.newPage();
  p2.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  await p2.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  await open(p2, opt.base + chat, "");
  await p2.getByRole("textbox", { name: T("chat.message", "Message") }).waitFor({ timeout: 20000 }).catch(() => {});
  await p2.waitForTimeout(500);
  if (mobile) { await p2.getByRole("button", { name: T("shell.openMenu", "Open menu") }).click().catch(() => {}); await p2.waitForTimeout(450); }
  await snap(p2, tag("unavailable"), meta("/chat", "unavailable"), errors, { noRegion: mobile });
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
