// 전역 단축키 매처. "mod+k", "mod+enter", "escape", "/" 같은 문자열을 해석해 키 이벤트와 비교한다.
// mod 는 macOS 의 ⌘ 과 그 밖 환경의 Ctrl 을 모두 받는다.

export interface ShortcutSpec {
  key: string; // 소문자. 예: "k", "enter", "escape", "/"
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

// 매칭에 필요한 필드만 뽑은 이벤트 모양 (KeyboardEvent 와 테스트 객체가 모두 만족).
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
};

export function parseShortcut(input: string): ShortcutSpec {
  const parts = input
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const spec: ShortcutSpec = { key: "", mod: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === "mod" || part === "cmd" || part === "ctrl" || part === "meta") spec.mod = true;
    else if (part === "shift") spec.shift = true;
    else if (part === "alt" || part === "option") spec.alt = true;
    else spec.key = ALIASES[part] ?? part;
  }
  if (!spec.key) throw new Error(`Invalid shortcut: '${input}'`);
  return spec;
}

export function matchesShortcut(event: KeyEventLike, spec: ShortcutSpec | string): boolean {
  const s = typeof spec === "string" ? parseShortcut(spec) : spec;
  const hasMod = event.metaKey || event.ctrlKey;
  if (s.mod !== hasMod) return false;
  if (s.alt !== event.altKey) return false;
  // "?" 처럼 Shift 가 있어야 입력되는 문자는 shift 를 따지지 않는다.
  const shiftFree = s.key.length === 1 && !/[a-z0-9]/.test(s.key);
  if (!shiftFree && s.shift !== event.shiftKey) return false;
  return event.key.toLowerCase() === s.key;
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
}

// 글자를 입력하는 요소인지. 수식 키 없는 단축키(/ 등)는 여기서 무시한다.
export function isEditableTarget(target: unknown): boolean {
  const el = target as ElementLike | null;
  if (!el || typeof el !== "object") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// 화면에 보일 단축키 문구. 예: ["⌘", "K"] 또는 ["Ctrl", "K"].
export function shortcutLabel(input: string, apple: boolean): string[] {
  const s = parseShortcut(input);
  const out: string[] = [];
  if (s.mod) out.push(apple ? "⌘" : "Ctrl");
  if (s.alt) out.push(apple ? "⌥" : "Alt");
  if (s.shift) out.push(apple ? "⇧" : "Shift");
  const names: Record<string, string> = { enter: "↵", escape: "Esc", " ": "Space" };
  out.push(names[s.key] ?? s.key.toUpperCase());
  return out;
}
