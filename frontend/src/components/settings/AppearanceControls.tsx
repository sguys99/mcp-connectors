"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { useSetLanguage } from "@/components/language-toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isLocale, type Locale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

const THEMES = [
  { value: "light", labelKey: "nav.themeLight", Icon: SunIcon },
  { value: "dark", labelKey: "nav.themeDark", Icon: MoonIcon },
  { value: "system", labelKey: "nav.themeSystem", Icon: MonitorIcon },
] as const;

const LANGUAGES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
];

const subscribe = () => () => {};
const itemClass = "gap-1.5 px-3 text-xs";

// 타이틀바의 토글과 같은 동작이지만 글자가 보이는 형태다 (모바일에서도 찾기 쉽게 설정 화면에 둔다).
export function ThemeControl({ labelledBy }: { labelledBy: string }) {
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
      aria-labelledby={labelledBy}
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
      {THEMES.map(({ value, labelKey, Icon }) => (
        <ToggleGroupItem key={value} value={value} className={itemClass}>
          <Icon className="size-3.5" />
          {t(labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function LanguageControl({ labelledBy }: { labelledBy: string }) {
  const t = useT();
  const { setLanguage, pending } = useSetLanguage();

  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      role="toolbar"
      variant="outline"
      size="sm"
      spacing={0}
      value={[t.locale]}
      disabled={pending}
      onValueChange={(next) => {
        const value = next[0];
        if (isLocale(value)) setLanguage(value);
      }}
    >
      {LANGUAGES.map(({ value, label }) => (
        <ToggleGroupItem key={value} value={value} lang={value} className={itemClass}>
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
