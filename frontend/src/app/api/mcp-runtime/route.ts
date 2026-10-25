// 런타임 서버 프록시 (Phase 5, P5-5). 브라우저가 직접 붙을 수 없는 외부 MCP 서버 (CORS 없음) 와 Chat 을 위한 선택 경로다.
//
// 기본은 꺼짐이다. 서버 env MCP_ALLOW_RUNTIME_PROXY=true 일 때만 동작하고, 꺼져 있으면 아무것도 가져오지 않고 403 을 돌려준다.
// 켜면 이 서버가 사용자가 입력한 http/https URL 로 요청을 대신 보내므로, 신뢰하는 환경 (로컬, 내부망) 에서만 켠다.
//
//   * 대상: x-mcp-runtime-target 헤더 (http/https 만, userinfo 거부). URL 이 아니라 헤더로 받아 접근 로그에 남지 않게 한다.
//   * 헤더: x-mcp-runtime-headers (base64url JSON). 사용자가 입력한 것만 전달하고 서버의 MCP_API_KEY 는 절대 붙이지 않는다.
//     프록시가 직접 다루는 헤더 (host, content-length, mcp-session-id 등) 는 덮어쓸 수 없다 (lib/runtime/guards.ts).
//   * 같은 origin 요청만 받는다 (등록 서버 프록시와 같은 Origin 검사).
//   * 응답 시작까지 타임아웃 (MCP_RUNTIME_PROXY_TIMEOUT_MS, 기본 60초), 응답 본문 상한 (MCP_RUNTIME_PROXY_MAX_BYTES, 기본 10MiB),
//     요청 본문 상한 2MiB. 리다이렉트는 따라가지 않는다.
//   * 링크 로컬과 클라우드 메타데이터 호스트는 거부한다 (403, lib/runtime/guards.ts 의 isBlockedRuntimeHost).
//   * 전달과 Server-Timing, 세션 헤더 처리는 등록 서버 프록시와 같은 코어 (lib/mcp/proxy.ts) 를 쓴다.

import { forwardMcp, isSameOrigin, jsonRpcError } from "@/lib/mcp/proxy";
import {
  RUNTIME_HEADERS_HEADER,
  RUNTIME_TARGET_HEADER,
  checkHttpUrl,
  checkRuntimeTargetHost,
  decodeRuntimeHeaders,
  isRuntimeProxyEnabled,
  runtimeProxyLimits,
} from "@/lib/runtime/guards";

async function proxy(request: Request): Promise<Response> {
  // 가장 먼저 확인한다: 꺼져 있으면 입력을 읽지도 않는다.
  if (!isRuntimeProxyEnabled()) {
    return jsonRpcError(403, "The runtime server proxy is disabled. Set MCP_ALLOW_RUNTIME_PROXY=true on the server to enable it.");
  }
  if (!isSameOrigin(request)) {
    return jsonRpcError(403, "Cross-origin requests to the MCP proxy are not allowed");
  }

  const target = checkHttpUrl(request.headers.get(RUNTIME_TARGET_HEADER));
  if (!target.ok) {
    return jsonRpcError(400, `Invalid runtime target URL (${target.problem}). Only http and https URLs without credentials are allowed.`);
  }
  const blocked = checkRuntimeTargetHost(target.url);
  if (blocked) {
    return jsonRpcError(403, `Runtime target not allowed: ${blocked}.`);
  }
  const headers = decodeRuntimeHeaders(request.headers.get(RUNTIME_HEADERS_HEADER));
  if (!headers.ok) {
    return jsonRpcError(400, `Invalid runtime headers: ${headers.message}`);
  }

  return forwardMcp(request, {
    label: new URL(target.url).host,
    url: target.url,
    headers: headers.headers,
    ...runtimeProxyLimits(),
  });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
