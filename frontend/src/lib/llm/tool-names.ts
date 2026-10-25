// 여러 MCP 서버의 도구를 한 번에 모델에 노출할 때 쓰는 이름 규칙 (순수 함수).
//
// * 서버가 하나면 도구 이름을 그대로 둔다 (예전 동작과 같고 모델이 보는 이름이 가장 단순하다).
// * 서버가 둘 이상이면 `<server>__<tool>` 로 접두를 붙여 이름 충돌을 피한다.
//   Anthropic 과 OpenAI 모두 도구 이름은 [a-zA-Z0-9_-]{1,64} 라서 서버 이름(하이픈 포함)을 그대로 쓸 수 있다.
// * 실행할 때는 이 인덱스로 (서버, 원래 도구 이름) 을 찾는다. 문자열을 쪼개지 않아 도구 이름에 `__` 가 있어도 안전하다.

import type { ToolMeta } from "@/lib/mcp/types";

export const TOOL_NAME_SEPARATOR = "__";
export const TOOL_NAME_MAX_LENGTH = 64;
const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export interface ServerTools {
  server: string;
  tools: readonly ToolMeta[];
}

export interface ToolTarget {
  server: string;
  tool: string;
}

export interface ExposedTools {
  // 모델에 보이는 이름으로 바꾼 도구 목록
  tools: ToolMeta[];
  // 모델이 부른 이름 -> 실제 서버와 도구
  index: Map<string, ToolTarget>;
}

export class ToolNameError extends Error {}

export function exposeTools(servers: readonly ServerTools[]): ExposedTools {
  const prefixed = servers.length > 1;
  const tools: ToolMeta[] = [];
  const index = new Map<string, ToolTarget>();

  for (const { server, tools: list } of servers) {
    for (const tool of list) {
      const name = prefixed ? `${server}${TOOL_NAME_SEPARATOR}${tool.name}` : tool.name;
      if (name.length > TOOL_NAME_MAX_LENGTH || !VALID_NAME.test(name)) {
        throw new ToolNameError(
          `Tool '${tool.name}' from '${server}' cannot be exposed to the model as '${name}' ` +
            `(names must match [a-zA-Z0-9_-] and be at most ${TOOL_NAME_MAX_LENGTH} characters).`,
        );
      }
      if (index.has(name)) {
        throw new ToolNameError(`Duplicate tool name '${name}' while exposing '${server}'.`);
      }
      index.set(name, { server, tool: tool.name });
      tools.push(prefixed ? { ...tool, name } : tool);
    }
  }
  return { tools, index };
}
