// 런타임 서버 정의 -> MCPClient 가 연결할 서버 설정.
//   direct: 브라우저가 대상 URL 에 직접 연결하고 사용자 헤더를 그대로 보낸다 (대상 서버의 CORS 필요).
//   proxy : 같은 origin 의 /api/mcp-runtime 으로 보내고, 대상 URL 과 헤더는 요청 헤더로 싣는다 (서버가 MCP_ALLOW_RUNTIME_PROXY=true 일 때만 동작).
// 결과의 headers 에는 실제 값이 들어 있으므로 메모리 안에서만 쓰고 저장, 로그, 내보내기에 넘기지 않는다
// (화면에 보일 때는 runtime.headerNames 만, 값이 필요하면 redactHeaders).

import type { StreamableHttpServer } from "@/lib/mcp/types";

import {
  RUNTIME_HEADERS_HEADER,
  RUNTIME_PROXY_PATH,
  RUNTIME_TARGET_HEADER,
  encodeRuntimeHeaders,
} from "./guards";
import type { RuntimeServerDef } from "./types";

export function headersRecord(def: Pick<RuntimeServerDef, "headers">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of def.headers) if (h.name.trim()) out[h.name.trim()] = h.value;
  return out;
}

const serverCache = new WeakMap<RuntimeServerDef, StreamableHttpServer>();

// 정의 객체마다 한 번만 만든다. 다른 서버를 추가하거나 지워도 이 서버의 객체가 그대로여서 열려 있는 연결이 다시 만들어지지 않는다.
export function toRuntimeServerCached(def: RuntimeServerDef): StreamableHttpServer {
  let server = serverCache.get(def);
  if (!server) {
    server = toRuntimeServer(def);
    serverCache.set(def, server);
  }
  return server;
}

export function toRuntimeServer(def: RuntimeServerDef): StreamableHttpServer {
  const headers = headersRecord(def);
  const runtime = { mode: def.mode, target: def.url, headerNames: Object.keys(headers), rev: def.rev };
  if (def.mode === "proxy") {
    return {
      name: def.name,
      transport: "streamable_http",
      url: RUNTIME_PROXY_PATH,
      description: def.url,
      headers: {
        [RUNTIME_TARGET_HEADER]: def.url,
        ...(Object.keys(headers).length > 0 ? { [RUNTIME_HEADERS_HEADER]: encodeRuntimeHeaders(headers) } : {}),
      },
      runtime,
    };
  }
  return {
    name: def.name,
    transport: "streamable_http",
    url: def.url,
    description: def.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    runtime,
  };
}

// 화면에 보이는 주소: 쿼리 문자열은 비밀(토큰)이 실리기 쉬워 가린다.
export function displayTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return url;
  }
}
