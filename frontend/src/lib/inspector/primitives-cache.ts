// 서버 정보, 리소스, 프롬프트 캐시 (sessionStorage). 도구 목록 캐시(tools-cache.ts)와 같은 이유로 둔다.
// 서버가 꺼져 있을 때 마지막으로 본 값을 보여 준다. 탭을 닫으면 사라지고, 서버별로 따로 저장한다.

import type { PromptMeta, ResourceMeta, ResourceTemplateMeta, ServerInfo } from "@/lib/mcp/types";

export const PRIMITIVES_CACHE_PREFIX = "mcpc-primitives-cache:";

export interface PrimitivesCache {
  at: number;
  info: ServerInfo | null;
  resources: ResourceMeta[];
  templates: ResourceTemplateMeta[];
  prompts: PromptMeta[];
}

const array = <T>(value: unknown, guard: (x: unknown) => boolean): T[] =>
  Array.isArray(value) ? (value.filter(guard) as T[]) : [];

const hasString = (key: string) => (x: unknown) =>
  !!x && typeof x === "object" && typeof (x as Record<string, unknown>)[key] === "string";

export function parsePrimitivesCache(raw: string | null | undefined): PrimitivesCache | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data.at !== "number") return null;
    const info = data.info as Partial<ServerInfo> | null | undefined;
    return {
      at: data.at,
      info:
        info && typeof info === "object" && info.serverInfo && typeof info.capabilities === "object" && info.capabilities
          ? (info as ServerInfo)
          : null,
      resources: array<ResourceMeta>(data.resources, hasString("uri")),
      templates: array<ResourceTemplateMeta>(data.templates, hasString("uriTemplate")),
      prompts: array<PromptMeta>(data.prompts, hasString("name")).map((p) => ({
        ...p,
        arguments: Array.isArray(p.arguments) ? p.arguments : [],
      })),
    };
  } catch {
    return null;
  }
}

export function savePrimitivesCache(server: string, cache: Omit<PrimitivesCache, "at">, at = Date.now()): void {
  try {
    window.sessionStorage.setItem(PRIMITIVES_CACHE_PREFIX + server, JSON.stringify({ at, ...cache }));
  } catch {
    /* 무시 */
  }
}

export function loadPrimitivesCache(server: string): PrimitivesCache | null {
  try {
    return parsePrimitivesCache(window.sessionStorage.getItem(PRIMITIVES_CACHE_PREFIX + server));
  } catch {
    return null;
  }
}
