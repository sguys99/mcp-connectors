import { describe, expect, it } from "vitest";

import { isEditableTarget, matchesShortcut, parseShortcut, shortcutLabel } from "./shortcuts";

const ev = (over: Partial<Parameters<typeof matchesShortcut>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("parseShortcut", () => {
  it("수식 키와 키를 나눈다", () => {
    expect(parseShortcut("mod+k")).toEqual({ key: "k", mod: true, shift: false, alt: false });
    expect(parseShortcut("Mod+Shift+Enter")).toEqual({ key: "enter", mod: true, shift: true, alt: false });
  });

  it("별칭을 풀어 준다", () => {
    expect(parseShortcut("esc").key).toBe("escape");
  });

  it("키가 없으면 던진다", () => {
    expect(() => parseShortcut("mod+")).toThrow();
  });
});

describe("matchesShortcut", () => {
  it("⌘K 와 Ctrl+K 를 모두 받는다", () => {
    expect(matchesShortcut(ev({ key: "k", metaKey: true }), "mod+k")).toBe(true);
    expect(matchesShortcut(ev({ key: "K", ctrlKey: true }), "mod+k")).toBe(true);
  });

  it("수식 키가 없으면 mod 단축키가 아니다", () => {
    expect(matchesShortcut(ev({ key: "k" }), "mod+k")).toBe(false);
  });

  it("수식 키 없는 단축키는 ⌘ 이나 Ctrl 이 눌리면 맞지 않는다", () => {
    expect(matchesShortcut(ev({ key: "/" }), "/")).toBe(true);
    expect(matchesShortcut(ev({ key: "/", ctrlKey: true }), "/")).toBe(false);
  });

  it("Shift 와 Alt 는 정확히 맞아야 한다", () => {
    expect(matchesShortcut(ev({ key: "k", metaKey: true, shiftKey: true }), "mod+k")).toBe(false);
    expect(matchesShortcut(ev({ key: "k", metaKey: true, altKey: true }), "mod+k")).toBe(false);
  });

  it("Enter 와 Escape 를 인식한다", () => {
    expect(matchesShortcut(ev({ key: "Enter", metaKey: true }), "mod+enter")).toBe(true);
    expect(matchesShortcut(ev({ key: "Escape" }), "escape")).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("입력 요소를 가려낸다", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("shortcutLabel", () => {
  it("플랫폼에 맞는 표기를 만든다", () => {
    expect(shortcutLabel("mod+k", true)).toEqual(["⌘", "K"]);
    expect(shortcutLabel("mod+k", false)).toEqual(["Ctrl", "K"]);
    expect(shortcutLabel("mod+enter", true)).toEqual(["⌘", "↵"]);
  });
});
