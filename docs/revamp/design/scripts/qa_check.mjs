#!/usr/bin/env node
/*
 * Phase 3 (3-5, 3-7) design QA: light/dark/system themes, 5 widths, EN/KO, 3 screens.
 *
 * Usage (from repo root):
 *   node docs/revamp/design/scripts/qa_check.mjs [designDir] --out <shotsDir> [options]
 *
 * Options:
 *   --out <dir>        where wrapped copies, screenshots and results.json go (required, keep it outside the repo)
 *   --files a,b,c,t,f  which pages to check (a=console, b=studio, c=workbench, t=tokens, f=final). default all
 *   --widths 390,1280  default 390,768,1024,1280,1440
 *   --themes light,dark,system-light,system-dark   default all four
 *   --langs en,ko      default both (tokens.html is KO only)
 *   --no-shots         skip screenshots
 *   --no-axe           skip axe-core
 *   --concurrency N    parallel pages (default 4)
 *
 * Playwright and axe-core are resolved from frontend/node_modules (no repo package.json change).
 * Exit code 1 when any state fails.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const req = createRequire(path.join(repoRoot, "frontend", "package.json"));
const { chromium } = req("playwright");
const axeSource = fs.readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const opt = { designDir: path.resolve(here, ".."), out: null, files: "a,b,c,t,f", widths: "390,768,1024,1280,1440",
  themes: "light,dark,system-light,system-dark", langs: "en,ko", shots: true, axe: true, concurrency: 4 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--files") opt.files = argv[++i];
  else if (a === "--widths") opt.widths = argv[++i];
  else if (a === "--themes") opt.themes = argv[++i];
  else if (a === "--langs") opt.langs = argv[++i];
  else if (a === "--no-shots") opt.shots = false;
  else if (a === "--no-axe") opt.axe = false;
  else if (a === "--concurrency") opt.concurrency = Number(argv[++i]) || 4;
  else if (!a.startsWith("--")) opt.designDir = path.resolve(a);
}
if (!opt.out) { console.error("--out <dir> is required (use a scratch directory)"); process.exit(2); }
const OUT = path.resolve(opt.out);
fs.mkdirSync(path.join(OUT, "wrapped"), { recursive: true });

const PAGES = {
  a: { file: "concept-a-console.html", screens: ["dashboard", "inspector", "chat"], langKey: "mcpc-lang", themeKey: "mcpc-theme", systemValue: "system" },
  b: { file: "concept-b-studio.html", screens: ["dashboard", "inspector", "chat"], langKey: "mcpc-lang", themeKey: "mcpc-theme", systemValue: null },
  c: { file: "concept-c-workbench.html", screens: ["dashboard", "inspector", "chat"], langKey: "mcpc-c-lang", themeKey: "mcpc-theme", systemValue: null },
  t: { file: "tokens.html", screens: ["console", "studio", "workbench"], langKey: null, themeKey: "mcpc-tokens-theme", systemValue: null, koOnly: true },
  /* 3-7 final design: system theme = no saved value (the page follows the OS by default) */
  f: { file: "final.html", screens: ["dashboard", "inspector", "chat"], langKey: "mcpc-lang", themeKey: "mcpc-theme", systemValue: null },
};
const SKELETON = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">\n';

