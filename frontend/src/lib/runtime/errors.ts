// 런타임 서버 연결 오류를 사람이 고칠 수 있는 문구로 바꾼다.
// 브라우저는 CORS 거부와 네트워크 단절을 구분해 주지 않는다 (둘 다 TypeError "Failed to fetch"). 그래서 한 문구에 두 가능성과 해결책을 함께 적는다.

import type { PublicServer } from "@/lib/mcp/types";

type Translate = (key: "runtime.errNetwork", vars?: Record<string, string | number>) => string;

function appOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
}

// 직접 연결(direct) 런타임 서버가 네트워크 오류로 실패했을 때의 안내. 그 밖이면 null (원래 오류 문구를 쓴다).
export function describeNetworkFailure(
  server: Pick<PublicServer, "transport"> & { runtime?: { mode: "direct" | "proxy"; target: string } },
  errorKind: "network" | undefined,
  t: Translate,
): string | null {
  if (errorKind !== "network") return null;
  if (server.transport !== "streamable_http" || server.runtime?.mode !== "direct") return null;
  let origin = server.runtime.target;
  try {
    origin = new URL(server.runtime.target).origin;
  } catch {
    /* 대상 URL 전체를 그대로 보여 준다 */
  }
  return t("runtime.errNetwork", { target: origin, app: appOrigin() });
}
