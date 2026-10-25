// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";

import { ContentBlock, StructuredBlock } from "./ResponseBlocks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PNG = "iVBORw0KGgo=";

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en" dictionary={en}>
        {node}
      </I18nProvider>,
    );
  });
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("ContentBlock", () => {
  it("pretty prints JSON text and shows a plain text block as text", async () => {
    const el = await mount(
      <>
        <ContentBlock block={{ type: "text", text: '{"a":1}' }} index={0} />
        <ContentBlock block={{ type: "text", text: "hello <b>world</b>" }} index={1} />
      </>,
    );
    const pres = el.querySelectorAll("pre");
    expect(pres[0]?.textContent).toContain('"a": 1');
    // HTML 은 해석하지 않고 글자 그대로 보인다.
    expect(pres[1]?.textContent).toBe("hello <b>world</b>");
    expect(el.querySelector("b")).toBeNull();
  });

  it("renders an image block as an <img> with a data URL and its size", async () => {
    const el = await mount(<ContentBlock block={{ type: "image", data: PNG, mimeType: "image/png" }} index={1} />);
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`data:image/png;base64,${PNG}`);
    expect(img?.getAttribute("alt")).toBeTruthy();
    expect(el.textContent).toContain("image/png");
    expect(el.textContent).toContain("8 B");
  });

  it("refuses a non-image mime type: no <img>, a blocked note, and a truncated raw view", async () => {
    const data = "A".repeat(80);
    const el = await mount(<ContentBlock block={{ type: "image", data, mimeType: "text/html" }} index={0} />);
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("[role=note]")?.textContent).toContain("Not rendered");
    expect(el.textContent).not.toContain(data);
  });

  it("refuses image data that is not base64", async () => {
    const el = await mount(<ContentBlock block={{ type: "image", data: '"><script>alert(1)</script>', mimeType: "image/png" }} index={0} />);
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
  });

  it("renders audio with controls only for audio mime types", async () => {
    const ok = await mount(<ContentBlock block={{ type: "audio", data: PNG, mimeType: "audio/wav" }} index={0} />);
    expect(ok.querySelector("audio")?.getAttribute("src")).toBe(`data:audio/wav;base64,${PNG}`);
  });

  it("renders an embedded markdown resource as markdown with a Raw toggle, never raw HTML", async () => {
    const el = await mount(
      <ContentBlock
        block={{ type: "resource", resource: { uri: "u://a", mimeType: "text/markdown", text: "# Title\n\n<script>alert(1)</script>\n\n![x](http://evil.test/p.png)" } }}
        index={0}
      />,
    );
    expect(el.querySelector("[data-rendered=markdown]")).not.toBeNull();
    expect(el.querySelector("script")).toBeNull();
    // 원격 이미지는 불러오지 않는다
    expect(el.querySelector("img")).toBeNull();
    const raw = [...el.querySelectorAll("button")].find((b) => b.textContent === "Raw")!;
    await act(async () => raw.click());
    expect(el.querySelector("[data-rendered=markdown]")).toBeNull();
    expect(el.querySelector("pre")?.textContent).toContain("# Title");
  });

  it("renders an embedded image resource from a blob", async () => {
    const el = await mount(
      <ContentBlock block={{ type: "resource", resource: { uri: "u://logo.png", mimeType: "image/png", blob: PNG } }} index={2} />,
    );
    expect(el.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${PNG}`);
  });

  it("describes a non-image embedded blob without rendering it", async () => {
    const el = await mount(
      <ContentBlock block={{ type: "resource", resource: { uri: "u://b.bin", mimeType: "application/octet-stream", blob: PNG } }} index={0} />,
    );
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("u://b.bin");
    expect(el.textContent).toContain("Binary data");
  });

  it("renders resource_link with uri, name and description", async () => {
    const el = await mount(
      <ContentBlock block={{ type: "resource_link", uri: "u://x", name: "x", title: "The X", mimeType: "text/plain", description: "about x" }} index={0} />,
    );
    expect(el.textContent).toContain("resource_link");
    expect(el.textContent).toContain("The X");
    expect(el.textContent).toContain("u://x");
    expect(el.textContent).toContain("about x");
  });

  it("falls back to raw JSON for unknown block types", async () => {
    const el = await mount(<ContentBlock block={{ type: "video", url: "u://v" }} index={3} />);
    expect(el.querySelector("[data-block=video]")).not.toBeNull();
    expect(el.textContent).toContain('"url"');
  });
});

describe("StructuredBlock", () => {
  it("shows structuredContent as an object block", async () => {
    const el = await mount(<StructuredBlock value={{ total: 3 }} />);
    expect(el.textContent).toContain("structuredContent");
    expect(el.textContent).toContain('"total": 3');
  });
});
