// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";

import { useConfirm } from "./confirm-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let result: Promise<boolean> | null = null;

function Harness() {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        id="trigger"
        onClick={() => {
          result = confirm({ title: "Reset?", description: "Body", confirmLabel: "Do it", destructive: true });
        }}
      >
        open
      </button>
      {confirmDialog}
    </>
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en" dictionary={en}>
        <Harness />
      </I18nProvider>,
    );
  });
}

async function openDialog() {
  await act(async () => {
    (document.getElementById("trigger") as HTMLButtonElement).click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeAll(() => {
  // base-ui 가 요구하는 브라우저 API 보강 (happy-dom 에 없는 경우만).
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
  root = null;
  host = null;
  result = null;
});

describe("useConfirm", () => {
  it("확인을 누르면 true 로 resolve 한다", async () => {
    await mount();
    await openDialog();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => buttonByText("Do it")!.click());
    await expect(result).resolves.toBe(true);
  });

  it("취소를 누르면 false 로 resolve 한다", async () => {
    await mount();
    await openDialog();
    await act(async () => buttonByText("Cancel")!.click());
    await expect(result).resolves.toBe(false);
  });

  it("Esc 는 취소로 처리한다", async () => {
    await mount();
    await openDialog();
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await expect(result).resolves.toBe(false);
  });

  it("처음 포커스는 취소 버튼에 놓인다", async () => {
    await mount();
    await openDialog();
    expect(document.activeElement).toBe(buttonByText("Cancel"));
  });
});
