import type { CallOutcome as CallOutcomeValue, ProxyTiming } from "@/lib/trace/timing";

// MCP 직결 어댑터 공용 타입.
// configs/mcp_servers.yaml 스키마 (PRD §5.2) 와 frontend 표시용
// 결과 타입 (Inspector / Chat / 대시보드 공용) 을 한곳에 모은다.

export type Transport = "stdio" | "streamable_http";

export interface StreamableHttpServer {
  name: string;
  transport: "streamable_http";
  url: string;
  description?: string;
  // 선택 한국어 문구 (registry yaml 의 description_ko). 브라우저 노출 시 descriptionKo 로 내려간다.
  descriptionKo?: string;
  headers?: Record<string, string>;
  // 등록 서버: 호스트에서 닿는 실제 주소 (yaml 의 url). 클라이언트 설정 복사가 쓴다. 브라우저 호출은 url (프록시 경로) 을 쓴다.
  externalUrl?: string;
  // 런타임 서버 (Phase 5, P5-5): 이 세션에서 사용자가 추가한 서버. 없으면 레지스트리 서버.
  runtime?: RuntimeInfo;
}

// 런타임 서버의 연결 정보. 헤더 값은 담지 않고 이름만 둔다 (화면, 설정 복사용).
export interface RuntimeInfo {
  // direct: 브라우저가 대상 URL 에 직접 연결, proxy: 서버의 /api/mcp-runtime 경유
  mode: "direct" | "proxy";
  // 사용자가 입력한 대상 URL
  target: string;
  headerNames: string[];
  // 수정 번호 (상태 점검 클라이언트를 새로 만들게 하는 신호)
  rev: number;
}

export interface StdioServer {
  name: string;
  transport: "stdio";
  command: readonly string[];
  description?: string;
  descriptionKo?: string;
}

export type ServerConfig = StreamableHttpServer | StdioServer;

// 브라우저에 내려주는 레지스트리 항목 (lib/mcp/registry.ts::toPublicServer).
// HTTP 항목의 url 은 프론트엔드 프록시 경로 (/api/mcp/<name>) 이고 headers 는 없다.
// stdio 항목은 command 없이 이름과 설명만 담는다.
export type PublicServer =
  | Omit<StreamableHttpServer, "headers">
  | {
      name: string;
      transport: "stdio";
      description?: string;
      descriptionKo?: string;
      // 클라이언트 설정 복사용 실행 명령 (yaml 의 command). 비밀 값이 없는 로컬 명령이다.
      command?: readonly string[];
    };

// list_tools 응답 1 건. inputSchema 는 JSON Schema Draft-07 그대로.
export interface ToolMeta {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // MCP 도구 annotations 중 화면이 쓰는 것만. 서버가 선언하지 않으면 없다.
  annotations?: ToolAnnotations;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
}

// call_tool 응답. content 는 MCP 스펙의 content 블록 배열 (text/image/...) 또는
// structured 결과를 그대로 통과시킨다. Inspector ResponseViewer 가 직렬화.
export interface CallResult<P = CallToolPayload> {
  content: unknown;
  isError: boolean;
  durationMs: number;
  // 아래는 Inspector 가 쓰는 자세한 결과다. 서버 측 호출(Chat)은 위 세 필드만 보면 된다.
  detail?: CallDetail<P>;
}

export type ToolResult = CallResult<CallToolPayload>;
export type ReadResourceResult = CallResult<ReadResourcePayload>;
export type GetPromptResult = CallResult<GetPromptPayload>;

// 호출 한 건의 결과 분류.
//   ok          도구가 정상 결과를 돌려줌
//   tool-error  도구가 isError: true 로 응답함 (프로토콜은 성공)
//   rpc-error   서버가 JSON-RPC 오류를 돌려줌 (없는 도구, 잘못된 매개변수 등)
//   cancelled   사용자가 취소함 (notifications/cancelled 전송)
//   transport   서버에 닿지 못했거나 연결이 끊김, 요청 시간 초과
export type { CallOutcome } from "@/lib/trace/timing";

