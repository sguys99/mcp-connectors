import { expect, test } from "@playwright/test";

// MCP 프록시 (/api/mcp/<name>) 와 레지스트리 API (/api/registry) 회귀.
//   * 레지스트리에 없는 서버, stdio 서버는 프록시하지 않는다.
//   * 브라우저용 레지스트리에는 internalUrl, headers, 컨테이너 주소가 없다 (설정 복사용 externalUrl 만 있다).
//   * MCP_API_KEY 를 켜고 돌리면 (예: MCP_API_KEY=k make test-e2e) upstream 직접 호출은 401,
//     프록시는 서버 측에서 키를 붙여 200 인지 확인한다.

const INITIALIZE = {
  jsonrpc: "2.0",
  id: "e2e-proxy",
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-proxy", version: "0.0.1" },
  },
};
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

test("registry API serves browser-safe HTTP entries only", async ({ request }) => {
  const res = await request.get("/api/registry");
  expect(res.ok()).toBe(true);
  const text = await res.text();
  const { servers } = JSON.parse(text) as { servers: { name: string; transport: string; url: string }[] };
  expect(servers.map((s) => s.name)).toContain("mock-repo-mcp");
  for (const s of servers) {
    expect(s.transport).toBe("streamable_http");
    expect(s.url).toBe(`/api/mcp/${s.name}`);
  }
  expect(text).not.toContain("internalUrl");
  // externalUrl(yaml 의 url)은 클라이언트 설정 복사용으로 내려가지만, 컨테이너 주소와 헤더는 내려가지 않는다.
  expect(text).not.toContain("mock-repo-mcp:8002");
  expect(text).not.toContain("headers");
});

test("proxy rejects servers outside the registry and stdio servers", async ({ request }) => {
  const unknown = await request.post("/api/mcp/not-registered", { data: INITIALIZE, headers: MCP_HEADERS });
  expect(unknown.status()).toBe(404);
  const stdio = await request.post("/api/mcp/starter-mcp", { data: INITIALIZE, headers: MCP_HEADERS });
  expect(stdio.status()).toBe(400);
});

test("proxy forwards initialize and returns a session id", async ({ request }) => {
  const res = await request.post("/api/mcp/mock-repo-mcp", { data: INITIALIZE, headers: MCP_HEADERS });
  expect(res.status()).toBe(200);
  expect(res.headers()["mcp-session-id"]).toBeTruthy();
  expect(await res.text()).toContain("serverInfo");
});

test("proxy attaches the API key server-side when MCP_API_KEY is set", async ({ request }) => {
  test.skip(!process.env.MCP_API_KEY, "MCP_API_KEY not set for this run");
  const direct = await request.post("http://127.0.0.1:8002/mcp", { data: INITIALIZE, headers: MCP_HEADERS });
  expect(direct.status()).toBe(401);
  const proxied = await request.post("/api/mcp/mock-repo-mcp", { data: INITIALIZE, headers: MCP_HEADERS });
  expect(proxied.status()).toBe(200);
});
