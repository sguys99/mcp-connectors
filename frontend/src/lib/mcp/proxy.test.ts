import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardMcp, readBodyWithLimit } from "./proxy";

// Content-Length 없이 청크로 흘러오는 본문 (chunked 업로드). pulled 로 얼마나 읽혔는지 센다.
function chunkedRequest(chunks: number, chunkSize: number) {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(97));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/mcp-runtime", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
    // @ts-expect-error Node fetch 는 스트림 본문에 duplex 가 필요하다
    duplex: "half",
  });
  return { request, pulled: () => pulled, cancelled: () => cancelled };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBodyWithLimit", () => {
  it("returns the whole body when it fits", async () => {
    const { request } = chunkedRequest(3, 10);
    const buf = await readBodyWithLimit(request, 30);
    expect(buf?.byteLength).toBe(30);
  });

  it("stops reading and cancels once the limit is crossed", async () => {
    const r = chunkedRequest(1000, 1024);
    expect(await readBodyWithLimit(r.request, 4096)).toBeNull();
    expect(r.pulled()).toBeLessThan(10);
    expect(r.cancelled()).toBe(true);
  });
});

describe("forwardMcp request size cap", () => {
  it("returns 413 for an oversized chunked body without calling upstream", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = chunkedRequest(1000, 1024);
    const res = await forwardMcp(r.request, { label: "t", url: "http://upstream/mcp", headers: {}, maxRequestBytes: 8192 });
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.pulled()).toBeLessThan(20);
  });

  it("forwards a body within the cap", async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.body as ArrayBuffer).byteLength).toBe(2048);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const r = chunkedRequest(2, 1024);
    const res = await forwardMcp(r.request, { label: "t", url: "http://upstream/mcp", headers: {}, maxRequestBytes: 8192 });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
