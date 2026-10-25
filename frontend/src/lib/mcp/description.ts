// 레지스트리 설명 문구 선택: UI 언어가 ko 이고 descriptionKo 가 있으면 그것, 아니면 영어 description.
import type { PublicServer } from "@/lib/mcp/types";

export function pickDescription(server: Pick<PublicServer, "description" | "descriptionKo">, locale: string): string {
  if (locale === "ko" && server.descriptionKo) return server.descriptionKo;
  return server.description ?? "";
}
