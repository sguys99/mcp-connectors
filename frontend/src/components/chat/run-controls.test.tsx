// @vitest-environment happy-dom
// Chat 실행 제어 UI 상태: 승인 카드, 툴바(최대 반복, 승인 방식), 토큰 미터 (P5-6).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatToolUseWithResult } from "@/lib/chat/serialize";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";
import { ko } from "@/lib/i18n/ko";
import type { Dictionary } from "@/lib/i18n/en";

import { ChatToolbar } from "./ChatToolbar";
import { TokenMeter } from "./TokenMeter";
import { ToolCard } from "./ToolCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode, locale: "en" | "ko" = "en") {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const dictionary: Dictionary = locale === "en" ? en : (ko as unknown as Dictionary);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale} dictionary={dictionary}>
        {node}
      </I18nProvider>,
    );
  });
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!("ResizeObserver" in g)) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
  root = null;
  host = null;
});

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

const PENDING: ChatToolUseWithResult = {
  id: "a",
  name: "nl2sql__run_sql_query",
  server: "nl2sql",
  tool: "run_sql_query",
  input: { sql: "SELECT count(*) FROM film" },
  result: null,
  approval: { state: "pending", waitStartT: 400, waitStartClient: 1000 },
};

const noop = () => {};
function card(tool: ChatToolUseWithResult, status: Parameters<typeof ToolCard>[0]["status"], onDecide = vi.fn()) {
  return (
    <ToolCard tool={tool} status={status} spanId="s" durationMs={null} linked={false} selected={false} onLink={noop} onShowInTrace={noop} onDecide={onDecide} />
  );
}

describe("ToolCard approval", () => {
  it("shows the waiting panel with the SQL, a timer, and Approve / Deny; Approve passes the always-allow choice", async () => {
    const onDecide = vi.fn();
    await mount(card(PENDING, "approval", onDecide));
    expect(q('[role="group"][aria-label="Waiting for your approval"]')).not.toBeNull();
    expect(q("pre")?.textContent).toBe("SELECT count(*) FROM film");
    expect(document.body.textContent).toContain("approval");
    expect(document.body.textContent).toMatch(/Waiting \d/);

    await act(async () => buttonByText("Approve")!.click());
    expect(onDecide).toHaveBeenLastCalledWith("a", "approve", false);

    // 체크박스를 켜고 승인하면 always=true
    const check = q('[role="checkbox"]')!;
    await act(async () => check.click());
    await act(async () => buttonByText("Approve")!.click());
    expect(onDecide).toHaveBeenLastCalledWith("a", "approve", true);
    expect(document.body.textContent).toContain("Always allow nl2sql / run_sql_query in this conversation");

    await act(async () => buttonByText("Deny")!.click());
    expect(onDecide).toHaveBeenLastCalledWith("a", "deny", false);
  });

  it("is always open while waiting (no collapse trigger) and has no decision buttons afterwards", async () => {
    await mount(card(PENDING, "approval"));
    expect(q('[data-slot="collapsible-trigger"]')).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    const approved = { ...PENDING, approval: { ...PENDING.approval!, state: "approved" as const, decidedT: 900 } };
    await mount(card(approved, "approved"));
    expect(buttonByText("Approve")).toBeUndefined();
    expect(document.body.textContent).toContain("Approved. It runs after you decide the other calls.");
  });

  it("denied cards show the denial note instead of the model-facing message", async () => {
    const denied: ChatToolUseWithResult = {
      ...PENDING,
      result: { content: "The user denied this call to 'x'", isError: true },
      approval: { ...PENDING.approval!, state: "denied", decidedT: 900 },
    };
    await mount(card(denied, "denied"));
    expect(document.body.textContent).toContain("denied");
    expect(document.body.textContent).toContain("Denied by you. The model was told the call did not run.");
    expect(document.body.textContent).not.toContain("The user denied this call to");
  });
});

