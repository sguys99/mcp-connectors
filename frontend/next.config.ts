import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";

// 로컬 `npm run dev` / `npm run build` 에서 저장소 루트 .env 의 서버 전용 키를 보탭니다.
// MCP 서버와 CLI(scripts/mcp_cli.py)가 같은 루트 .env 를 읽으므로, 키를 켜도 프록시와 Chat 이
// 그대로 동작하게 하려는 것입니다. 이미 설정된 환경 변수 (frontend/.env.local, OS env) 가 우선이고,
// 아래 목록 밖의 값은 읽지 않습니다 (NEXT_PUBLIC_* 이 번들에 섞이지 않도록).
// standalone 런타임(Docker)에서는 이 파일이 실행되지 않으며 compose 의 environment 를 씁니다.
const ROOT_ENV_KEYS = [
  "MCP_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CHAT_ALLOW_SERVER_KEYS",
] as const;

function loadRootEnvKeys(): void {
  const file = resolve(__dirname, "..", ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (!(ROOT_ENV_KEYS as readonly string[]).includes(key!)) continue;
    if (process.env[key!] !== undefined) continue;
    let value = rawValue!;
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (value) process.env[key!] = value;
  }
}

loadRootEnvKeys();

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    // MCP SDK 의 Client 가 정적으로 끌어오는 ajv(약 90KB gzip)를 브라우저 번들에서 뺀다.
    // 브라우저에서는 lib/mcp/client.ts 가 도구 출력 검증기를 직접 넘기고, 검증은 output-validation.ts 가 늦게 한다.
    resolveAlias: {
      ajv: { browser: "./src/lib/mcp/ajv-browser-stub.ts" },
      "ajv-formats": { browser: "./src/lib/mcp/ajv-browser-stub.ts" },
    },
  },
};

export default nextConfig;
