// 빌드 결과 검사: 실제 ajv(JSON Schema 검증기)가 첫 화면 JS 에 실리지 않고, 별도(lazy) 청크에만 있는지 확인한다.
// 사용: npm run build && (npm start &) && node scripts/check-initial-bundle.mjs [http://localhost:3000]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const dir = join(import.meta.dirname, "..", ".next", "static", "chunks");
const MARKER = "strictTypes"; // ajv 옵션 이름 (실제 ajv 본체에만 있다. SDK 의 얇은 어댑터에는 없다)
const routes = ["/", "/inspector?server=starter-mcp-http", "/chat", "/settings"];

let failed = false;
for (const route of routes) {
  const html = await (await fetch(base + route)).text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"]+\.js/g) ?? [])];
  const hits = chunks.filter((c) => readFileSync(join(dir, c.split("/").pop()), "utf8").includes(MARKER));
  console.log(`${hits.length === 0 ? "ok  " : "FAIL"} ${route} (${chunks.length} initial chunks)${hits.length ? " ajv in " + hits.join(", ") : ""}`);
  if (hits.length) failed = true;
}
const lazy = readdirSync(dir).filter((f) => f.endsWith(".js") && readFileSync(join(dir, f), "utf8").includes(MARKER));
console.log(`${lazy.length > 0 ? "ok  " : "FAIL"} ajv present in lazy chunk(s): ${lazy.join(", ") || "none"}`);
if (lazy.length === 0) failed = true;
process.exit(failed ? 1 : 0);