/* ---------- in-page audit (runs inside the browser) ---------- */
function audit({ width, checkTargets }) {
  const out = { overflow: null, clipped: [], truncated: [], ellipsized: 0, contrast: [], overlaps: [], smallTargets: [], unnamed: [], noId: [] };
  const de = document.documentElement;
  out.overflow = { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, bodyScroll: document.body.scrollWidth };
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRGBA = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, base) => { const a = top[3]; return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1]; };
  const sel = (el) => { if (!el || el.nodeType !== 1) return ""; if (el.id) return "#" + el.id; let s = el.tagName.toLowerCase(); if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join("."); const p = el.parentElement; return (p && p !== document.body ? sel(p) + " > " : "") + s; };
  const shortText = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const isHidden = (el) => {
    if (el.closest("[hidden],[inert],[aria-hidden='true']")) return true;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return true;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return true;
    let p = el; while (p && p !== de) { const s = getComputedStyle(p); if (s.opacity === "0" || s.display === "none" || s.visibility === "hidden") return true; p = p.parentElement; }
    return false;
  };
  const all = [...document.body.querySelectorAll("*")].filter((el) => !(el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") && !["SCRIPT", "STYLE", "TEMPLATE", "BR", "OPTION"].includes(el.tagName));
  const visible = all.filter((el) => !isHidden(el));
  const isSrOnly = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return (r.width <= 1 || r.height <= 1) || (cs.clip && cs.clip !== "auto") || (cs.clipPath && cs.clipPath !== "none" && /inset\(50%|inset\(100%/.test(cs.clipPath)); };
  const fixedAnc = (el) => { for (let p = el; p && p !== de; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === "fixed" || ps === "sticky") return true; } return false; };
  const visRect = (el) => {
    const r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX !== "visible" || ps.overflowY !== "visible") { const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
      if (ps.position === "fixed") break;
    }
    return { left: L, top: T, right: R, bottom: B };
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  /* clipping against viewport and clipping ancestors */
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" && (r.left >= window.innerWidth || r.right <= 0)) continue; // parked off-canvas sheet
    let clipAnc = null, p = el.parentElement;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.overflowX !== "visible") { clipAnc = p; break; }
      if (ps.position === "fixed") break;
      p = p.parentElement;
    }
    if (isSrOnly(el)) continue;
    const meaningful = hasOwnText(el) || el.matches("button,a[href],input,select,textarea,[role=tab],[role=button],img,svg");
    if (!meaningful) continue;
    if (!clipAnc) {
      if (r.right > window.innerWidth + 1 || r.left < -1) out.clipped.push({ kind: "viewport", sel: sel(el), text: shortText(el), left: Math.round(r.left), right: Math.round(r.right) });
    } else {
      const ar = clipAnc.getBoundingClientRect();
      const as = getComputedStyle(clipAnc);
      const scroller = as.overflowX === "auto" || as.overflowX === "scroll";
      const beyond = r.right > ar.right + 1 || r.left < ar.left - 1;
      const ellipsisAnc = as.textOverflow === "ellipsis"; /* inline child cut by an ellipsis line is intended */
      if (beyond && !scroller && !ellipsisAnc && r.right > ar.left && r.left < ar.right) out.clipped.push({ kind: "ancestor-hidden", sel: sel(el), text: shortText(el), anc: sel(clipAnc), over: Math.round(Math.max(r.right - ar.right, ar.left - r.left)) });
      if (!scroller && (ar.right > window.innerWidth + 1) && r.right > window.innerWidth + 1) out.clipped.push({ kind: "viewport", sel: sel(el), text: shortText(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  /* content spilling out of a flex row that does not clip (tabs or toolbars painting over the next pane) */
  for (const el of visible) {
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display) || cs.flexWrap !== "nowrap" || cs.overflowX !== "visible") continue;
    if (el.clientWidth < 2 || el.scrollWidth <= el.clientWidth + 2) continue;
    const er = el.getBoundingClientRect();
    const kids = [...el.children].filter((k) => { const ks = getComputedStyle(k); return ks.position !== "absolute" && ks.position !== "fixed" && ks.display !== "none"; });
    const maxR = Math.max(...kids.map((k) => k.getBoundingClientRect().right), er.right);
    if (maxR <= er.right + 2) continue; /* only absolutely positioned tooltips stick out */
    if (!el.querySelector("button,a[href],[role=tab]") && !hasOwnText(el)) continue;
    if (isSrOnly(el)) continue;
    const r = el.getBoundingClientRect();
    out.clipped.push({ kind: "spill", sel: sel(el), text: shortText(el), over: el.scrollWidth - el.clientWidth, left: Math.round(r.left), right: Math.round(r.right) });
  }
  /* text truncation without ellipsis */
  for (const el of visible) {
    if (!hasOwnText(el)) continue;
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth <= 1 || isSrOnly(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "visible") continue;
    if (cs.textOverflow === "ellipsis") { out.ellipsized++; continue; }
    out.truncated.push({ sel: sel(el), text: shortText(el), sw: el.scrollWidth, cw: el.clientWidth });
  }
  /* contrast sampling */
  const seen = new Set();
  for (const el of visible) {
    if (!hasOwnText(el)) continue;
    if (el.closest("[disabled],[aria-disabled='true']") || isSrOnly(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    let fg = toRGBA(cs.color);
    let op = 1, q = el; while (q && q !== de) { op *= parseFloat(getComputedStyle(q).opacity) || 1; q = q.parentElement; }
    fg[3] *= op;
    /* background: walk ancestors, composite, give up on images/gradients */
    const layers = []; let unknown = false; q = el;
    while (q) {
      const s = getComputedStyle(q);
      if (s.backgroundImage && s.backgroundImage !== "none") { unknown = true; break; }
      const c = toRGBA(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
      q = q.parentElement;
    }
    if (unknown) continue;
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fgc = over(fg, bg);
    const rt = ratio(fgc, bg);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (rt + 0.005 < need) {
      const key = sel(el) + "|" + rt.toFixed(2);
      if (seen.has(key)) continue; seen.add(key);
      out.contrast.push({ sel: sel(el), text: shortText(el), ratio: Math.round(rt * 100) / 100, need, color: cs.color, size });
    }
  }
  /* overlapping interactive controls */
  const ctrls = visible.filter((el) => el.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=tab],[role=button]"))
    .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.opacity !== "0" && s.pointerEvents !== "none"; });
  for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
    const A = ctrls[i], B = ctrls[j];
    if (A.contains(B) || B.contains(A)) continue;
    if (fixedAnc(A) !== fixedAnc(B)) continue; /* content scrolling under a fixed or sticky bar */
    const a = visRect(A), b = visRect(B);
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 2 && h > 2) {
      /* only count when both are actually painted at the overlap point */
      const x = Math.max(a.left, b.left) + w / 2, y = Math.max(a.top, b.top) + h / 2;
      if (y < 0 || y > window.innerHeight) continue;
      out.overlaps.push({ a: sel(A), b: sel(B), ta: shortText(A), tb: shortText(B), w: Math.round(w), h: Math.round(h) });
    }
  }
  /* touch targets (WCAG 2.5.8 minimum 24px), inline text links exempt */
  if (checkTargets) for (const el of ctrls) {
    if (el.matches("a") && el.closest("p,li") && getComputedStyle(el).display === "inline") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) out.smallTargets.push({ sel: sel(el), text: shortText(el) || el.getAttribute("aria-label") || "", w: Math.round(r.width), h: Math.round(r.height) });
  }
  /* icon-only buttons without a name, form controls without id */
  for (const el of visible.filter((e) => e.matches("button,[role=button],a[href]"))) {
    const txt = (el.innerText || "").trim();
    if (!txt && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title")) out.unnamed.push({ sel: sel(el) });
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]),select,textarea")) if (!el.id) out.noId.push({ sel: sel(el), type: el.type });
  return out;
}

