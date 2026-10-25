// configs/mcp_servers.yaml 로더 (서버 전용, 레지스트리 단일 사실 출처).
//
// * 파일 경로: MCP_REGISTRY_PATH (없으면 configs/mcp_servers.yaml 을 자동 탐색, lib/config/paths.ts)
// * 요청마다 파일을 다시 읽어 yaml 수정이 재빌드 없이 반영된다 (파일이 작아 비용 무시 가능).
// * 브라우저에는 toPublicServer() 결과만 내보낸다. url 은 프론트엔드 프록시 경로
//   (/api/mcp/<name>) 로 바뀌고, internalUrl 과 headers 는 빠진다. 설정 복사용으로 yaml 의 url (externalUrl) 과 stdio command 는 남긴다.
// * 서버 측 MCP 호출 (프록시, Chat) 은 resolveUpstream() 으로 실제 URL 과 헤더를 얻는다.
//   헤더 규칙은 scripts/mcp_cli.py::_resolve_headers 와 같다.

import "server-only";

// process.env 와 같은 모양. 테스트에서 일부 키만 넘길 수 있게 NodeJS.ProcessEnv 대신 사용.
type Env = Record<string, string | undefined>;

import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

import { resolveConfigFile } from "@/lib/config/paths";

import type { PublicServer, StreamableHttpServer } from "./types";

export const API_KEY_HEADER = "X-MCP-API-Key";
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const httpEntrySchema = z.object({
  name: z.string().min(1),
  transport: z.literal("streamable_http"),
  url: z.url(),
  internalUrl: z.url().optional(),
  description: z.string().optional(),
  description_ko: z.string().optional(),
  headers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const stdioEntrySchema = z.object({
  name: z.string().min(1),
  transport: z.literal("stdio"),
  command: z.array(z.string()).min(1),
  description: z.string().optional(),
  description_ko: z.string().optional(),
});

const registrySchema = z.object({
  servers: z.array(z.discriminatedUnion("transport", [httpEntrySchema, stdioEntrySchema])).min(1),
});

export type RegistryHttpEntry = z.infer<typeof httpEntrySchema>;
export type RegistryStdioEntry = z.infer<typeof stdioEntrySchema>;
export type RegistryEntry = RegistryHttpEntry | RegistryStdioEntry;

export function registryPath(env: Env = process.env): string {
  return resolveConfigFile(env.MCP_REGISTRY_PATH, "mcp_servers.yaml");
}

// YAML 텍스트 → 검증된 항목 배열. 스키마에 없는 키는 버린다.
export function parseRegistry(text: string, source = "mcp_servers.yaml"): RegistryEntry[] {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new Error(`[registry] Invalid YAML in ${source}: ${(err as Error).message}`);
  }
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`[registry] Malformed ${source}: ${issues}`);
  }
  const seen = new Set<string>();
  for (const entry of parsed.data.servers) {
    if (seen.has(entry.name)) {
      throw new Error(`[registry] Duplicate server name '${entry.name}' in ${source}`);
    }
    seen.add(entry.name);
  }
  return parsed.data.servers;
}

export async function loadRegistry(env: Env = process.env): Promise<RegistryEntry[]> {
  const path = registryPath(env);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `[registry] Cannot read ${path} (set MCP_REGISTRY_PATH to override): ${(err as Error).message}`,
    );
  }
  return parseRegistry(text, path);
}

export async function findServer(
  name: string,
  env: Env = process.env,
): Promise<RegistryEntry | undefined> {
  return (await loadRegistry(env)).find((s) => s.name === name);
}

// ---------- 브라우저 노출용 ---------- //

export function proxyPath(name: string): string {
  return `/api/mcp/${encodeURIComponent(name)}`;
}

// description 은 영어 기본, description_ko 는 선택 한국어 문구 (yaml 키 → 브라우저용 descriptionKo).
// UI 는 locale 이 ko 이고 descriptionKo 가 있으면 그것을, 아니면 description 을 보여준다.
function publicTexts(entry: RegistryEntry): { description?: string; descriptionKo?: string } {
  return {
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.description_ko ? { descriptionKo: entry.description_ko } : {}),
  };
}

export function toPublicServer(entry: RegistryEntry): PublicServer {
  if (entry.transport === "streamable_http") {
    return {
      name: entry.name,
      transport: "streamable_http",
      url: proxyPath(entry.name),
      externalUrl: entry.url,
      ...publicTexts(entry),
    };
  }
  return {
    name: entry.name,
    transport: "stdio",
    command: entry.command,
    ...publicTexts(entry),
  };
}

// Dashboard 용: 모든 항목 (stdio 는 이름, 설명만).
export async function getPublicServers(env: Env = process.env): Promise<PublicServer[]> {
  return (await loadRegistry(env)).map(toPublicServer);
}

// Inspector, Chat, /api/registry 용: 브라우저가 프록시로 닿을 수 있는 HTTP 항목만.
export async function getBrowserReachableServers(
  env: Env = process.env,
): Promise<StreamableHttpServer[]> {
  return (await loadRegistry(env))
    .filter((s): s is RegistryHttpEntry => s.transport === "streamable_http")
    .map((s) => toPublicServer(s) as StreamableHttpServer);
}

// ---------- 서버 측 MCP 호출용 ---------- //

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export interface Upstream {
  url: string;
  headers: Record<string, string>;
}

// 실제 MCP 서버 주소와 헤더.
//   * URL: MCP_USE_INTERNAL_URL 이 참이고 internalUrl 이 있으면 internalUrl (Docker 네트워크),
//     아니면 url (호스트에서 `npm run dev`).
//   * 헤더: 레지스트리 headers 의 ${VAR} 를 env 로 치환하고 빈 값은 버린다.
//     X-MCP-API-Key 가 headers 에 없으면 MCP_API_KEY 를 붙인다 (mcp_cli.py 와 같은 규칙).
export function resolveUpstream(
  entry: RegistryHttpEntry,
  env: Env = process.env,
): Upstream {
  const url =
    isTruthy(env.MCP_USE_INTERNAL_URL) && entry.internalUrl ? entry.internalUrl : entry.url;

  const raw = entry.headers ?? {};
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const resolved = String(value).replace(ENV_REF, (_, v: string) => env[v] ?? "");
    if (resolved) headers[name] = resolved;
  }

  const hasKeyHeader = Object.keys(raw).some(
    (n) => n.toLowerCase() === API_KEY_HEADER.toLowerCase(),
  );
  const apiKey = env.MCP_API_KEY?.trim();
  if (!hasKeyHeader && apiKey) headers[API_KEY_HEADER] = apiKey;

  return { url, headers };
}
