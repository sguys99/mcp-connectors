import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STEP_IDS,
  STORAGE_KEY,
  countDone,
  emptyState,
  getSnapshot,
  markGettingStarted,
  onGettingStartedProgress,
  parseState,
  resetGettingStarted,
  serializeState,
  setGettingStartedHidden,
  withStepDone,
} from "./getting-started";

describe("parseState / serializeState", () => {
  it("저장값이 없거나 깨졌으면 빈 상태", () => {
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState("")).toEqual(emptyState());
    expect(parseState("{not json")).toEqual(emptyState());
    expect(parseState("42")).toEqual(emptyState());
    expect(parseState("null")).toEqual(emptyState());
  });

  it("알려진 단계만 살리고 모르는 키는 버린다", () => {
    const state = parseState(JSON.stringify({ v: 1, done: { startServer: true, copyConfig: true, futureStep: true, chatToolCall: "yes" }, hidden: true }));
    expect(state.done).toEqual({ startServer: true, inspectorCall: false, chatToolCall: false, copyConfig: true });
    expect(state.hidden).toBe(true);
  });

  it("직렬화하고 다시 읽으면 같다", () => {
    const state = withStepDone(emptyState(), "inspectorCall");
    expect(parseState(serializeState(state))).toEqual(state);
  });
});

describe("withStepDone", () => {
  it("이미 끝난 단계는 같은 객체를 돌려준다", () => {
    const once = withStepDone(emptyState(), "startServer");
    expect(withStepDone(once, "startServer")).toBe(once);
    expect(countDone(once)).toBe(1);
  });
});

describe("스토어", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetGettingStarted();
  });

  it("markGettingStarted 는 처음 끝낼 때만 true 이고 localStorage 에 저장한다", () => {
    expect(markGettingStarted("inspectorCall")).toBe(true);
    expect(markGettingStarted("inspectorCall")).toBe(false);
    expect(getSnapshot().done.inspectorCall).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).done.inspectorCall).toBe(true);
  });

  it("진행 알림은 새로 끝난 단계에만 온다", () => {
    const listener = vi.fn();
    const off = onGettingStartedProgress(listener);
    markGettingStarted("startServer");
    markGettingStarted("startServer");
    markGettingStarted("chatToolCall");
    off();
    markGettingStarted("inspectorCall");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { step: "startServer", done: 1, total: STEP_IDS.length });
    expect(listener).toHaveBeenNthCalledWith(2, { step: "chatToolCall", done: 2, total: STEP_IDS.length });
  });

  it("silent 로 끝낸 단계는 저장하되 진행 알림을 보내지 않는다", () => {
    const listener = vi.fn();
    const off = onGettingStartedProgress(listener);
    expect(markGettingStarted("startServer", { silent: true })).toBe(true);
    expect(getSnapshot().done.startServer).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    // 이미 끝난 단계는 silent 여부와 상관없이 false
    expect(markGettingStarted("startServer")).toBe(false);
    markGettingStarted("inspectorCall");
    off();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ step: "inspectorCall", done: 2, total: STEP_IDS.length });
  });

  it("숨김 상태도 저장하고 진행은 그대로 둔다", () => {
    markGettingStarted("startServer");
    setGettingStartedHidden(true);
    expect(getSnapshot().hidden).toBe(true);
    expect(getSnapshot().done.startServer).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).hidden).toBe(true);
    setGettingStartedHidden(false);
    expect(getSnapshot().hidden).toBe(false);
  });

  it("localStorage 가 막혀도 던지지 않고 메모리로 동작한다", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markGettingStarted("startServer")).not.toThrow();
    expect(getSnapshot().done.startServer).toBe(true);
    setItem.mockRestore();
  });
});
