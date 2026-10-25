import { describe, expect, it, vi } from "vitest";

import { createStore } from "./store";

describe("createStore", () => {
  it("값을 바꾸면 구독자에게 알린다", () => {
    const store = createStore({ n: 0 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set((prev) => ({ n: prev.n + 1 }));
    expect(store.get()).toEqual({ n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.set({ n: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("같은 참조를 넣으면 알리지 않는다", () => {
    const initial = { n: 0 };
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(initial);
    expect(listener).not.toHaveBeenCalled();
  });

  it("getInitial 은 값이 바뀌어도 생성 시점의 값을 돌려준다 (하이드레이션 서버 스냅샷)", () => {
    const initial = { n: 0 };
    const store = createStore(initial);
    store.set({ n: 9 });
    expect(store.getInitial()).toBe(initial);
    expect(store.get()).toEqual({ n: 9 });
  });
});
