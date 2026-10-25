"use client";

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface SectionNavItem {
  id: string;
  label: string;
}

// 페이지 안 섹션 목록(앵커). 901px 이상에서는 왼쪽에 붙는 세로 목록, 그 아래에서는 위에 붙는 가로 칩 줄이다.
// 지금 보이는 섹션을 aria-current 로 표시한다.
export function SectionNav({ items }: { items: SectionNavItem[] }) {
  const t = useT();
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const targets = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    // 화면 위쪽 1/3 지점을 지나는 섹션을 현재 섹션으로 본다.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(visible[0]!.target.id);
      },
      { rootMargin: "-10% 0px -65% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label={t("settings.sectionNav")}
      className={cn(
        // 모바일: 위에 붙는 가로 스크롤 칩 줄
        "sticky top-0 z-20 -mx-4 overflow-x-auto border-b border-line bg-background px-4 py-2",
        // 데스크톱: 왼쪽에 붙는 세로 목록
        "min-[901px]:top-6 min-[901px]:z-auto min-[901px]:mx-0 min-[901px]:self-start min-[901px]:overflow-visible min-[901px]:border-b-0 min-[901px]:bg-transparent min-[901px]:p-0",
      )}
    >
      <ul className="flex gap-1.5 min-[901px]:flex-col min-[901px]:gap-0.5">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id} className="flex-none">
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex h-8 items-center rounded-md border px-2.5 text-xs whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  "min-[901px]:h-7 min-[901px]:border-transparent min-[901px]:border-l-2 min-[901px]:rounded-none min-[901px]:rounded-r-md",
                  current
                    ? "border-brand-border bg-brand-subtle font-medium text-brand-text min-[901px]:border-l-brand"
                    : "border-line text-fg-muted hover:bg-surface-hover hover:text-foreground min-[901px]:border-transparent",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
