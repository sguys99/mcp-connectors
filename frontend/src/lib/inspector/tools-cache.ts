// 도구 목록 캐시 (sessionStorage). 서버가 꺼져 있을 때 마지막으로 본 목록을 "HH:MM 에 저장된 목록" 으로 보여 주려고 쓴다.
// 탭을 닫으면 사라지고, 서버별로 따로 저장한다. 저장소가 막혀 있으면 조용히 건너뛴다.

import type { ToolMeta } from "@/lib/mcp/types";

export const TOOLS_CACHE_PREFIX = "mcpc-tools-cache:";

export interface ToolsCache {
  at: number;
  tools: ToolMeta[];
}

export function parseCache(raw: string | null | undefined): ToolsCache | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<ToolsCache> | null;
    if (!data || typeof data.at !== "number" || !Array.isArray(data.tools)) return null;
    const tools = data.tools.filter(
      (t): t is ToolMeta => !!t && typeof t === "object" && typeof (t as ToolMeta).name === "string",
    );
    return tools.length > 0 ? { at: data.at, tools } : null;
  } catch {
    return null;
  }
}

export function saveToolsCache(server: string, tools: ToolMeta[], at = Date.now()): void {
  try {
    window.sessionStorage.setItem(TOOLS_CACHE_PREFIX + server, JSON.stringify({ at, tools } satisfies ToolsCache));
  } catch {
    /* 무시 */
  }
}

export function loadToolsCache(server: string): ToolsCache | null {
  try {
    return parseCache(window.sessionStorage.getItem(TOOLS_CACHE_PREFIX + server));
  } catch {
    return null;
  }
}
