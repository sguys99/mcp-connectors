// global-setup 이 spawn 한 MCP 서버(mock-repo-mcp, starter-mcp-http)만 정리한다.
//   - 외부에서 이미 띄워둔 인스턴스는 PID 환경변수가 비어 있어 보존
//   - detached process group 로 띄웠으므로 `-pid` 로 SIGTERM 후 정리되지 않으면 SIGKILL

async function stop(pidStr: string | undefined): Promise<void> {
  if (!pidStr) return;
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid <= 0) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // 이미 종료된 경우 — 무시
    return;
  }

  // 500ms grace, 잔존 시 SIGKILL.
  await new Promise((r) => setTimeout(r, 500));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* 이미 종료 */
  }
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_MCP_OWNED !== "1") return;
  await stop(process.env.MOCK_REPO_MCP_PID);
  await stop(process.env.STARTER_MCP_PID);
}
