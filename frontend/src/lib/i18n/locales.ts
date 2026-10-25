// 지원 언어와 쿠키 규약. 서버/클라이언트 양쪽에서 쓰므로 server-only 의존을 두지 않는다.

export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// 선택한 언어를 담는 쿠키 이름. 서버 컴포넌트가 첫 렌더부터 읽어 깜빡임을 없앤다.
export const LANG_COOKIE = "mcpc-lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// 쿠키 값이 없거나 알 수 없으면 영어로 되돌린다 (Accept-Language 는 보지 않는다).
export function resolveLocale(cookieValue: string | null | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}
