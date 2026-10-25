"use client";

import { SettingsIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n/client";
import { SETTINGS_ITEM, isActiveRoute, type SidebarKind } from "@/lib/shell/routes";
import { cn } from "@/lib/utils";

import { ServerExplorer } from "./ServerExplorer";

// 사이드바 본문. explorer 는 공용 서버 탐색기를 그리고, slot 은 화면이 SidebarSlot 으로 채울 빈 틀을 둔다.
function SidebarBody({
  kind,
  setTarget,
}: {
  kind: SidebarKind;
  setTarget: (el: HTMLDivElement | null) => void;
}) {
  if (kind === "explorer") return <ServerExplorer />;
  if (kind === "slot") return <div ref={setTarget} className="flex min-h-0 flex-1 flex-col" />;
  return null;
}

interface DesktopSidebarProps {
  kind: SidebarKind;
  visible: boolean;
  setTarget: (el: HTMLDivElement | null) => void;
}

// 데스크톱 사이드바 열 (--side-w). 900px 이하에서는 CSS 로 숨기고 드로어가 대신한다.
export function DesktopSidebar({ kind, visible, setTarget }: DesktopSidebarProps) {
  const t = useT();
  return (
    // 서버 탐색기가 아닌 화면(Chat 의 대화 목록)이 채우는 사이드바는 "서버 탐색기"라고 읽히지 않게 일반 이름을 쓴다.
    <aside
      aria-label={kind === "explorer" ? t("shell.explorer") : t("shell.sidebar")}
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-r border-line bg-background max-[901px]:hidden",
        !visible && "hidden",
      )}
    >
      <SidebarBody kind={kind} setTarget={setTarget} />
    </aside>
  );
}

interface MobileDrawerProps {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: SidebarKind;
  setTarget: (el: HTMLDivElement | null) => void;
  footer?: ReactNode;
}

const SAFE_AREA: CSSProperties = {
  paddingLeft: "env(safe-area-inset-left, 0px)",
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
};

// 모바일 드로어: 왼쪽 시트, 폭 min(320px, 86vw). 닫히면 DOM 에서 빠져 포커스를 받지 못하고,
// 열려 있는 동안 포커스를 가두며 Esc 로 닫으면 메뉴 버튼으로 돌아간다 (base-ui Dialog 동작).
export function MobileDrawer({ id, open, onOpenChange, kind, setTarget }: MobileDrawerProps) {
  const t = useT();
  const pathname = usePathname();
  const settingsActive = isActiveRoute(pathname, SETTINGS_ITEM.href);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id={id}
        side="left"
        showCloseButton={false}
        style={SAFE_AREA}
        className="z-[var(--z-sidebar)] w-[min(320px,86vw)] gap-0 border-r border-line bg-background p-0 data-[side=left]:w-[min(320px,86vw)] data-[side=left]:sm:max-w-none"
      >
        <div className="flex h-12 flex-none items-center gap-1 pr-2 pl-3">
          <SheetTitle className="flex-1 font-heading text-sm font-semibold">{t("shell.menuTitle")}</SheetTitle>
          <SheetDescription className="sr-only">{kind === "explorer" ? t("shell.explorer") : t("shell.sidebar")}</SheetDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={() => onOpenChange(false)}
            aria-label={t("shell.closeMenu")}
          >
            <XIcon aria-hidden className="size-4" />
          </Button>
        </div>

        <SidebarBody kind={kind} setTarget={setTarget} />

        <nav aria-label={t("nav.settings")} className="mt-auto flex-none border-t border-line">
          <Link
            href={SETTINGS_ITEM.href}
            aria-current={settingsActive ? "page" : undefined}
            className="flex h-11 items-center gap-2 px-3 text-sm text-foreground hover:bg-surface-hover aria-[current=page]:bg-sel-row aria-[current=page]:shadow-[inset_2px_0_0_var(--brand)]"
          >
            <SettingsIcon aria-hidden className="size-4 text-fg-muted" />
            {t("nav.settings")}
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
