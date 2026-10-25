// MCP Streamable HTTP 프록시 (Phase 2, P2-8).
//
// 브라우저 (Dashboard, Inspector) 는 등록된 서버에 직접 붙지 않고 이 경로로 요청한다.
// 프록시는 레지스트리에서 서버를 찾아 실제 주소 (internalUrl 또는 url) 로 그대로 넘기고,
// X-MCP-API-Key 같은 인증 헤더는 서버 env 에서 붙인다. 키는 브라우저에 내려가지 않는다.
//
// * 레지스트리에 있는 streamable_http 항목만 프록시 (임의 URL 프록시 금지, SSRF 차단).
// * POST (JSON-RPC), GET (SSE 스트림), DELETE (세션 종료) 를 지원하고 응답 body 는 스트리밍 그대로 통과.
// * mcp-session-id, mcp-protocol-version, last-event-id 헤더를 양방향으로 전달.
// * 다른 origin 에서 온 요청은 403 (브라우저가 남의 사이트에서 서버 키를 빌려 쓰지 못하게).
// * 브라우저가 보낸 X-MCP-API-Key, Cookie 등 허용 목록 밖의 헤더는 버린다.
//
// Server-Timing (Inspector 의 Timing 탭이 읽는다. 같은 origin 이라 브라우저가 그대로 볼 수 있다)
//   proxy     이 핸들러가 쓴 시간 (레지스트리 조회, 요청 본문 읽기, 응답 준비). 업스트림을 기다린 시간은 뺀다.
//   upstream  업스트림을 기다린 시간. POST 의 SSE 응답이면 첫 본문 바이트까지, 그 밖에는 응답 헤더까지.
//             (FastMCP 는 도구가 끝나기 전에 헤더부터 보내서, 헤더 시점만 재면 도구 실행 시간이 빠진다.)
//   headers   업스트림 응답 헤더가 도착한 시점까지의 시간
// 첫 바이트를 기다리는 일은 POST 응답에만 한다. 한 번 읽은 청크는 그대로 앞에 다시 붙여서 본문은 바뀌지 않고,
// GET(서버 알림용 장기 스트림)은 기다리지 않고 바로 통과시킨다.
//
// 전달 로직은 lib/mcp/proxy.ts (forwardMcp) 에 있고, 런타임 서버용 /api/mcp-runtime 이 같은 코어를 쓴다.

import { findServer, resolveUpstream } from "@/lib/mcp/registry";
import { forwardMcp, isSameOrigin, jsonRpcError } from "@/lib/mcp/proxy";

interface RouteContext {
  params: Promise<{ server: string }>;
}

async function proxy(request: Request, { params }: RouteContext): Promise<Response> {
  const { server: name } = await params;

  if (!isSameOrigin(request)) {
    return jsonRpcError(403, "Cross-origin requests to the MCP proxy are not allowed");
  }

  let entry;
  try {
    entry = await findServer(name);
  } catch (err) {
    return jsonRpcError(500, (err as Error).message);
  }
  if (!entry) {
    return jsonRpcError(404, `Unknown MCP server '${name}'`);
  }
  if (entry.transport !== "streamable_http") {
    return jsonRpcError(400, `MCP server '${name}' uses stdio and cannot be proxied`);
  }

  const upstream = resolveUpstream(entry);
  return forwardMcp(request, { label: name, url: upstream.url, headers: upstream.headers });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
