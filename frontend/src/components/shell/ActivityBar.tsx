"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n/client";
import { SETTINGS_ITEM, VIEW_ITEMS, isActiveRoute, type NavItem } from "@/lib/shell/routes";
import { shortcutLabel } from "@/lib/shell/shortcuts";
import { cn } from "@/lib/utils";

import { useHealthSummary } from "./health-store";
import { NAV_ICONS } from "./nav-icons";
import { useShell } from "./shell-context";
import { useIsApple } from "./shortcuts";

const BUTTON_CLASS =
  "relative grid h-[42px] w-11 place-items-center text-fg-subtle transition-colors hover:text-foreground focus-visible:outline-offset-[-2px] aria-[current=page]:text-foreground aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-[9px] aria-[current=page]:before:left-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-r-xs aria-[current=page]:before:bg-brand";

// 활동 바 (44px). 화면 이동 아이콘, 오프라인 수 배지, 팔레트 버튼, 맨 아래 설정 톱니.
// 900px 이하에서는 숨기고 하단 탭바가 대신한다.
export function ActivityBar() {
  const t = useT();
  const pathname = usePathname();
  const { setPaletteOpen } = useShell();
  const apple = useIsApple();
  const { offline } = useHealthSummary();

  return (
    <nav
      aria-label={t("shell.views")}
      className="flex flex-col items-center gap-0.5 border-r border-line bg-background py-1 max-[901px]:hidden"
    >
      {VIEW_ITEMS.map((item) => (
        <ActivityLink
          key={item.id}
          item={item}
          active={isActiveRoute(pathname, item.href)}
          badge={
            item.id === "dashboard" && offline > 0 ? (
              <>
                <span
                  aria-hidden
                  className="absolute top-[7px] right-2 h-3.5 min-w-3.5 rounded-full bg-warning-solid px-[3px] text-center font-mono text-[9px] leading-3.5 font-bold text-warning-solid-fg"
                >
                  {offline}
                </span>
                <span className="sr-only">{t("shell.offlineBadge", { n: offline })}</span>
              </>
            ) : null
          }
        />
      ))}

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPaletteOpen(true)}
              className={BUTTON_CLASS}
            />
          }
        >
          <SearchIcon aria-hidden className="size-5" />
          <span className="sr-only">{t("shell.openPalette")}</span>
        </TooltipTrigger>
        <TooltipContent side="right">
          {t("shell.openPalette")}
          <Kbd>{shortcutLabel("mod+k", apple).join(apple ? "" : " ")}</Kbd>
        </TooltipContent>
      </Tooltip>

      <ActivityLink item={SETTINGS_ITEM} active={isActiveRoute(pathname, SETTINGS_ITEM.href)} />
    </nav>
  );
}

function ActivityLink({
  item,
  active,
  badge,
}: {
  item: NavItem;
  active: boolean;
  badge?: ReactNode;
}) {
  const t = useT();
  const Icon = NAV_ICONS[item.id];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(BUTTON_CLASS)}
          />
        }
      >
        <Icon aria-hidden className="size-5" />
        <span className="sr-only">{t(item.labelKey)}</span>
        {badge}
      </TooltipTrigger>
      <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
    </Tooltip>
  );
}
