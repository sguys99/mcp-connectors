// localStorage 가 막혀 있어도 던지지 않는 저장소. react-resizable-panels 의 useDefaultLayout 이 받는 모양(getItem, setItem)이다.
// 읽기는 마운트 뒤(클라이언트)에만 일어난다.

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 저장 못 해도 화면은 동작한다 */
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 막혀 있으면 지울 것도 없다 */
    }
  },
};
