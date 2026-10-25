"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/lib/i18n/client";
import { VIEW_ITEMS, isActiveRoute } from "@/lib/shell/routes";

import { NAV_ICONS } from "./nav-icons";

// 모바일(900px 이하) 하단 탭바. 56px, 활성 탭 위에 브랜드 막대.
export function MobileTabBar() {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("shell.views")}
      className="hidden grid-cols-3 items-stretch border-t border-line bg-bg-subtle pr-(--gutter-r) pl-(--gutter-l) max-[901px]:grid"
    >
      {VIEW_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.id];
        const active = isActiveRoute(pathname, item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="relative grid min-h-11 content-center justify-items-center gap-0.5 font-mono text-2xs text-fg-muted transition-colors focus-visible:outline-offset-[-2px] aria-[current=page]:text-brand-text aria-[current=page]:before:absolute aria-[current=page]:before:-top-px aria-[current=page]:before:right-[30%] aria-[current=page]:before:left-[30%] aria-[current=page]:before:h-0.5 aria-[current=page]:before:rounded-b-xs aria-[current=page]:before:bg-brand"
          >
            <Icon aria-hidden className="size-5" />
            <span>{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
