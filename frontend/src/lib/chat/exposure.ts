// 모델에 노출할 MCP 서버 선택 (순수 함수 + 작은 localStorage 저장).
//
// * 선택은 서버 이름 배열로 저장한다 (키 mcpc-chat-exposed). 레지스트리에서 사라진 서버는 읽을 때 걷어 낸다.
// * ?server=<name> 로 들어오면 (예전 링크) 그 서버만 노출한 채로 시작한다. 저장된 선택보다 우선한다.
// * 처음 열었을 때(저장값도 URL 도 없음)는 접속 가능한 서버를 모두 노출한다.
// * 실제로 요청에 담는 서버는 선택에서 오프라인 서버를 뺀 것이다 (effectiveExposed).

export const EXPOSED_KEY = "mcpc-chat-exposed";

export function parseExposed(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export function resolveExposed({
  stored,
  urlServer,
  reachable,
}: {
  stored: readonly string[] | null;
  urlServer: string | null;
  reachable: readonly string[];
}): string[] {
  if (urlServer && reachable.includes(urlServer)) return [urlServer];
  if (stored !== null) return reachable.filter((name) => stored.includes(name));
  return [...reachable];
}

export function toggleExposed(selected: readonly string[], reachable: readonly string[], name: string, on: boolean): string[] {
  const next = new Set(selected);
  if (on) next.add(name);
  else next.delete(name);
  // 레지스트리 순서를 유지한다.
  return reachable.filter((n) => next.has(n));
}

// 요청에 담을 서버: 선택된 것 중 오프라인이 아닌 것.
export function effectiveExposed(selected: readonly string[], offline: ReadonlySet<string>): string[] {
  return selected.filter((name) => !offline.has(name));
}

export function loadExposed(): string[] | null {
  try {
    return parseExposed(window.localStorage.getItem(EXPOSED_KEY));
  } catch {
    return null;
  }
}

export function saveExposed(names: readonly string[]): void {
  try {
    window.localStorage.setItem(EXPOSED_KEY, JSON.stringify(names));
  } catch {
    /* 저장하지 못해도 이번 화면에서는 동작한다 */
  }
}