/* ---------- runner ---------- */
const widths = opt.widths.split(",").map(Number);
const themes = opt.themes.split(",");
const langs = opt.langs.split(",");
const keys = opt.files.split(",");
const results = [];
const failures = [];

function wrap(key) {
  const src = path.join(opt.designDir, PAGES[key].file);
  const dst = path.join(OUT, "wrapped", PAGES[key].file);
  fs.writeFileSync(dst, SKELETON + fs.readFileSync(src, "utf8"));
  return pathToFileURL(dst).href;
}

async function runCombo(browser, key, url, width, theme, lang) {
  const P = PAGES[key];
  const scheme = theme === "system-dark" || theme === "dark" ? "dark" : "light";
  const ctx = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : width <= 768 ? 1024 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, hasTouch: width <= 390 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message || e).slice(0, 200)));
  await page.addInitScript(({ P, theme, lang }) => {
    try {
      if (!sessionStorage.getItem("qa-init")) {
        localStorage.clear();
        if (theme === "light" || theme === "dark") localStorage.setItem(P.themeKey, theme);
        else if (P.systemValue) localStorage.setItem(P.themeKey, P.systemValue);
        if (P.langKey) localStorage.setItem(P.langKey, lang);
        sessionStorage.setItem("qa-init", "1");
      }
    } catch (e) { /* ignore */ }
  }, { P, theme, lang });
  await page.goto(url + "#" + P.screens[0], { waitUntil: "load" });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const attr = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme || null, lang: document.documentElement.lang }));
  const expectTheme = theme === "light" || theme === "dark" ? theme : null;
  const stateErrs = [];
  if (attr.theme !== expectTheme) stateErrs.push(`data-theme=${attr.theme} expected ${expectTheme}`);
  if (!P.koOnly && attr.lang !== lang) stateErrs.push(`lang=${attr.lang} expected ${lang}`);
  if (opt.axe) await page.addScriptTag({ content: axeSource });
  for (const screen of P.screens) {
    await page.evaluate((s) => { if (location.hash !== "#" + s) location.hash = s; }, screen);
    await page.waitForTimeout(350);
    const a = await page.evaluate(audit, { width, checkTargets: width <= 390 });
    let axe = [];
    if (opt.axe) {
      axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
          nodes: v.nodes.slice(0, 4).map((n) => ({ t: n.target.join(" "), d: (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio) ? `${n.any[0].data.contrastRatio} fg ${n.any[0].data.fgColor} bg ${n.any[0].data.bgColor}` : (n.failureSummary || "").slice(0, 120) })) }));
      });
    }
    const name = `${key}-${screen}-${width}-${theme}-${lang}`;
    if (opt.shots) await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
    const overflow = a.overflow.scrollWidth > a.overflow.innerWidth;
    const problems = [];
    if (overflow) problems.push(`h-overflow ${a.overflow.scrollWidth}>${a.overflow.innerWidth}`);
    if (errors.length) problems.push(...errors);
    problems.push(...stateErrs);
    if (a.clipped.length) problems.push(`clipped ${a.clipped.length}`);
    if (a.truncated.length) problems.push(`truncated ${a.truncated.length}`);
    if (a.contrast.length) problems.push(`contrast ${a.contrast.length}`);
    if (a.overlaps.length) problems.push(`overlap ${a.overlaps.length}`);
    if (a.smallTargets.length) problems.push(`small-target ${a.smallTargets.length}`);
    if (a.unnamed.length) problems.push(`unnamed ${a.unnamed.length}`);
    if (a.noId.length) problems.push(`no-id ${a.noId.length}`);
    for (const v of axe) problems.push(`axe:${v.id}(${v.impact}) x${v.n}`);
    const rec = { key, file: P.file, screen, width, theme, lang, pass: problems.length === 0, problems, detail: { ...a, axe, errors: [...errors] } };
    results.push(rec);
    if (!rec.pass) failures.push(rec);
    errors.length = 0;
  }
  await ctx.close();
}

