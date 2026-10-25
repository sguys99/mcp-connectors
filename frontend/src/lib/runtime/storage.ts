// 런타임 서버 저장 (순수 로직). sessionStorage 에만 두고, localStorage, 로그, 내보내기에는 절대 쓰지 않는다.
// 탭을 닫으면 URL 과 헤더가 함께 사라진다 (design-decision: 세션 한정). 새로고침은 견딘다.

import { checkHeaderName, checkHeaderValue, checkHttpUrl } from "./guards";
import type { RuntimeHeader, RuntimeMode, RuntimeServerDef } from "./types";
import { validateName } from "./validate";

export const RUNTIME_STORAGE_KEY = "mcpc-runtime-servers";
export const MAX_RUNTIME_SERVERS = 20;

export function serializeRuntime(defs: readonly RuntimeServerDef[]): string {
  return JSON.stringify({ v: 1, servers: defs });
}

// 저장값을 읽는다. 깨진 항목은 버리고 이름이 겹치면 앞의 것만 남긴다.
export function parseRuntime(raw: string | null | undefined): RuntimeServerDef[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (data as { servers?: unknown } | null)?.servers;
  if (!Array.isArray(list)) return [];
  const out: RuntimeServerDef[] = [];
  const names: string[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { name, url, headers, mode, rev } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof url !== "string") continue;
    if (validateName(name, { registryNames: [], runtimeNames: names }) !== null) continue;
    const checked = checkHttpUrl(url);
    if (!checked.ok) continue;
    const rows: RuntimeHeader[] = [];
    if (Array.isArray(headers)) {
      for (const h of headers) {
        const r = h as { name?: unknown; value?: unknown };
        if (typeof r?.name === "string" && typeof r?.value === "string" && !checkHeaderName(r.name) && !checkHeaderValue(r.value)) {
          rows.push({ name: r.name, value: r.value });
        }
      }
    }
    names.push(name);
    out.push({
      name,
      url: checked.url,
      headers: rows,
      mode: (mode === "proxy" ? "proxy" : "direct") satisfies RuntimeMode,
      rev: typeof rev === "number" && Number.isFinite(rev) ? rev : 0,
    });
    if (out.length >= MAX_RUNTIME_SERVERS) break;
  }
  return out;
}
