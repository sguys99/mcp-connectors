// 앱 셸의 라우트 규칙: 내비게이션 항목, 활성 상태 판정, 화면별 사이드바 종류.
// React 에 의존하지 않는 순수 모듈이라 서버, 클라이언트, 테스트가 함께 쓴다.

import type { TKey } from "@/lib/i18n";

export type NavId = "dashboard" | "inspector" | "chat" | "settings";

export interface NavItem {
  id: NavId;
  href: string;
  labelKey: TKey;
}

// 활동 바와 모바일 탭바에 놓이는 화면. Settings 는 활동 바 맨 아래 톱니로 따로 둔다.
export const VIEW_ITEMS: readonly NavItem[] = [
  { id: "dashboard", href: "/", labelKey: "nav.dashboard" },
  { id: "inspector", href: "/inspector", labelKey: "nav.inspector" },
  { id: "chat", href: "/chat", labelKey: "nav.chat" },
];

export const SETTINGS_ITEM: NavItem = { id: "settings", href: "/settings", labelKey: "nav.settings" };

export const ALL_ITEMS: readonly NavItem[] = [...VIEW_ITEMS, SETTINGS_ITEM];

// "/" 는 정확히 일치할 때만, 나머지는 하위 경로(/chat/abc)까지 활성으로 본다.
export function isActiveRoute(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function navIdFor(pathname: string | null | undefined): NavId | null {
  return ALL_ITEMS.find((item) => isActiveRoute(pathname, item.href))?.id ?? null;
}

// explorer: 공용 서버 탐색기, slot: 화면이 SidebarSlot 으로 채움(비어 있으면 숨김), none: 사이드바 없음.
export type SidebarKind = "explorer" | "slot" | "none";

export function sidebarKindFor(pathname: string | null | undefined): SidebarKind {
  switch (navIdFor(pathname)) {
    case "dashboard":
    case "inspector":
      return "explorer";
    case "chat":
      return "slot";
    default:
      return "none";
  }
}

// ?server= 를 읽고 쓰는 화면.
export function usesServerParam(pathname: string | null | undefined): boolean {
  const id = navIdFor(pathname);
  return id === "inspector" || id === "chat";
}