async function focusCheck(browser, key, url, width, theme) {
  const P = PAGES[key];
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript(({ P, theme }) => { try { if (!sessionStorage.getItem("qa-init")) { localStorage.clear(); localStorage.setItem(P.themeKey, theme); sessionStorage.setItem("qa-init", "1"); } } catch (e) {} }, { P, theme });
  const found = [];
  for (const screen of P.screens) {
    await page.goto(url + "#" + screen, { waitUntil: "load" });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.focus(); });
    const seenEls = new Set();
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const has = (s) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
        let ring = has(cs), via = "";
        if (!ring) { let p = el.parentElement; for (let i = 0; i < 3 && p; i++, p = p.parentElement) { if (p.matches(":focus-within") && has(getComputedStyle(p))) { ring = true; via = "focus-within"; break; } } }
        /* vertical off-screen is ignored (smooth scroll into view); horizontal off-screen means a parked drawer */
        const hidden = r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= innerWidth || cs.visibility === "hidden" || !!el.closest("[aria-hidden='true'],[inert]");
        const id = el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : "");
        return { id, text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30), ring, via, hidden, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      });
      if (!info) continue;
      const k = info.id + info.text;
      if (seenEls.has(k)) break; seenEls.add(k);
      if (!info.ring || info.hidden) found.push({ screen, ...info });
    }
  }
  await ctx.close();
  return { key, width, theme, issues: found };
}

