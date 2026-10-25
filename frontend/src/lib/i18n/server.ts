import "server-only";

import { cookies } from "next/headers";

import { DICTIONARIES, createTranslator, LANG_COOKIE, resolveLocale } from "./index";

// 요청의 mcpc-lang 쿠키에서 언어를 읽는다. 없으면 영어.
export async function getLocale() {
  const store = await cookies();
  return resolveLocale(store.get(LANG_COOKIE)?.value);
}

// 서버 컴포넌트용. { t, locale, dictionary } 를 돌려준다.
export async function getI18n() {
  const locale = await getLocale();
  const dictionary = DICTIONARIES[locale];
  return { locale, dictionary, t: createTranslator(dictionary, locale) };
}

export async function getT() {
  return (await getI18n()).t;
}
