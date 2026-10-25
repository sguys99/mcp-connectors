"use client";

import { MenuIcon, PlugIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useT } from "@/lib/i18n/client";
import { ALL_ITEMS, navIdFor } from "@/lib/shell/routes";
import { shortcutLabel } from "@/lib/shell/shortcuts";

import { useSelectedServer, useShell, useShellMetaValue } from "./shell-context";
import { useIsApple } from "./shortcuts";

// 레지스트리 파일 경로는 번역하지 않는 리터럴이다.
const REGISTRY_PATH = "configs/mcp_servers.yaml";

interface TitleBarProps {
  drawerOpen: boolean;
  drawerId: string;
  onMenu: () => void;
}

// 타이틀바 (40px, 모바일 48px). 메뉴 버튼(모바일), 브랜드, 브레드크럼, 팔레트 버튼, 언어와 테마 토글.
export function TitleBar({ drawerOpen, drawerId, onMenu }: TitleBarProps) {
  const t = useT();
  const pathname = usePathname();
  const { setPaletteOpen } = useShell();
  const meta = useShellMetaValue();
  const selected = useSelectedServer();
  const apple = useIsApple();
  const paletteKeys = shortcutLabel("mod+k", apple).join(apple ? "" : " ");

  const id = navIdFor(pathname);
  const item = ALL_ITEMS.find((i) => i.id === id);
  const screen = item ? t(item.labelKey) : t("nav.brand");
  const tail =
    meta.crumb !== undefined && meta.crumb !== null
      ? meta.crumb
      : id === "inspector" || id === "chat"
        ? selected
        : id === "dashboard"
          ? REGISTRY_PATH
          : null;

  return (
    <header className="flex min-w-0 items-center gap-3 bg-bg-subtle pr-(--gutter-r) pl-(--gutter-l) max-[901px]:gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="-ml-2 hidden size-9 max-[901px]:inline-flex"
        aria-label={t("shell.openMenu")}
        aria-expanded={drawerOpen}
        aria-controls={drawerId}
        aria-haspopup="dialog"
        onClick={onMenu}
      >
        <MenuIcon aria-hidden className="size-5" />
      </Button>

      <Link
        href="/"
        className="flex min-h-6 min-w-6 flex-none items-center gap-2 rounded-sm font-heading text-sm font-semibold tracking-[var(--tracking-tight)] max-[421px]:hidden"
      >
        <span
          aria-hidden
          className="grid size-[22px] place-items-center rounded-sm bg-brand text-brand-fg"
        >
          <PlugIcon className="size-3.5" strokeWidth={2} />
        </span>
        <span className="max-[901px]:sr-only">{t("nav.brand")}</span>
      </Link>

      {/* 모바일: 화면 제목. 데스크톱: 브레드크럼 */}
      <span className="hidden min-w-0 flex-1 truncate font-heading text-sm font-semibold max-[901px]:block">
        {screen}
      </span>
      <nav
        aria-label={t("shell.location")}
        className="min-w-0 max-[901px]:hidden"
      >
        <ol className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-fg-muted">
          <li className="flex-none">
            {item ? (
              <Link href={item.href} className="rounded-xs hover:text-foreground">
                {screen}
              </Link>
            ) : (
              screen
            )}
          </li>
          {tail && (
            <>
              <li aria-hidden className="flex-none">
                /
              </li>
              <li className="min-w-0 truncate font-medium text-foreground" aria-current="page">
                {tail}
              </li>
            </>
          )}
        </ol>
      </nav>

      <button
        type="button"
        aria-haspopup="dialog"
        // 보이는 글자(안내와 단축키)를 그대로 이름으로 쓴다 (WCAG 2.5.3 Label in Name, 음성 입력으로 보이는 말을 해도 눌린다).
        // 좁은 폭에서 글자가 숨어도 같은 이름이 남는다.
        aria-label={`${t("shell.paletteHint")} ${paletteKeys}`}
        onClick={() => setPaletteOpen(true)}
        className="mx-auto flex h-[26px] w-[min(380px,100%)] min-w-0 items-center gap-2 rounded-sm border border-line bg-background pr-1.5 pl-2 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-foreground max-[901px]:mx-0 max-[901px]:size-[34px] max-[901px]:w-[34px] max-[901px]:flex-none max-[901px]:justify-center max-[901px]:p-0"
      >
        <SearchIcon aria-hidden className="size-3.5 flex-none" />
        <span className="min-w-0 flex-1 truncate text-left max-[901px]:hidden">{t("shell.paletteHint")}</span>
        <Kbd className="flex-none max-[901px]:hidden">{paletteKeys}</Kbd>
      </button>

      <div className="flex flex-none items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
