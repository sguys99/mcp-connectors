"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/lib/i18n/client";

const OPTIONS = [
  { value: "light", labelKey: "nav.themeLight", Icon: SunIcon },
  { value: "dark", labelKey: "nav.themeDark", Icon: MoonIcon },
  { value: "system", labelKey: "nav.themeSystem", Icon: MonitorIcon },
] as const;

const subscribe = () => () => {};

// Light / Dark / System 세그먼트. 타이틀바(P4-3)에 놓을 재사용 컴포넌트.
export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  // 마운트 전에는 눌림 표시를 하지 않아 하이드레이션 불일치를 막는다.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <ToggleGroup
      aria-label={t("nav.theme")}
      role="toolbar"
      variant="outline"
      size="sm"
      spacing={0}
      value={mounted && theme ? [theme] : []}
      onValueChange={(next) => {
        // 눌린 버튼을 다시 눌러도 선택이 해제되지 않게 빈 배열은 무시한다.
        if (next[0]) setTheme(next[0]);
      }}
    >
      {OPTIONS.map(({ value, labelKey, Icon }) => (
        <ToggleGroupItem key={value} value={value} aria-label={t(labelKey)} title={t(labelKey)}>
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
