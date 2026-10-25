// 시스템 프롬프트 렌더러 (Phase 5-3-2-2).
// override 가 있으면 그 텍스트가 곧 system prompt (placeholder 치환 안 함).
// 없으면 configs/prompts/chat_system.md 를 읽어 placeholder 3 종을 치환.
//
// PRD §7.1 (골격) · §7.2 (동적 컨텍스트 주입) · §7.4 (override 우선).

import "server-only";

import { readFile } from "node:fs/promises";

import { resolveConfigFile } from "@/lib/config/paths";
import type { ToolMeta } from "@/lib/mcp/types";

// 템플릿 경로: CHAT_SYSTEM_PROMPT_PATH, 없으면 configs/prompts/chat_system.md 자동 탐색
// (로컬 dev 는 ../configs, Docker standalone 은 /app/configs. lib/config/paths.ts 참고).
export function systemPromptPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveConfigFile(env.CHAT_SYSTEM_PROMPT_PATH, "prompts/chat_system.md");
}

export interface RenderSystemPromptInput {
  override: string | null | undefined;
  serverName: string;
  tools: ToolMeta[];
}

export async function renderSystemPrompt(input: RenderSystemPromptInput): Promise<string> {
  const override = input.override?.trim();
  if (override && override.length > 0) {
    // override 는 통째 교체. placeholder 치환 안 함 (사용자 의도 100% 보존).
    return override;
  }

  const template = await readFile(systemPromptPath(), "utf8");
  return renderTemplate(template, {
    server_name: input.serverName,
    tool_count: String(input.tools.length),
    tool_definitions_block: toolDefinitionsBlock(input.tools),
  });
}

// 단순 string replace — `{{key}}` 토큰을 values[key] 로 치환. 미존재 토큰은 그대로 유지.
export function renderTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

// PRD §7.2: list_tools 결과를 사람이 읽을 수 있는 markdown 으로 직렬화.
// LLM 의 tools 파라미터가 이미 도구 정의를 전달하므로 본 블록은 보조 컨텍스트.
// 형식: 각 tool 마다 `### name` 헤더 + description + JSON Schema 코드블록.
export function toolDefinitionsBlock(tools: ToolMeta[]): string {
  if (tools.length === 0) return "_(no tools available)_";
  return tools
    .map((t) => {
      const desc = t.description.trim().length > 0 ? t.description : "(no description)";
      const schema = JSON.stringify(t.inputSchema, null, 2);
      return `### ${t.name}\n${desc}\n\n\`\`\`json\n${schema}\n\`\`\``;
    })
    .join("\n\n");
}
