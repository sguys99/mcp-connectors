// @vitest-environment happy-dom
// Chat Markdown 표: 넓은 표가 잘리지 않고 이름 있는 가로 스크롤 영역 안에서 키보드로 스크롤되는지 본다.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";

import { ChatMarkdown } from "./Markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(text: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en" dictionary={en}>
        <ChatMarkdown text={text} />
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

const TABLE = [
  "| Column | Type | Comment |",
  "|---|---|---|",
  "| customer_id | integer | FK to customer (a long comment that would push the table wider than the thread) |",
].join("\n");

describe("ChatMarkdown tables", () => {
  it("wraps a table in a named, focusable region that scrolls sideways", async () => {
    const el = await mount(TABLE);
    const region = el.querySelector("[data-md-table]");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("role")).toBe("region");
    expect(region!.getAttribute("aria-label")).toBe(en.chat.tableRegion);
    expect(region!.getAttribute("tabindex")).toBe("0");
    expect(region!.className).toContain("overflow-x-auto");
    expect(region!.querySelector("table")).not.toBeNull();
  });

  it("lets body cells wrap at word boundaries instead of forcing one line", async () => {
    const el = await mount(TABLE);
    const td = el.querySelector("td");
    expect(td!.className).not.toContain("whitespace-nowrap");
    expect(td!.className).toContain("max-w-[48ch]");
    // 머리글은 한 줄을 유지한다
    expect(el.querySelector("th")!.className).toContain("whitespace-nowrap");
  });
});
