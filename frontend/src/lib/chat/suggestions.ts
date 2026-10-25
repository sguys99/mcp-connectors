// 빈 대화에 보일 질문 제안. 노출된 서버에 맞는 것만 고른다 (이름에 키워드가 들어 있는 서버).
// 문구는 i18n 사전에 있고 여기서는 키만 다룬다. 날짜는 샘플 DB(Pagila)의 실제 대여 기간(2022-02 ~ 2022-08)에 맞췄다.

import type { TKey } from "@/lib/i18n/translate";

interface SuggestionGroup {
  match: RegExp;
  keys: readonly TKey[];
}

const GROUPS: readonly SuggestionGroup[] = [
  { match: /nl2sql/i, keys: ["chat.sugFilmsJuly", "chat.sugPaymentTables", "chat.sugFilmColumns"] },
  { match: /repo/i, keys: ["chat.sugRepos"] },
  { match: /starter/i, keys: ["chat.sugAdd"] },
];

export const MAX_SUGGESTIONS = 4;

export function suggestionKeys(serverNames: readonly string[], limit: number = MAX_SUGGESTIONS): TKey[] {
  const out: TKey[] = [];
  for (const group of GROUPS) {
    if (!serverNames.some((name) => group.match.test(name))) continue;
    for (const key of group.keys) if (!out.includes(key)) out.push(key);
  }
  return out.slice(0, limit);
}
