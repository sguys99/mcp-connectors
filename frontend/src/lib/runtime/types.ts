// 런타임 서버 (Phase 5, P5-5): 이 탭의 세션 동안만 유지되는, 사용자가 UI 에서 추가한 외부 MCP 서버.

export type RuntimeMode = "direct" | "proxy";

export interface RuntimeHeader {
  name: string;
  value: string;
}

export interface RuntimeServerDef {
  name: string;
  // 사용자가 입력한 대상 Streamable HTTP URL (http/https)
  url: string;
  headers: RuntimeHeader[];
  mode: RuntimeMode;
  // 수정할 때마다 올라가는 번호. 상태 점검 클라이언트를 새로 만들게 하는 신호다.
  rev: number;
}
