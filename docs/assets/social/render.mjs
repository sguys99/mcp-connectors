// Render social-preview.html to social-preview.png (1280x640) for the GitHub social preview.
//
// Usage (from the repository root, after `make frontend-install`):
//   node docs/assets/social/render.mjs            # writes docs/assets/social/social-preview.png
//   node docs/assets/social/render.mjs --scale 2 --out /tmp/check@2x.png   # 2x check render
//
// Playwright is resolved from frontend/node_modules (the e2e test dependency).
// Fonts (JetBrains Mono, IBM Plex Sans) load from Google Fonts, so the render needs network access.
// The script fails instead of writing a PNG with fallback fonts.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const require = createRequire(resolve(repoRoot, "frontend/package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const scale = Number(arg("--scale", "1"));
const out = resolve(arg("--out", resolve(here, "social-preview.png")));
const src = pathToFileURL(resolve(here, "social-preview.html")).href;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: scale,
  });
  await page.goto(src, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const missing = await page.evaluate(() =>
    ['700 62px "JetBrains Mono"', '500 15px "JetBrains Mono"', '400 26px "IBM Plex Sans"'].filter(
      (f) => !document.fonts.check(f),
    ),
  );
  if (missing.length) throw new Error(`Fonts not loaded: ${missing.join(", ")}`);

  const imgOk = await page.evaluate(() => {
    const img = document.querySelector("img.shot");
    return img.complete && img.naturalWidth > 0;
  });
  if (!imgOk) throw new Error("Screenshot image failed to load");

  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 640 } });
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`wrote ${out} (${1280 * scale}x${640 * scale}, ${kb} KB)`);
} finally {
  await browser.close();
}
