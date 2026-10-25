// Chat 요청에 실린 런타임 서버(프록시 방식으로 추가한 것)를 검사한다. /api/chat 은 MCP 를 서버 쪽에서 호출하므로
// 브라우저 직결 서버는 쓸 수 없고, 서버 env MCP_ALLOW_RUNTIME_PROXY=true 일 때만 받는다 (/api/mcp-runtime 과 같은 문과 같은 검사).
//   * 꺼져 있으면 403 이고 아무것도 호출하지 않는다.
//   * URL 은 http/https 만, 헤더는 lib/runtime/guards.ts 의 규칙. 서버의 MCP_API_KEY 는 붙이지 않는다 (호출하는 쪽이 이 결과의 헤더만 쓴다).
//   * 링크 로컬과 클라우드 메타데이터 호스트는 403 (guards.ts 의 isBlockedRuntimeHost). Chat 의 MCP 클라이언트는 리다이렉트도 따라가지 않는다.
//   * 이름은 레지스트리와 겹치면 안 된다 (겹치면 등록 서버의 키가 엉뚱한 곳으로 갈 수 있다).

import { checkHttpUrl, checkRuntimeTargetHost, isRuntimeProxyEnabled, sanitizeRuntimeHeaders } from "./guards";
import { validateName } from "./validate";

export interface ChatRuntimeServer {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export type ChatRuntimeResult =
  | { ok: true; servers: Map<string, ChatRuntimeServer> }
  | { ok: false; status: 400 | 403; error: string };

// 런타임 서버의 도구 결과가 모델 컨텍스트를 채우지 못하게 하는 상한 (문자 수)
export const RUNTIME_TOOL_RESULT_MAX_CHARS = 256 * 1024;

export function parseChatRuntimeServers(
  input: ReadonlyArray<{ name: string; url: string; headers?: Record<string, string> }> | undefined,
  options: { registryNames: readonly string[]; env?: Record<string, string | undefined> },
): ChatRuntimeResult {
  const servers = new Map<string, ChatRuntimeServer>();
  if (!input || input.length === 0) return { ok: true, servers };
  if (!isRuntimeProxyEnabled(options.env)) {
    return {
      ok: false,
      status: 403,
      error: "Runtime servers in Chat require the server proxy. Set MCP_ALLOW_RUNTIME_PROXY=true on the server to enable it.",
    };
  }
  for (const item of input) {
    const problem = validateName(item.name, { registryNames: options.registryNames, runtimeNames: [...servers.keys()] });
    if (problem) return { ok: false, status: 400, error: `Invalid runtime server name '${item.name}' (${problem})` };
    const url = checkHttpUrl(item.url);
    if (!url.ok) return { ok: false, status: 400, error: `Invalid runtime server URL for '${item.name}' (${url.problem})` };
    const blocked = checkRuntimeTargetHost(url.url);
    if (blocked) return { ok: false, status: 403, error: `Runtime server '${item.name}' is not allowed: ${blocked}` };
    const headers = sanitizeRuntimeHeaders(item.headers);
    if (!headers.ok) return { ok: false, status: 400, error: `Invalid headers for '${item.name}': ${headers.message}` };
    servers.set(item.name, { name: item.name, url: url.url, headers: headers.headers });
  }
  return { ok: true, servers };
}
