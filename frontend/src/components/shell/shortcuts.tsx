"use client";

// 전역 단축키 레지스트리. 셸이 keydown 리스너를 하나만 달고, 화면은 useShortcut 으로 항목을 등록한다.
//
//   useShortcut("mod+enter", () => run(), { enabled: canRun });   // Inspector 실행, Chat 전송
//   useShortcut("escape", () => cancel(), { enabled: running });   // 취소, 중지
//   useShortcut("mod+j", () => toggleDock());                      // 도킹 패널
//   useShortcut("/", () => filterRef.current?.focus());            // 도구 필터
//
// 규칙
//   * 나중에 등록한 항목이 먼저 처리한다 (화면이 셸의 기본 동작을 덮어쓸 수 있다).
//   * 수식 키(mod) 없는 단축키는 입력창 안에서 무시한다. 필요하면 allowInInput 을 준다.
//   * 팔레트, 드로어 같은 대화상자가 열려 있으면 mod+k 외에는 무시한다. 필요하면 allowInOverlay 를 준다.
//   * 처리한 이벤트는 preventDefault 한다.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { isEditableTarget, matchesShortcut, parseShortcut, type ShortcutSpec } from "@/lib/shell/shortcuts";

export interface ShortcutOptions {
  enabled?: boolean;
  allowInInput?: boolean;
  allowInOverlay?: boolean;
  // 한 글자 단축키(예: "/")는 WCAG 2.1.4 에 따라 해당 컴포넌트에 포커스가 있을 때만 켠다.
  // 값은 포커스가 그 안에 있어야 하는 요소의 CSS 선택자다.
  whenFocusWithin?: string;
}

interface Entry {
  spec: ShortcutSpec;
  handler: (event: KeyboardEvent) => void;
  options: ShortcutOptions;
}

type Registry = ReturnType<typeof createRegistry>;

const ShortcutContext = createContext<Registry | null>(null);

function createRegistry() {
  let entries: Entry[] = [];
  return {
    register(entry: Entry) {
      entries.push(entry);
      return () => {
        entries = entries.filter((e) => e !== entry);
      };
    },
    // 나중에 등록한 항목부터 돌려준다.
    list: () => [...entries].reverse(),
  };
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createRegistry);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      for (const { spec, handler, options } of registry.list()) {
        if (options.enabled === false) continue;
        if (!matchesShortcut(event, spec)) continue;
        if (!spec.mod && !options.allowInInput && isEditableTarget(event.target)) continue;
        if (options.whenFocusWithin && !(document.activeElement as Element | null)?.closest(options.whenFocusWithin)) continue;
        const isPalette = spec.mod && spec.key === "k";
        if (!isPalette && !options.allowInOverlay && document.querySelector('[role="dialog"]')) continue;
        event.preventDefault();
        handler(event);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    // 리스너가 달렸다는 표시. e2e 가 하이드레이션을 기다릴 때 쓴다 (고정 대기 없이 단축키가 먹는 시점을 안다).
    document.documentElement.dataset.shortcutsReady = "true";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      delete document.documentElement.dataset.shortcutsReady;
    };
  }, [registry]);

  return <ShortcutContext.Provider value={registry}>{children}</ShortcutContext.Provider>;
}

export function useShortcut(
  shortcut: string,
  handler: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
) {
  const registry = useContext(ShortcutContext);
  if (!registry) throw new Error("useShortcut must be used inside <ShortcutProvider>");

  // 렌더마다 새 함수가 와도 재등록하지 않도록 최신 핸들러는 ref 로 읽는다.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const { enabled = true, allowInInput = false, allowInOverlay = false, whenFocusWithin } = options;
  useEffect(() => {
    return registry.register({
      spec: parseShortcut(shortcut),
      handler: (e) => handlerRef.current(e),
      options: { enabled, allowInInput, allowInOverlay, whenFocusWithin },
    });
  }, [registry, shortcut, enabled, allowInInput, allowInOverlay, whenFocusWithin]);
}

const subscribeNoop = () => () => {};

// macOS, iOS 면 ⌘ 표기, 그 밖은 Ctrl. 서버 렌더는 ⌘ 로 그리고 하이드레이션 뒤에 맞춘다.
export function useIsApple(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    () => true,
  );
}
