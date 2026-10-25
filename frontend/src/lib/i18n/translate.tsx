// 사전 조회, {name} 보간, 단순 복수형, 리치 텍스트(ReactNode 치환)를 담당하는 순수 모듈.
// 서버 컴포넌트와 클라이언트 컴포넌트가 같은 구현을 공유한다.

import { Fragment, type ReactNode } from "react";

import { en, type Dictionary } from "./en";
import type { Locale } from "./locales";

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

// "area.key" 형태의 점 경로. 오타는 컴파일 에러가 된다.
export type TKey = Paths<Dictionary>;

export type TVars = Record<string, string | number>;
export type TRichVars = Record<string, ReactNode>;

export interface Translator {
  locale: Locale;
  (key: TKey, vars?: TVars): string;
  // {name} 자리에 ReactNode(링크, code 등)를 끼워 넣는다.
  rich: (key: TKey, vars: TRichVars) => ReactNode;
}

function lookup(dict: Dictionary, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

// {name} 단순 치환, {n|단수형|복수형} 은 n === 1 일 때 단수형을 고른다 (한국어는 쓰지 않는다).
const TOKEN = /\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g;

export function interpolate(template: string, vars: TVars = {}): string {
  return template.replace(TOKEN, (whole, name: string, one?: string, other?: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    if (one !== undefined && other !== undefined) return Number(value) === 1 ? one : other;
    return String(value);
  });
}

// 템플릿에서 플레이스홀더 이름 집합을 뽑는다 (테스트와 점검용).
export function placeholderNames(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN)].map((m) => m[1]!))].sort();
}

function renderRich(template: string, vars: TRichVars): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const m of template.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(template.slice(last, at));
    const value = vars[m[1]!];
    parts.push(<Fragment key={index++}>{value ?? m[0]}</Fragment>);
    last = at + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.map((p, i) => (typeof p === "string" ? <Fragment key={`s${i}`}>{p}</Fragment> : p));
}

export function createTranslator(dict: Dictionary, locale: Locale): Translator {
  const resolve = (key: string): string => lookup(dict, key) ?? lookup(en, key) ?? key;
  const t = ((key: TKey, vars?: TVars) => interpolate(resolve(key), vars)) as Translator;
  t.locale = locale;
  t.rich = (key, vars) => renderRich(resolve(key), vars);
  return t;
}
