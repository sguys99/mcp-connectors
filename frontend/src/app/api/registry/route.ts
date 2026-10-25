// 레지스트리 API (Phase 2, P2-8). configs/mcp_servers.yaml 의 streamable_http 항목만
// 브라우저 안전 형태로 돌려준다 (url = 프록시 경로, headers, internalUrl, command 제외).
// Docker healthcheck 도 이 경로를 쓴다 (레지스트리 파일을 읽을 수 있는지 함께 확인).

import { getBrowserReachableServers } from "@/lib/mcp/registry";
import { isRuntimeProxyEnabled } from "@/lib/runtime/guards";

export async function GET(): Promise<Response> {
  try {
    const servers = await getBrowserReachableServers();
    // runtimeProxy: 런타임 서버 프록시 (/api/mcp-runtime) 가 켜져 있는지. UI 가 프록시 연결 방식을 보일지 정한다.
    return Response.json({ servers, runtimeProxy: isRuntimeProxyEnabled() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
