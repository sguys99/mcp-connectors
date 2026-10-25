// 응답 content 블록을 안전하게 그리기 위한 규칙. 서버가 준 값은 신뢰하지 않으므로
//   * data: URL 은 image/* 또는 audio/* mime 과 순수 base64 일 때만 만든다 (그 밖은 null, 화면은 원본 JSON 으로 대신 보여 준다)
//   * HTML 은 어떤 경우에도 해석하지 않는다 (텍스트로만 그린다)

const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]*$/i;
const AUDIO_MIME = /^audio\/[a-z0-9][a-z0-9.+-]*$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// SVG 는 이미지 mime 이지만 <img> 로 불러도 스크립트가 돌지 않으므로 허용한다 (data: URL 의 <img> 는 스크립트 비실행).
function stripSpace(data: string): string {
  return data.replace(/\s+/g, "");
}

export function safeDataUrl(kind: "image" | "audio", mimeType: unknown, data: unknown): string | null {
  if (typeof mimeType !== "string" || typeof data !== "string") return null;
  const mime = mimeType.trim();
  if (!(kind === "image" ? IMAGE_MIME : AUDIO_MIME).test(mime)) return null;
  const b64 = stripSpace(data);
  if (b64.length === 0 || !BASE64.test(b64)) return null;
  return `data:${mime};base64,${b64}`;
}

// base64 문자열이 디코딩되면 몇 바이트인지 (패딩 반영)
export function base64Bytes(data: string): number {
  const b64 = stripSpace(data);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

export function isMarkdownMime(mime: unknown): boolean {
  return typeof mime === "string" && /^text\/(x-)?markdown\b/i.test(mime.trim());
}

// 블록이 가리키는 종류. 알 수 없으면 "other".
export type BlockKind = "text" | "image" | "audio" | "resource" | "resource_link" | "other";

export function blockKind(block: unknown): BlockKind {
  if (!block || typeof block !== "object") return "other";
  const type = (block as { type?: unknown }).type;
  return type === "text" || type === "image" || type === "audio" || type === "resource" || type === "resource_link"
    ? type
    : "other";
}

// resources/read 의 contents[i] 를 content 블록 모양으로 바꾼다 (같은 렌더러를 쓰려고).
// blob 이 이미지면 image 블록, 그 밖의 blob 은 resource 블록(본문 없음)으로 둔다.
export function contentsToBlock(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const c = item as { uri?: unknown; mimeType?: unknown; text?: unknown; blob?: unknown };
  if (typeof c.blob === "string" && typeof c.mimeType === "string" && IMAGE_MIME.test(c.mimeType.trim())) {
    return { type: "image", data: c.blob, mimeType: c.mimeType, uri: c.uri };
  }
  if (typeof c.blob === "string" && typeof c.mimeType === "string" && AUDIO_MIME.test(c.mimeType.trim())) {
    return { type: "audio", data: c.blob, mimeType: c.mimeType, uri: c.uri };
  }
  return { type: "resource", resource: item };
}

// 표본(Mock) 데이터 결과인지. NL2SQL 의 Mock 백엔드는 structuredContent 에 data_source: "mock_sample" 과 notice 를 싣는다.
// 표본이면 서버가 준 안내문(문자열이 아니면 빈 문자열)을, 아니면 null 을 돌려준다. 안내문은 글자로만 그린다.
export function sampleDataNotice(structured: unknown): string | null {
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const record = structured as Record<string, unknown>;
  if (record.data_source !== "mock_sample") return null;
  return typeof record.notice === "string" ? record.notice.slice(0, 500) : "";
}
