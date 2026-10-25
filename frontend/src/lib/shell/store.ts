// useSyncExternalStore 와 함께 쓰는 아주 작은 스토어.
// 화면이 effect 안에서 셸 정보(브레드크럼, 상태바 값)를 올릴 때 setState 연쇄 렌더를 피하려고 쓴다.

export interface Store<T> {
  get: () => T;
  // 생성 시점의 값. useSyncExternalStore 의 getServerSnapshot 으로 쓴다.
  // 하이드레이션 도중(Suspense 경계가 나중에 하이드레이션될 때) 스토어가 이미 바뀌어 있어도 서버 HTML 과 같은 값을 돌려줘야 한다 (React #418 방지).
  getInitial: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    getInitial: () => initial,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
