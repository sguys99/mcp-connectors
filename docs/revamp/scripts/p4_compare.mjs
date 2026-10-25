#!/usr/bin/env node
/*
 * Phase 4 (P4-9) 시안 대조: final.html 과 실제 앱의 같은 화면을 같은 폭과 테마로 찍어 좌우로 붙인다.
 *   node docs/revamp/scripts/p4_compare.mjs --out <dir> [--base http://localhost:3000]
 * 화면 3종(Dashboard, Inspector 응답, Chat 실행) x 1440x900/390x844 x 라이트/다크. 결과는 <dir>/compare-<screen>-<width>-<theme>.png
 * (왼쪽 final.html, 오른쪽 실제 앱). 앱은 CHAT_MOCK_LLM=1 로 떠 있어야 Chat 실행 화면이 나온다.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { chromium } = createRequire(path.join(repoRoot, "frontend", "package.json"))("playwright");
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const out = arg("--out"); const base = arg("--base", "http://localhost:3000");
if (!out) { console.error("--out required"); process.exit(2); }
fs.mkdirSync(path.join(out, "wrapped"), { recursive: true });
const wrapped = path.join(out, "wrapped", "final.html");
fs.writeFileSync(wrapped, '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + fs.readFileSync(path.join(repoRoot, "docs/revamp/design/final.html"), "utf8"));

const SQL_TOP = "SELECT f.title, COUNT(*) AS rentals FROM rental r JOIN inventory i ON i.inventory_id = r.inventory_id JOIN film f ON f.film_id = i.film_id WHERE r.rental_date >= '2022-07-01' AND r.rental_date < '2022-08-01' GROUP BY f.title ORDER BY rentals DESC, f.title LIMIT 5";
const browser = await chromium.launch();

async function shotFinal(screen, w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w <= 390 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.clear(); localStorage.setItem("mcpc-theme", t); localStorage.setItem("mcpc-lang", "en"); } catch {} }, theme);
  await page.goto("file://" + wrapped + "#" + screen, { waitUntil: "load" });
  await page.waitForTimeout(900);
  const buf = await page.screenshot();
  await ctx.close(); return buf;
}
async function shotApp(screen, w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w <= 390 });
  await ctx.addCookies([{ name: "mcpc-lang", value: "en", url: base }]);
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("mcpc-theme", t); } catch {} }, theme);
  const mobile = w <= 900;
  if (screen === "dashboard") {
    await page.goto(base + "/", { waitUntil: "load" }); await page.waitForTimeout(2500);
  } else if (screen === "inspector") {
    await page.goto(base + "/inspector?server=nl2sql-mcp-http", { waitUntil: "load" });
    if (mobile) await page.getByRole("tab").first().click().catch(() => {});
    await page.getByRole("option", { name: /^run_sql_query/ }).click({ timeout: 10000 });
    if (mobile) await page.getByRole("tab").nth(1).click().catch(() => {});
    await page.getByRole("button", { name: /Top films/ }).click({ timeout: 5000 }).catch(() => {});
    await page.getByRole("button", { name: /^Run/ }).first().click();
    await page.waitForTimeout(2500);
    if (mobile) await page.getByRole("tab").nth(2).click().catch(() => {});
    await page.waitForTimeout(400);
  } else {
    await page.goto(base + "/chat?server=nl2sql-mcp-http", { waitUntil: "load" });
    await page.getByRole("textbox", { name: "Message" }).fill(`[[tool:run_sql_query ${JSON.stringify({ sql: SQL_TOP })}]]`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForTimeout(3000);
  }
  const buf = await page.screenshot();
  await ctx.close(); return buf;
}

const ctx = await browser.newContext({ viewport: { width: 2000, height: 1000 } });
for (const [w, h] of [[1440, 900], [390, 844]]) for (const theme of ["light", "dark"]) for (const screen of ["dashboard", "inspector", "chat"]) {
  const a = (await shotFinal(screen, w, h, theme)).toString("base64");
  const b = (await shotApp(screen, w, h, theme)).toString("base64");
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w * 2 + 60, height: h + 70 });
  await page.setContent(`<body style="margin:0;background:${theme === "dark" ? "#111" : "#ddd"};font:600 14px system-ui;color:${theme === "dark" ? "#eee" : "#222"}"><div style="display:flex;gap:20px;padding:10px 20px"><div><div style="padding:4px 0">final.html (${screen}, ${w}, ${theme})</div><img src="data:image/png;base64,${a}"></div><div><div style="padding:4px 0">app (${screen}, ${w}, ${theme})</div><img src="data:image/png;base64,${b}"></div></div></body>`);
  const file = path.join(out, `compare-${screen}-${w}-${theme}.png`);
  await page.screenshot({ path: file });
  await page.close();
  console.log(file);
}
await browser.close();
