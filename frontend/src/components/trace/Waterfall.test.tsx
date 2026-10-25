// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";
import type { TraceSpan } from "@/lib/trace/spans";

import { Waterfall } from "./Waterfall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPANS: TraceSpan[] = [
  { id: "root", kind: "proxy", label: "browser", start: 0, dur: 100, status: "ok" },
  { id: "tool", kind: "tool", label: "run_sql_query", start: 10, dur: 60, status: "error", parent: "root" },
  { id: "wait", kind: "wait", label: "approval", start: 70, dur: 20, status: "waiting", parent: "root" },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: React.ReactNode) {
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
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-span]")];
const key = (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

describe("Waterfall", () => {
  it("renders a read-only list with a sentence per span", async () => {
    await mount(<Waterfall spans={SPANS} label="Trace" />);
    expect(document.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("Trace");
    expect(rows().map((r) => r.getAttribute("role"))).toEqual(["listitem", "listitem", "listitem"]);
    // 이름, 소요 시간, 상태가 한 문장으로 읽힌다.
    expect(rows()[1]!.getAttribute("aria-label")).toBe("Tool, run_sql_query, 60 ms, Failed");
    expect(rows()[2]!.getAttribute("aria-label")).toBe("Wait, approval, 20 ms, Waiting");
    expect(rows().every((r) => !r.hasAttribute("tabindex"))).toBe(true);
  });

  it("orders children under their parent and shows the legend for kinds in use", async () => {
    await mount(<Waterfall spans={[...SPANS].reverse()} label="Trace" />);
    expect(rows().map((r) => r.dataset.span)).toEqual(["root", "tool", "wait"]);
    const legend = [...document.querySelectorAll("ul[aria-label] li")].map((li) => li.textContent);
    expect(legend).toEqual(["Tool", "Proxy", "Wait"]);
  });

  it("becomes a selectable listbox with roving tabindex and keyboard selection", async () => {
    const onSelect = vi.fn();
    await mount(<Waterfall spans={SPANS} label="Trace" selectedId="tool" onSelect={onSelect} />);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    // 선택된 행이 탭 순서에 들어온다.
    expect(rows().map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);

    const tool = rows()[1]!;
    tool.focus();
    await key(tool, "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    await key(rows()[2]!, "Home");
    expect(document.activeElement).toBe(rows()[0]);
    await key(rows()[0]!, "Enter");
    expect(onSelect).toHaveBeenCalledWith("root");
  });

  it("marks waiting and cancelled spans with a hatched dashed bar, not only a color", async () => {
    await mount(<Waterfall spans={SPANS} label="Trace" />);
    const waitBar = rows()[2]!.querySelector("[aria-hidden='true'].absolute");
    expect(waitBar?.className).toContain("border-dashed");
    expect(waitBar?.className).toContain("repeating-linear-gradient");
    const okBar = rows()[0]!.querySelector("[aria-hidden='true'].absolute");
    expect(okBar?.className).not.toContain("border-dashed");
  });

  it("draws crisp one-pixel gridlines on the shared scale", async () => {
    await mount(<Waterfall spans={SPANS} label="Trace" />);
    // 아이콘 svg 의 선은 빼고, 격자 svg(pointer-events-none)만 본다.
    const lines = [...document.querySelectorAll("svg.pointer-events-none line")];
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((l) => l.getAttribute("shape-rendering") === "crispEdges" && l.getAttribute("stroke-width") === "1")).toBe(true);
  });

  it("colors bars only through --span-* tokens", async () => {
    await mount(<Waterfall spans={SPANS} label="Trace" />);
    const html = host!.innerHTML;
    expect(html).toContain("var(--span-tool)");
    expect(html).not.toMatch(/var\(--(brand|chart-\d)\)/);
  });
});
