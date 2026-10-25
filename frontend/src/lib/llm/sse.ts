// SSE (Server-Sent Events) 직렬화 헬퍼 (Phase 5-3).
// WireEvent (LLMEvent + 서버 시각) → SSE wire format. Route handler 와 차후 5-4 chat page (디코더) 가 공유.
//
// 형식: `data: <JSON>\n\n`  (이벤트 타입 라벨 없이 단일 채널)
// 클라이언트는 "\n\n" 단위로 split 후 "data: " 접두를 떼고 JSON.parse 한다.

import type { WireEvent } from "@/lib/chat/events";

const encoder = new TextEncoder();

export function encodeEvent(event: WireEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}
