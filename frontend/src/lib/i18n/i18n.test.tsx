import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DICTIONARIES, createTranslator, interpolate, placeholderNames, resolveLocale } from "./index";
import { en } from "./en";
import { ko } from "./ko";

// 사전을 {"a.b": "값"} 형태의 평면 맵으로 펼친다.
function flatten(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

const flatEn = flatten(en);
const flatKo = flatten(ko);

describe("dictionary parity", () => {
  it("en 과 ko 의 키 집합이 같다", () => {
    expect(Object.keys(flatKo).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it.each(Object.entries(DICTIONARIES))("%s 사전에 빈 값이 없다", (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(dict))) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("ko 값에 줄표(—)와 가운뎃점(·)이 없다", () => {
    for (const [key, value] of Object.entries(flatKo)) {
      expect(value as string, key).not.toMatch(/[—·]/);
    }
  });

  it("en 과 ko 의 플레이스홀더 이름이 같다", () => {
    for (const key of Object.keys(flatEn)) {
      expect(placeholderNames(flatKo[key] as string), key).toEqual(
        placeholderNames(flatEn[key] as string),
      );
    }
  });
});

describe("resolveLocale", () => {
  it("유효한 쿠키 값을 그대로 쓴다", () => {
    expect(resolveLocale("ko")).toBe("ko");
    expect(resolveLocale("en")).toBe("en");
  });

  it("없거나 알 수 없는 값은 en 으로 되돌린다", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("KO")).toBe("en");
  });
});

describe("translator", () => {
  it("{name} 을 치환하고 없는 변수는 그대로 둔다", () => {
    expect(interpolate("Hi {name}, {other}", { name: "A" })).toBe("Hi A, {other}");
  });

  it("{n|단수|복수} 로 단순 복수형을 고른다", () => {
    const t = createTranslator(en, "en");
    expect(t("chat.toolsSummary", { n: 1, s: 1 })).toBe("1 tool from 1 server");
    expect(t("chat.toolsSummary", { n: 3, s: 2 })).toBe("3 tools from 2 servers");
    expect(createTranslator(ko, "ko")("chat.toolsSummary", { n: 3, s: 2 })).toBe("서버 2개, 도구 3개");
  });

  it("rich 는 ReactNode 를 플레이스홀더 자리에 끼운다", () => {
    const t = createTranslator(en, "en");
    const html = renderToStaticMarkup(
      <p>{t.rich("chat.apiKeyMissingHint", { link: <a href="/settings">/settings</a> })}</p>,
    );
    expect(html).toBe('<p>Enter it in <a href="/settings">/settings</a>.</p>');
  });

  it("없는 키는 키 문자열을 돌려준다", () => {
    const t = createTranslator(ko, "ko");
    expect(t("nope.missing" as never)).toBe("nope.missing");
  });
});
