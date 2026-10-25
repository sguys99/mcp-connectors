#!/usr/bin/env node
/*
 * Phase 4 (P4-9) 경계 폭 점검: 900, 901, 1080, 1081, 1280, 1281px 에서 CSS(Tailwind, globals.css)와 JS(MOBILE_QUERY, 레이아웃 구간)가
 * 같은 쪽으로 판정하는지, 화면 5종에 가로 넘침이 없는지 본다.  node docs/revamp/scripts/p4_breakpoints.mjs [--base http://localhost:3000]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { chromium } = createRequire(path.join(repoRoot, "frontend", "package.json"))("playwright");
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const browser = await chromium.launch();
let fail = 0;
const rows = [];
// 기대값: [폭, 모바일 여부, --side-w, --trace-w, --rq]
const EXPECT = [
  [900, true], [901, false], [1080, false], [1081, false], [1280, false], [1281, false],
];
const SIDE = { 900: "min(320px, 86vw)", 901: "200px", 1080: "200px", 1081: "220px", 1280: "220px", 1281: "248px" };
const TRACE = { 901: "340px", 1080: "340px", 1081: "340px", 1280: "340px", 1281: "420px" };
for (const [w, mobile] of EXPECT) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await ctx.addCookies([{ name: "mcpc-lang", value: "en", url: base }]);
  const page = await ctx.newPage();
  for (const route of ["/", "/inspector?server=mock-repo-mcp", "/chat?server=mock-repo-mcp", "/settings", "/__nope"]) {
    await page.goto(base + route, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const disp = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : "none"; };
      return {
        sideW: css.getPropertyValue("--side-w").trim(), traceW: css.getPropertyValue("--trace-w").trim(),
        jsMobile: matchMedia("(max-width: 900px)").matches,
        tabBar: disp("nav[aria-label='Main'] , [data-mobile-tabbar]"),
        overflow: document.documentElement.scrollWidth > innerWidth,
        activity: [...document.querySelectorAll("aside,nav")].some((e) => /activity|primary/i.test(e.getAttribute("aria-label") || "") && getComputedStyle(e).display !== "none"),
        mobileTabs: document.querySelectorAll("[role=tablist]").length,
      };
    });
    const problems = [];
    if (r.jsMobile !== mobile) problems.push(`JS mobile=${r.jsMobile}`);
    if (r.overflow) problems.push("h-overflow");
    if (r.sideW !== SIDE[w]) problems.push(`--side-w=${r.sideW}`);
    if (TRACE[w] && r.traceW !== TRACE[w]) problems.push(`--trace-w=${r.traceW}`);
    // 모바일 구간에서는 Inspector/Chat 이 세그먼트 탭을 그리고, 그 위에서는 그리지 않는다 (셸의 구간 판정과 일치)
    if (route.startsWith("/inspector")) {
      const seg = await page.getByRole("tab", { name: /^(Tools|Request|Response)/ }).count();
      if (mobile && seg < 3) problems.push("inspector segments missing in mobile");
      if (!mobile && seg >= 3 && (await page.getByRole("tab", { name: "Request" }).count()) > 0) problems.push("inspector segments visible on desktop");
    }
    if (route.startsWith("/chat")) {
      const seg = await page.getByRole("tab", { name: /^(Thread|Trace)/ }).count();
      if (mobile && seg < 2) problems.push("chat segments missing in mobile");
      if (!mobile && seg > 0) problems.push("chat segments visible on desktop");
    }
    // 하단 탭바는 MobileTabBar 의 nav(grid-cols-3)이고 900px 이하에서만 보인다.
    const bar = await page.evaluate(() => { const e = document.querySelector("nav.grid-cols-3"); return e && getComputedStyle(e).display !== "none" ? 1 : 0; });
    if (mobile && bar < 1) problems.push("bottom tab bar missing");
    if (!mobile && bar > 0) problems.push("bottom tab bar visible on desktop");
    rows.push(`${problems.length ? "FAIL" : "PASS"}  ${String(w).padStart(4)}  ${route.padEnd(34)} ${problems.join(", ")}`);
    if (problems.length) fail++;
  }
  await ctx.close();
}
await browser.close();
console.log(rows.join("\n"));
console.log(`\n${rows.length - fail}/${rows.length} passed`);
process.exit(fail ? 1 : 0);
