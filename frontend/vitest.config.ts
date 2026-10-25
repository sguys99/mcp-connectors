import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // src/* alias mirroring tsconfig "paths" (needed by tests importing @/lib/...).
      "@": resolve(__dirname, "./src"),
      // server-only ships a throwing index.js by default; only `react-server`
      // condition swaps it to empty.js. vitest matches neither, so we alias
      // directly to the empty module so adapter tests can import server-only modules.
      "server-only": resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "happy-dom",
    // Playwright E2E spec (tests/e2e/**) 는 vitest 가 픽업하지 않는다.
    // 본 디렉토리는 playwright.config.ts 의 testDir 로만 수집된다.
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".next/**"],
  },
});
