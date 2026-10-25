import { beforeEach, describe, expect, it } from "vitest";

import { EXPOSED_KEY } from "@/lib/chat/exposure";
import { STORAGE_KEY as CALL_STATS_KEY } from "@/lib/inspector/call-stats";
import { STORAGE_KEY as GETTING_STARTED_KEY } from "@/lib/onboarding/getting-started";
import { RUNTIME_STORAGE_KEY } from "@/lib/runtime/storage";

import {
  LAYOUT_PREFIX,
  LOCAL_DATA_GROUPS,
  clearLocalData,
  countLocalData,
  keyMatchesGroup,
} from "./local-data";
import { RECENT_CALLS_KEY, SETTINGS_KEY } from "./settings";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function seed() {
  localStorage.setItem(SETTINGS_KEY, "{}");
  localStorage.setItem(RECENT_CALLS_KEY, "[]");
  localStorage.setItem(GETTING_STARTED_KEY, "{}");
  localStorage.setItem(`${LAYOUT_PREFIX}mcpc-inspector-panes-wide:a:b`, "{}");
  localStorage.setItem(`${LAYOUT_PREFIX}mcpc-chat-panes-mid:a:b`, "{}");
  localStorage.setItem("mcpc-inspector-dock-h-desktop", "300");
  localStorage.setItem(EXPOSED_KEY, "[]");
  sessionStorage.setItem(CALL_STATS_KEY, "[]");
  sessionStorage.setItem("mcpc-tools-cache:starter-mcp", "{}");
  sessionStorage.setItem(RUNTIME_STORAGE_KEY, "{}");
  // 이 앱의 것이 아니거나 초기화 대상이 아닌 값
  localStorage.setItem("mcpc-theme", "dark");
  localStorage.setItem("other-app", "keep");
}

describe("LOCAL_DATA_GROUPS", () => {
  it("그룹 id 가 겹치지 않는다", () => {
    const ids = LOCAL_DATA_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("테마 키와 모르는 키는 어느 그룹에도 속하지 않는다", () => {
    for (const key of ["mcpc-theme", "other-app", "mcpc-lang"]) {
      expect(LOCAL_DATA_GROUPS.some((g) => keyMatchesGroup(g, key))).toBe(false);
    }
  });
});

describe("countLocalData", () => {
  it("그룹별 개수를 센다", () => {
    seed();
    expect(countLocalData(localStorage, sessionStorage)).toEqual({
      settings: 2,
      gettingStarted: 1,
      layout: 3,
      chatServers: 1,
      sessionCache: 2,
      runtimeServers: 1,
    });
  });

  it("저장소가 비었거나 막혀 있으면 0", () => {
    expect(Object.values(countLocalData(localStorage, sessionStorage)).every((n) => n === 0)).toBe(true);
    expect(Object.values(countLocalData(null, null)).every((n) => n === 0)).toBe(true);
  });
});

describe("clearLocalData", () => {
  it("목록의 항목만 지우고 개수를 돌려준다", () => {
    seed();
    expect(clearLocalData(localStorage, sessionStorage)).toBe(10);
    expect(localStorage.getItem("mcpc-theme")).toBe("dark");
    expect(localStorage.getItem("other-app")).toBe("keep");
    expect(localStorage.length).toBe(2);
    expect(sessionStorage.length).toBe(0);
  });

  it("지운 뒤 다시 지우면 0", () => {
    seed();
    clearLocalData(localStorage, sessionStorage);
    expect(clearLocalData(localStorage, sessionStorage)).toBe(0);
  });

  it("저장소가 null 이어도 던지지 않는다", () => {
    expect(clearLocalData(null, null)).toBe(0);
  });
});
