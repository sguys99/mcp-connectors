import { defineConfig, devices } from "@playwright/test";

// Phase 6-1 — Inspector happy path 회귀 자동화.
//   - testDir: tests/e2e (vitest.config.ts 의 exclude 와 짝)
//   - webServer: `npm run dev` 를 자동 기동 (3000). 이미 떠 있으면 재사용.
//   - globalSetup: mock-repo-mcp (port 8002) 를 백그라운드 spawn 후 health-check polling
//   - globalTeardown: spawn 한 mock-repo-mcp 만 SIGTERM (외부에서 떠 있던 인스턴스는 보존)
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // mock-repo-mcp 단일 인스턴스 — race 회피
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Chat e2e 는 실제 LLM 키 없이 가짜 LLM(lib/llm/mock.ts)으로 돈다. 개발 서버를 직접 띄워 두고 재사용한다면
    // 그 서버도 CHAT_MOCK_LLM=1 로 시작해야 한다 (아니면 chat.spec.ts 가 건너뛴다). 기본 서버 설정에서는 켜지지 않는다.
    // MCP_ALLOW_RUNTIME_PROXY: 런타임 서버 프록시(/api/mcp-runtime) e2e 용. 기본값은 꺼짐이다.
    env: { CHAT_MOCK_LLM: "1", MCP_ALLOW_RUNTIME_PROXY: "true" },
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
});
