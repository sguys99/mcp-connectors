// 브라우저 번들에서 ajv / ajv-formats 를 대신하는 빈 모듈 (next.config.ts 의 turbopack.resolveAlias 가 연결).
//
// MCP SDK 의 Client 는 ajv 를 정적으로 import 하므로 그대로 두면 모든 화면의 공용 청크에 약 90KB(gzip)가
// 실린다. 브라우저에서는 client.ts 가 항상 jsonSchemaValidator 를 직접 넘겨 SDK 의 기본 Ajv 생성 경로를
// 타지 않으므로 이 stub 은 실행되지 않는다. 혹시 불리면 조용히 넘어가지 않고 바로 알리도록 던진다.
// 서버(Route Handler, SSR)는 별칭 대상이 아니라 진짜 ajv 를 그대로 쓴다.
export default class AjvBrowserStub {
  constructor() {
    throw new Error("[mcp] ajv is not bundled for the browser; pass jsonSchemaValidator explicitly");
  }
}
