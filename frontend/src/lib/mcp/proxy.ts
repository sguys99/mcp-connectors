// MCP Streamable HTTP 프록시 공통 코어. 등록 서버 프록시 (/api/mcp/[server], Phase 2 P2-8)와
// 런타임 서버 프록시 (/api/mcp-runtime, Phase 5 P5-5)가 같은 전달 로직을 쓴다.
//
// * POST (JSON-RPC), GET (SSE 스트림), DELETE (세션 종료) 를 지원하고 응답 body 는 스트리밍 그대로 통과.
// * mcp-session-id, mcp-protocol-version, last-event-id 헤더를 양방향으로 전달.
// * 브라우저가 보낸 X-MCP-API-Key, Cookie 등 허용 목록 밖의 헤더는 버린다 (호출하는 쪽이 정한 headers 만 붙인다).
//
// Server-Timing (Inspector 의 Timing 탭이 읽는다. 같은 origin 이라 브라우저가 그대로 볼 수 있다)
//   proxy     이 핸들러가 쓴 시간 (요청 본문 읽기, 응답 준비). 업스트림을 기다린 시간은 뺀다.
//   upstream  업스트림을 기다린 시간. POST 의 SSE 응답이면 첫 본문 바이트까지, 그 밖에는 응답 헤더까지.
//             (FastMCP 는 도구가 끝나기 전에 헤더부터 보내서, 헤더 시점만 재면 도구 실행 시간이 빠진다.)
//   headers   업스트림 응답 헤더가 도착한 시점까지의 시간
//
// 선택 한도 (런타임 프록시만 켠다): timeoutMs 는 응답 헤더 (POST 의 SSE 는 첫 바이트) 까지 기다리는 상한,
// maxResponseBytes 는 응답 본문 누적 상한 (넘으면 스트림을 끊는다), maxRequestBytes 는 요청 본문 상한.

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
] as const;

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-session-id",
  "mcp-protocol-version",
] as const;

export function jsonRpcError(status: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status },
  );
}

// Origin 헤더가 있으면 요청 Host 와 같아야 한다 (같은 origin 의 fetch 만 허용).
// Origin 이 없는 요청 (curl, 서버 간 호출) 은 브라우저 CSRF 경로가 아니므로 통과.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// 첫 청크를 먼저 읽고, 그 청크를 되돌려 놓은 새 스트림을 만든다. 이후 청크는 읽는 대로 통과한다.
type Chunk = Uint8Array<ArrayBuffer>;

async function peekFirstChunk(
  body: ReadableStream<Chunk>,
): Promise<{ stream: ReadableStream<Chunk>; firstByteAt: number }> {
  const reader = body.getReader();
  const first = await reader.read();
  const firstByteAt = performance.now();
  const stream = new ReadableStream<Chunk>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(first.value);
    },
    async pull(controller) {
      if (first.done) return;
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { stream, firstByteAt };
}

// 누적 바이트가 max 를 넘으면 스트림을 오류로 끝낸다 (업스트림 읽기도 취소된다).
export function limitBytes(body: ReadableStream<Chunk>, max: number): ReadableStream<Chunk> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Chunk, Chunk>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) {
          controller.error(new Error(`Response exceeded the ${max}-byte limit`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

// 요청 본문을 세면서 읽는다. 누적이 max 를 넘으면 스트림을 취소하고 null 을 돌려준다 (전체를 먼저 버퍼링하지 않는다).
export async function readBodyWithLimit(request: Request, max: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

const formatMs = (ms: number) => Math.max(0, ms).toFixed(1);

export interface ForwardOptions {
  // 오류 문구에 쓰는 이름 (등록 서버 이름 또는 대상 host)
  label: string;
  url: string;
  // 업스트림에 붙일 헤더. 브라우저 요청의 허용 목록 헤더 위에 얹는다.
  headers: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
}

export async function forwardMcp(request: Request, opts: ForwardOptions): Promise<Response> {
  const startedAt = performance.now();
  const { label } = opts;

  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  for (const [h, v] of Object.entries(opts.headers)) headers.set(h, v);

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    if (opts.maxRequestBytes !== undefined) {
      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > opts.maxRequestBytes) {
        return jsonRpcError(413, `Request body exceeds the ${opts.maxRequestBytes}-byte limit`);
      }
    }
    if (opts.maxRequestBytes === undefined) {
      body = await request.arrayBuffer();
    } else {
      // Content-Length 가 없거나 거짓이어도 (chunked) 한도를 넘는 순간 읽기를 멈춘다.
      const read = await readBodyWithLimit(request, opts.maxRequestBytes);
      if (read === null) {
        return jsonRpcError(413, `Request body exceeds the ${opts.maxRequestBytes}-byte limit`);
      }
      body = read;
    }
  }

  // 타임아웃은 응답이 시작될 때까지만 건다. 시작한 뒤의 SSE 스트림은 길게 열려 있을 수 있다.
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer =
    opts.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, opts.timeoutMs)
      : undefined;
  const signal = timer !== undefined ? AbortSignal.any([request.signal, timeoutController.signal]) : request.signal;
  const failure = (err: unknown, stage: string): Response => {
    if (timedOut) return jsonRpcError(504, `MCP server '${label}' did not respond within ${opts.timeoutMs} ms`);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return jsonRpcError(502, `MCP server '${label}' ${stage}: ${(err as Error).message}`);
  };

  let res: Response;
  const upstreamStartedAt = performance.now();
  try {
    res = await fetch(opts.url, {
      method: request.method,
      headers,
      body,
      signal,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    clearTimeout(timer);
    return failure(err, "is unreachable");
  }

  const headersAt = performance.now();
  const contentType = res.headers.get("content-type") ?? "";

  if (opts.maxResponseBytes !== undefined) {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > opts.maxResponseBytes) {
      clearTimeout(timer);
      void res.body?.cancel().catch(() => undefined);
      return jsonRpcError(502, `MCP server '${label}' response exceeds the ${opts.maxResponseBytes}-byte limit`);
    }
  }

  let responseBody = res.body;
  let upstreamEndAt = headersAt;
  let upstreamDesc = "headers";
  if (request.method === "POST" && res.body && contentType.includes("text/event-stream")) {
    try {
      const peeked = await peekFirstChunk(res.body);
      responseBody = peeked.stream;
      upstreamEndAt = peeked.firstByteAt;
      upstreamDesc = "first-byte";
    } catch (err) {
      clearTimeout(timer);
      return failure(err, "closed the stream early");
    }
  }
  clearTimeout(timer);

  if (responseBody && opts.maxResponseBytes !== undefined) {
    responseBody = limitBytes(responseBody as ReadableStream<Chunk>, opts.maxResponseBytes);
  }

  const outHeaders = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) outHeaders.set(h, v);
  }
  if (contentType.includes("text/event-stream")) {
    // reverse proxy 의 SSE 버퍼링 차단 (api/chat 과 동일).
    outHeaders.set("X-Accel-Buffering", "no");
    outHeaders.set("Cache-Control", "no-cache, no-transform");
  }

  const upstreamMs = upstreamEndAt - upstreamStartedAt;
  const proxyMs = performance.now() - startedAt - upstreamMs;
  outHeaders.set(
    "Server-Timing",
    `proxy;dur=${formatMs(proxyMs)}, upstream;dur=${formatMs(upstreamMs)};desc="${upstreamDesc}", headers;dur=${formatMs(headersAt - upstreamStartedAt)}`,
  );

  return new Response(responseBody, { status: res.status, headers: outHeaders });
}
