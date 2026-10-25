"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes 래퍼. .dark 클래스를 <html> 에 붙이고 선택값은 mcpc-theme 키로 저장한다.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="mcpc-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
