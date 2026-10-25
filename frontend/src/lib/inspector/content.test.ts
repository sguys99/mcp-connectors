import { describe, expect, it } from "vitest";

import { base64Bytes, blockKind, contentsToBlock, isMarkdownMime, safeDataUrl, sampleDataNotice } from "./content";

const PNG = "iVBORw0KGgo=";

describe("safeDataUrl", () => {
  it("builds a data URL for image mime types with base64 data", () => {
    expect(safeDataUrl("image", "image/png", PNG)).toBe(`data:image/png;base64,${PNG}`);
    expect(safeDataUrl("image", "image/svg+xml", PNG)).toBe(`data:image/svg+xml;base64,${PNG}`);
    expect(safeDataUrl("audio", "audio/mpeg", PNG)).toBe(`data:audio/mpeg;base64,${PNG}`);
  });

  it("rejects non-image mime types, so text/html and scripts never become data URLs", () => {
    expect(safeDataUrl("image", "text/html", PNG)).toBeNull();
    expect(safeDataUrl("image", "application/javascript", PNG)).toBeNull();
    expect(safeDataUrl("image", "application/pdf", PNG)).toBeNull();
    expect(safeDataUrl("audio", "image/png", PNG)).toBeNull();
    expect(safeDataUrl("image", "audio/mpeg", PNG)).toBeNull();
  });

  it("rejects mime strings that try to inject parameters or extra URL parts", () => {
    expect(safeDataUrl("image", "image/png;base64,AAAA,<script>", PNG)).toBeNull();
    expect(safeDataUrl("image", "image/png\"onerror=alert(1)", PNG)).toBeNull();
    expect(safeDataUrl("image", "image/", PNG)).toBeNull();
    expect(safeDataUrl("image", "image", PNG)).toBeNull();
  });

  it("rejects data that is not plain base64", () => {
    expect(safeDataUrl("image", "image/png", "<svg onload=alert(1)>")).toBeNull();
    expect(safeDataUrl("image", "image/png", "data:image/png;base64,AAAA")).toBeNull();
    expect(safeDataUrl("image", "image/png", "")).toBeNull();
    expect(safeDataUrl("image", 5, PNG)).toBeNull();
    expect(safeDataUrl("image", "image/png", undefined)).toBeNull();
  });

  it("accepts base64 with line breaks and strips them", () => {
    expect(safeDataUrl("image", "image/png", "iVBO\nRw0K\nGgo=")).toBe(`data:image/png;base64,${PNG}`);
  });
});

describe("base64Bytes", () => {
  it("counts decoded bytes including padding", () => {
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("")).toBe(0);
  });
});

describe("blockKind and mime helpers", () => {
  it("names block types and falls back to other", () => {
    expect(blockKind({ type: "text" })).toBe("text");
    expect(blockKind({ type: "resource_link" })).toBe("resource_link");
    expect(blockKind({ type: "video" })).toBe("other");
    expect(blockKind(null)).toBe("other");
  });
  it("detects markdown mime", () => {
    expect(isMarkdownMime("text/markdown")).toBe(true);
    expect(isMarkdownMime("text/markdown; charset=utf-8")).toBe(true);
    expect(isMarkdownMime("text/html")).toBe(false);
    expect(isMarkdownMime(undefined)).toBe(false);
  });
});

describe("contentsToBlock", () => {
  it("turns image blobs into image blocks", () => {
    expect(contentsToBlock({ uri: "u://logo", mimeType: "image/png", blob: PNG })).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
      uri: "u://logo",
    });
  });
  it("keeps text and other contents as embedded resource blocks", () => {
    const text = { uri: "u://a", mimeType: "text/plain", text: "hi" };
    expect(contentsToBlock(text)).toEqual({ type: "resource", resource: text });
    const bin = { uri: "u://b", mimeType: "application/octet-stream", blob: PNG };
    expect(contentsToBlock(bin)).toEqual({ type: "resource", resource: bin });
  });
  it("does not promote a non-image blob that claims an image mime with a bad shape", () => {
    // mime 이 image 가 아니면 image 블록이 되지 않는다.
    expect(contentsToBlock({ uri: "u://c", mimeType: "text/html", blob: PNG })).toMatchObject({ type: "resource" });
  });
});

describe("sampleDataNotice", () => {
  it("returns the server notice only for mock sample results", () => {
    expect(sampleDataNotice({ data_source: "mock_sample", notice: "Mock backend: sample rows" })).toBe("Mock backend: sample rows");
    expect(sampleDataNotice({ data_source: "mock_sample" })).toBe("");
    expect(sampleDataNotice({ data_source: "database", notice: "x" })).toBeNull();
    expect(sampleDataNotice(undefined)).toBeNull();
    expect(sampleDataNotice([{ data_source: "mock_sample" }])).toBeNull();
  });
});
