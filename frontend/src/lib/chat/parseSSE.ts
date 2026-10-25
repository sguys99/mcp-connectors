// Phase 5-4: SSE wire format → WireEvent async iterable.
// 5-3 의 sse.ts::encodeEvent 와 페어 (`data: <JSON>\n\n` 단일 채널).
//
// 클라이언트 전용 (server-only 미사용 — adapter.ts 의 LLMEvent 는 type-only import 로 우회).
// 서버 시각(t)이 없는 예전 이벤트도 그대로 통과한다. 모르는 type 의 이벤트는 건너뛴다 (서버가 앞서 업데이트된 경우).

import { isWireEvent, type WireEvent } from "./events";

const DELIMITER = "\n\n";
const DATA_PREFIX = "data: ";

// SSE 페이로드 한 덩어리에서 WireEvent 1개를 추출. 잘못된 JSON / 라인 / 모르는 type 은 null.
function parseChunk(chunk: string): WireEvent | null {
  for (const line of chunk.split("\n")) {
    if (line.startsWith(DATA_PREFIX)) {
      const payload = line.slice(DATA_PREFIX.length);
      try {
        const value: unknown = JSON.parse(payload);
        return isWireEvent(value) ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// byte ReadableStream → WireEvent async iterable.
// chunk 경계가 SSE 메시지 중간을 가로지를 수 있으므로 buffer 에 누적 후 \n\n 단위로 split.
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<WireEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf(DELIMITER);
        while (idx !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + DELIMITER.length);
          const ev = parseChunk(chunk);
          if (ev) yield ev;
          idx = buffer.indexOf(DELIMITER);
        }
      }
      if (done) {
        // flush trailing buffer (정상 인코더는 항상 \n\n 으로 끝나지만 안전망).
        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          const ev = parseChunk(buffer);
          if (ev) yield ev;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
