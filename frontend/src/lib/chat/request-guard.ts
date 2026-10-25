import { isSameOrigin } from "@/lib/mcp/proxy";

// /api/chat 요청의 출처와 형식 검사.
//
// 다른 사이트의 페이지가 /api/chat 을 부를 수 없게 한다. 이 라우트는 서버의 MCP_API_KEY 로 도구를 실행하고
// (런타임 프록시가 켜져 있으면) 사용자가 준 URL 에 연결하므로, 폼이나 text/plain fetch 같은 단순 요청(preflight 없음)도 막아야 한다.
//   * Origin 이 있으면 같은 호스트여야 한다 (lib/mcp/proxy.ts 의 isSameOrigin, MCP 프록시와 같은 규칙).
//   * Sec-Fetch-Site 가 cross-site 면 거부한다 (Origin 을 지우는 환경 대비).
//   * Content-Type 은 application/json 이어야 한다. 교차 출처에서 이 형식은 preflight 를 거치므로 단순 요청으로 보낼 수 없다.
export function checkChatRequestOrigin(request: Request): Response | null {
  if (!isSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}