async function pool(tasks, n) {
  const q = tasks.slice(); const workers = [];
  for (let i = 0; i < n; i++) workers.push((async () => { while (q.length) { const t = q.shift(); try { await t(); } catch (e) { console.error("task failed:", e.message); failures.push({ crash: e.message }); } } })());
  await Promise.all(workers);
}

const browser = await chromium.launch();
const urls = Object.fromEntries(keys.map((k) => [k, wrap(k)]));
const tasks = [];
for (const k of keys) for (const w of widths) for (const th of themes) for (const lg of (PAGES[k].koOnly ? ["ko"] : langs)) tasks.push(() => runCombo(browser, k, urls[k], w, th, lg));
const t0 = Date.now();
await pool(tasks, opt.concurrency);
const focus = [];
const ftasks = [];
for (const k of keys) for (const w of [390, 1280].filter((x) => widths.includes(x) || widths.length === 1)) for (const th of ["light", "dark"]) ftasks.push(async () => focus.push(await focusCheck(browser, k, urls[k], w, th)));
await pool(ftasks, opt.concurrency);
await browser.close();

/* ---------- report ---------- */
results.sort((x, y) => (x.key + x.width + x.theme + x.lang + x.screen).localeCompare(y.key + y.width + y.theme + y.lang + y.screen));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ results, focus }, null, 1));
const table = {};
for (const r of results) { const k = `${r.key} ${String(r.width).padStart(4)} ${r.theme.padEnd(12)}`; (table[k] ||= { pass: 0, total: 0 }); table[k].total++; if (r.pass) table[k].pass++; }
console.log("page width theme         pass/total (screens x langs)");
for (const [k, v] of Object.entries(table)) console.log(`${k} ${v.pass}/${v.total}${v.pass === v.total ? "" : "  FAIL"}`);
const agg = {};
for (const r of failures) for (const p of r.problems || []) { const id = r.key + " " + p.replace(/ x?\d+$/, "").replace(/\d+>\d+/, ""); agg[id] = (agg[id] || 0) + 1; }
console.log("\nproblem counts (by page):");
for (const [k, v] of Object.entries(agg).sort()) console.log(`  ${k}: ${v} states`);
const fIssues = focus.filter((f) => f.issues.length);
console.log(`\nfocus walk: ${focus.length} runs, ${fIssues.length} with issues`);
for (const f of fIssues) console.log(`  ${f.key} ${f.width} ${f.theme}: ` + f.issues.slice(0, 6).map((i) => `${i.screen}:${i.id}${i.hidden ? "(hidden)" : ""}${i.ring ? "" : "(no ring)"}`).join(", "));
console.log(`\n${results.length} states, ${failures.length} failing, ${((Date.now() - t0) / 1000).toFixed(0)}s. results: ${path.join(OUT, "results.json")}`);
process.exit(failures.length || fIssues.length ? 1 : 0);
