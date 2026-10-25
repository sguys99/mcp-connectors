"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Dictionary } from "./en";
import type { Locale } from "./locales";
import { createTranslator, type Translator } from "./translate";

const I18nContext = createContext<Translator | null>(null);

interface I18nProviderProps {
  locale: Locale;
  // 서버에서 고른 언어의 사전. 언어가 바뀌면 layout 이 새 사전을 내려준다.
  dictionary: Dictionary;
  children: ReactNode;
}

export function I18nProvider({ locale, dictionary, children }: I18nProviderProps) {
  const t = useMemo(() => createTranslator(dictionary, locale), [dictionary, locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT must be used inside <I18nProvider>");
  return t;
}

export function useLocale(): Locale {
  return useT().locale;
}