// tools/call 결과 객체 (MCP CallToolResult 중 화면이 쓰는 부분)
export interface CallToolPayload {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface CallDetail<P = CallToolPayload> {
  outcome: CallOutcomeValue;
  // 브라우저가 잰 호출 시간(ms, 소수 포함). 워터폴과 소요 시간 표시용이고 durationMs 는 이것을 반올림한 값이다.
  elapsedMs: number;
  // 클라이언트가 보낸 JSON-RPC 요청 id (알 수 있을 때)
  requestId?: number | string;
  // 응답 payload. transport, cancelled 에서는 없다.
  payload?: P;
  // 응답 payload 를 JSON 으로 직렬화한 크기(바이트)
  bytes?: number;
  // 프록시가 Server-Timing 헤더로 알려 준 값 (프록시를 거치지 않았으면 없음)
  proxyTiming?: ProxyTiming;
  // outcome 이 cancelled 일 때, notifications/cancelled POST 가 서버에 닿았는지
  cancelNotified?: boolean;
  // rpc-error, transport 의 오류 문구와 JSON-RPC 오류 코드
  errorMessage?: string;
  errorCode?: number;
}

export type ToolCallDetail = CallDetail<CallToolPayload>;

// ----- Resources, Prompts -----

// resources/list 항목
export interface ResourceMeta {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

// resources/templates/list 항목. uriTemplate 의 {변수} 를 채워 resources/read 로 읽는다.
export interface ResourceTemplateMeta {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptArgumentMeta {
  name: string;
  description?: string;
  required: boolean;
}

// prompts/list 항목
export interface PromptMeta {
  name: string;
  title?: string;
  description?: string;
  arguments: PromptArgumentMeta[];
}

// resources/read 의 contents[i]. text 와 blob(base64) 중 하나를 가진다.
export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface ReadResourcePayload {
  contents?: ResourceContents[];
}

// prompts/get 의 messages[i]. content 는 content 블록 하나다.
export interface PromptMessage {
  role: string;
  content: unknown;
}

export interface GetPromptPayload {
  description?: string;
  messages?: PromptMessage[];
}

// initialize 결과 (서버 정보 패널). SDK 가 원문 응답을 돌려주지 않아 같은 모양으로 다시 조립한다.
export interface ServerInfo {
  serverInfo: { name: string; version: string; title?: string };
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  instructions?: string;
  // Mcp-Session-Id (서버가 세션을 쓸 때만)
  sessionId?: string;
}

// 전송 계층을 지나는 JSON-RPC 요청 한 건의 관측 이벤트. P5-4 의 원본 로그 패널이 이 훅에 붙는다.
export interface RpcTrafficEvent {
  // out: 클라이언트가 보낸 POST 본문, in: 응답 헤더를 받은 시점
  dir: "out" | "in";
  at: number;
  method?: string;
  id?: number | string;
  // out 에서는 요청 본문 문자열, in 에서는 없다
  body?: string;
  status?: number;
}

// 전송 계층(transport)을 지나는 JSON-RPC 메시지 한 건. 응답이 SSE 로 와도, 알림이어도 잡힌다 (P5-4 의 원본 로그 패널).
export interface RpcMessageEvent {
  // out: 클라이언트가 보냈다, in: 서버에서 받았다
  dir: "out" | "in";
  // 벽시계 시각 (epoch ms)과 단조 시계 (performance.now). 소요 시간은 단조 시계로 잰다.
  at: number;
  t: number;
  // JSON-RPC 메시지 원문 (객체). 비밀 값 가리기는 기록하는 쪽(lib/inspector/rpc-log.ts)이 한다.
  message: unknown;
  // 보내기 자체가 실패했을 때의 오류 문구 (같은 message 로 한 번 더 알린다)
  sendError?: string;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  // 브라우저가 서버에 닿지 못한 오류 (CORS 거부와 네트워크 단절은 브라우저가 구분해 주지 않는다)
  errorKind?: "network";
  // 성공한 ping 에서만 채워진다. tools/list 결과 개수와, initialize 로 협상된 프로토콜 버전.
  toolCount?: number;
  protocolVersion?: string;
}