describe("TokenMeter", () => {
  const usage = { input: 1234, output: 56, cacheRead: 1000 };
  it("shows provider-reported totals, a context meter when the window is known, and the session total", async () => {
    await mount(<TokenMeter conversation={{ usage, reported: 2, total: 2 }} session={{ input: 5000, output: 500 }} latest={{ input: 1000, output: 50 }} windowSize={200_000} />);
    expect(q('[data-testid="tokens-in"]')?.textContent).toBe("1,234");
    expect(q('[data-testid="tokens-out"]')?.textContent).toBe("56");
    expect(q('[data-testid="tokens-session"]')?.textContent).toBe("5.5k");
    expect(q('[role="img"]')?.getAttribute("aria-label")).toBe("Context used by the last request: 1,050 of 200,000 tokens");
    expect(document.body.textContent).not.toContain("partial");
  });

  it("flags partial totals, and says 'not reported' (never zero) when no request reported usage", async () => {
    await mount(<TokenMeter conversation={{ usage, reported: 1, total: 3 }} session={null} latest={null} windowSize={null} />);
    expect(document.body.textContent).toContain("partial");
    expect(q('[role="img"]')).toBeNull();
    await act(async () => root?.unmount());
    host?.remove();
    await mount(<TokenMeter conversation={{ usage: null, reported: 0, total: 2 }} session={null} latest={null} windowSize={null} />);
    expect(document.body.textContent).toContain("tokens not reported");
    expect(q('[data-testid="tokens-in"]')).toBeNull();
  });

  it("starts at zero before any request and localizes labels", async () => {
    await mount(<TokenMeter conversation={{ usage: null, reported: 0, total: 0 }} session={null} latest={null} windowSize={null} />, "ko");
    expect(q('[data-testid="tokens-in"]')?.textContent).toBe("0");
    expect(q('[role="group"]')?.getAttribute("aria-label")).toBe("토큰 사용량");
  });
});

describe("ChatToolbar run controls", () => {
  function toolbar(over: Partial<Parameters<typeof ChatToolbar>[0]> = {}) {
    const props: Parameters<typeof ChatToolbar>[0] = {
      provider: "anthropic",
      anthropicModel: "claude-sonnet-4-6",
      openaiModel: "gpt-4o",
      openrouterModel: "anthropic/claude-sonnet-4-6",
      onModelChange: vi.fn(),
      maxIterations: 5,
      onMaxIterationsChange: vi.fn(),
      approval: "auto",
      onApprovalChange: vi.fn(),
      conversationUsage: { usage: null, reported: 0, total: 0 },
      sessionUsage: null,
      latestUsage: null,
      contextWindow: null,
      onClear: vi.fn(),
      clearDisabled: true,
      ...over,
    };
    return { props, node: <ChatToolbar {...props} /> };
  }
  const input = () => q<HTMLInputElement>('input[type="number"]')!;
  async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("commits an in-range iteration count as you type and clamps out-of-range values on blur", async () => {
    const { props, node } = toolbar();
    await mount(node);
    expect(input().value).toBe("5");
    await type(input(), "8");
    expect(props.onMaxIterationsChange).toHaveBeenLastCalledWith(8);
    await type(input(), "99");
    expect(props.onMaxIterationsChange).toHaveBeenCalledTimes(1);
    await act(async () => input().blur());
    expect(props.onMaxIterationsChange).toHaveBeenLastCalledWith(20);
    expect(input().value).toBe("20");
  });

  it("restores the previous value for empty input and rounds decimals", async () => {
    const { props, node } = toolbar({ maxIterations: 7 });
    await mount(node);
    await type(input(), "");
    await act(async () => input().blur());
    expect(input().value).toBe("7");
    expect(props.onMaxIterationsChange).not.toHaveBeenCalled();
    await type(input(), "0");
    await act(async () => input().blur());
    expect(props.onMaxIterationsChange).toHaveBeenLastCalledWith(1);
  });

  it("approval is a radio group (Auto / Manual) with a single tab stop that follows the arrow keys", async () => {
    const { props, node } = toolbar({ approval: "auto" });
    await mount(node);
    const group = q('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-labelledby")).toBeTruthy();
    const [auto, manual] = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(auto!.getAttribute("aria-checked")).toBe("true");
    expect(auto!.tabIndex).toBe(0);
    expect(manual!.tabIndex).toBe(-1);
    await act(async () => manual!.click());
    expect(props.onApprovalChange).toHaveBeenLastCalledWith("manual");
    await act(async () => auto!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(props.onApprovalChange).toHaveBeenLastCalledWith("manual");
  });

  it("model changes go to onModelChange (the toolbar never writes settings itself)", async () => {
    const { node } = toolbar();
    await mount(node);
    expect(window.localStorage.getItem("mcp-connectors.settings")).toBeNull();
  });
});
