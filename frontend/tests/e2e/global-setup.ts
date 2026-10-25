import { execSync, spawn } from "node:child_process";
import path from "node:path";

// mock-repo-mcp (port 8002) 를 백그라운드로 기동한다.
//   - 이미 떠 있으면 spawn 을 건너뛰고 PID 환경변수도 비워둔다 → teardown 도 no-op
//   - detached:true + process group kill 로 자식까지 정리 (`make` 가 uv 를 fork 함)
//   - MCP initialize POST 로 ready 확인 (단순 GET 은 405 라 모호함)

const MCP_PORT = 8002;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
// Phase 5 의 Inspector e2e(Resources, Prompts, 서버 정보, 콘텐츠 블록)는 starter-mcp-http (port 8001)를 쓴다.
const STARTER_PORT = 8001;
const STARTER_URL = `http://127.0.0.1:${STARTER_PORT}/mcp`;
const POLL_INTERVAL_MS = 200;
const POLL_ATTEMPTS = 50; // 최대 10초

function portInUse(port: number): boolean {
  try {
    const out = execSync(`lsof -ti:${port}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out.length > 0;
  } catch {
    // lsof exit 1 = no match — 정상 (포트 비어있음)
    return false;
  }
}

async function waitForMcpReady(url: string = MCP_URL): Promise<void> {
  // MCP `initialize` 요청 — Streamable HTTP 는 GET 시 405 라 ready 신호로 부적합.
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: "playwright-setup",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "playwright-setup", version: "0.0.1" },
    },
  });

  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          // MCP_API_KEY 를 켜고 돌리는 경우 (서버가 같은 env 를 읽음) 준비 확인에도 키를 붙인다.
          ...(process.env.MCP_API_KEY ? { "X-MCP-API-Key": process.env.MCP_API_KEY } : {}),
        },
        body: payload,
      });
      // FastMCP 는 initialize 에 200 (JSON) 또는 200 (SSE) 응답.
      if (res.ok) {
        return;
      }
    } catch {
      // 연결 실패 → 아직 listen 전. 재시도.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `MCP server did not become ready at ${url} within ${POLL_INTERVAL_MS * POLL_ATTEMPTS}ms`,
  );
}

// make 대상을 detached 프로세스 그룹으로 띄운다. 이미 포트가 열려 있으면 그대로 쓰고 PID 는 비워 둔다 (teardown no-op).
async function ensureServer(port: number, url: string, target: string, pidEnv: string): Promise<void> {
  if (portInUse(port)) {
    await waitForMcpReady(url);
    return;
  }
  const repoRoot = path.resolve(__dirname, "../../..");
  const child = spawn("make", [target], { cwd: repoRoot, detached: true, stdio: "ignore", env: process.env });
  child.unref();
  if (typeof child.pid !== "number") throw new Error(`Failed to spawn ${target} (no PID returned)`);
  process.env[pidEnv] = String(child.pid);
  process.env.E2E_MCP_OWNED = "1";
  await waitForMcpReady(url);
}

export default async function globalSetup(): Promise<void> {
  process.env.E2E_MCP_OWNED = "0";
  await ensureServer(MCP_PORT, MCP_URL, "run-mock-repo-mcp", "MOCK_REPO_MCP_PID");
  await ensureServer(STARTER_PORT, STARTER_URL, "run-starter-mcp-http", "STARTER_MCP_PID");
}
