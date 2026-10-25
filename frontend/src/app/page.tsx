import { connection } from "next/server";

import { DashboardView } from "@/components/dashboard/DashboardView";
import { getPublicServers } from "@/lib/mcp/registry";
import type { PublicServer } from "@/lib/mcp/types";

export default async function Home() {
  // 레지스트리는 요청 시점에 읽는다 (yaml 수정이 재빌드 없이 반영되도록 prerender 제외).
  await connection();

  // 파일이 없거나 형식이 틀리면 화면이 죽지 않고 오류 상태를 보여 준다 (셸 레이아웃은 이미 빈 목록으로 살아 있다).
  let servers: PublicServer[] = [];
  let registryError: string | null = null;
  try {
    servers = await getPublicServers();
  } catch (err) {
    registryError = err instanceof Error ? err.message : String(err);
  }

  return <DashboardView servers={servers} registryError={registryError} />;
}
