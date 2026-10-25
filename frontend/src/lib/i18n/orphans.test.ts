// 사전에만 있고 어디에서도 쓰지 않는 키(고아 키)를 찾는다.
// 키는 t("area.key") 처럼 문자열 그대로 쓰는 것이 원칙이다. 아래 DYNAMIC_FAMILIES 는 템플릿 문자열로 조립해 쓰는 키 묶음이라
// 정적 검사로 못 찾으므로 접두사로 허용한다. 새 동적 키를 만들면 여기에 이유와 함께 적는다.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { en } from "./en";

const SRC = join(__dirname, "..", "..");

// settings.data<Group> 와 settings.data<Group>Desc: SettingsView 의 로컬 데이터 목록이 group.id 로 조립한다.
const DYNAMIC_FAMILIES = ["settings.data"];

function flatKeys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.|i18n[\\/](en|ko)\.ts$/.test(p) ? [p] : [];
  });
}

describe("i18n dictionary", () => {
  it("has no orphan keys", () => {
    const code = sourceFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    const orphans = flatKeys(en).filter(
      (k) => !DYNAMIC_FAMILIES.some((p) => k.startsWith(p)) && !code.includes(`"${k}"`) && !code.includes(`'${k}'`) && !code.includes(`\`${k}\``),
    );
    expect(orphans).toEqual([]);
  });
});
