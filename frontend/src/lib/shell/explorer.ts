// 서버 탐색기 필터: 이름이나 설명에 검색어가 들어 있는 항목만 남긴다.

import type { PublicServer } from "@/lib/mcp/types";

export function filterServers<T extends Pick<PublicServer, "name" | "description">>(
  servers: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...servers];
  return servers.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q),
  );
}
