import type { CallResult, CallToolPayload, GetPromptPayload, ReadResourcePayload } from "@/lib/mcp/types";

// 사용자가 실행 버튼으로 보내는 요청 메서드 (도구 호출, 리소스 읽기, 프롬프트 가져오기)
export type CallMethod = "tools/call" | "resources/read" | "prompts/get";

export type CallPayload = CallToolPayload | ReadResourcePayload | GetPromptPayload;

// 끝난 호출 한 건. 응답 패널과 타이밍 탭이 이것으로 그린다.
export interface CallRecord {
  method: CallMethod;
  server: string;
  // 도구 이름, 리소스 URI, 프롬프트 이름
  tool: string;
  // 프록시 경로 (예: /api/mcp/starter-mcp-http)
  endpoint: string;
  args: Record<string, unknown>;
  result: CallResult<CallPayload>;
}

export type ResponseView =
  | { kind: "idle" }
  | { kind: "running"; tool: string; method: CallMethod }
  | ({ kind: "done" } & CallRecord);
