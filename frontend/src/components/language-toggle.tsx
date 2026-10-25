"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLocale, type Locale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

const OPTIONS: ReadonlyArray<{ value: Locale; label: string; name: string }> = [
  { value: "en", label: "EN", name: "English" },
  { value: "ko", label: "KO", name: "한국어" },
];

// 언어 쿠키를 바꾸고 서버 컴포넌트를 새 사전으로 다시 그린다. 토글과 명령 팔레트가 함께 쓴다.
export function useSetLanguage() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLanguage(next: Locale) {
    if (next === t.locale) return;
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = next;
    // 서버 컴포넌트를 새 쿠키로 다시 그려 사전을 교체한다.
    startTransition(() => router.refresh());
  }

  return { setLanguage, pending };
}

// EN / KO 세그먼트. ThemeToggle 과 같은 ToggleGroup 스타일이며 타이틀바에 놓인다.
export function LanguageToggle() {
  const t = useT();
  const { setLanguage: select, pending } = useSetLanguage();

  return (
    <ToggleGroup
      aria-label={t("nav.language")}
      role="toolbar"
      variant="outline"
      size="sm"
      spacing={0}
      value={[t.locale]}
      disabled={pending}
      onValueChange={(next) => {
        // 눌린 버튼을 다시 눌러도 선택이 해제되지 않게 빈 배열은 무시한다.
        const value = next[0];
        if (isLocale(value)) select(value);
      }}
    >
      {OPTIONS.map(({ value, label, name }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={name}
          title={name}
          className="px-2 text-xs font-medium"
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
