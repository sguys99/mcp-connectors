// 서버/클라이언트 공용 진입점. 서버 전용은 "@/lib/i18n/server", 클라이언트 훅은 "@/lib/i18n/client".
import { en, type Dictionary } from "./en";
import { ko } from "./ko";
import type { Locale } from "./locales";

export { DEFAULT_LOCALE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, LOCALES, isLocale, resolveLocale } from "./locales";
export type { Locale } from "./locales";
export type { Dictionary } from "./en";
export { createTranslator, interpolate, placeholderNames } from "./translate";
export type { TKey, Translator } from "./translate";

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ko };
