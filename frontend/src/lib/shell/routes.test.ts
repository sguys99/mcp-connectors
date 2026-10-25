import { describe, expect, it } from "vitest";

import { isActiveRoute, navIdFor, sidebarKindFor, usesServerParam } from "./routes";

describe("isActiveRoute", () => {
  it("루트는 정확히 일치할 때만 활성이다", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/inspector", "/")).toBe(false);
  });

  it("하위 경로도 활성으로 본다", () => {
    expect(isActiveRoute("/inspector", "/inspector")).toBe(true);
    expect(isActiveRoute("/chat/abc", "/chat")).toBe(true);
  });

  it("접두어만 같은 경로는 활성이 아니다", () => {
    expect(isActiveRoute("/chatter", "/chat")).toBe(false);
  });

  it("경로가 없으면 비활성이다", () => {
    expect(isActiveRoute(null, "/")).toBe(false);
    expect(isActiveRoute(undefined, "/chat")).toBe(false);
  });
});

describe("navIdFor, sidebarKindFor", () => {
  it("경로에서 화면 id 를 찾는다", () => {
    expect(navIdFor("/")).toBe("dashboard");
    expect(navIdFor("/settings")).toBe("settings");
    expect(navIdFor("/nope")).toBeNull();
  });

  it("화면별 사이드바 종류를 정한다", () => {
    expect(sidebarKindFor("/")).toBe("explorer");
    expect(sidebarKindFor("/inspector")).toBe("explorer");
    expect(sidebarKindFor("/chat")).toBe("slot");
    expect(sidebarKindFor("/settings")).toBe("none");
    expect(sidebarKindFor("/nope")).toBe("none");
  });

  it("?server= 를 쓰는 화면은 Inspector 와 Chat 이다", () => {
    expect(usesServerParam("/inspector")).toBe(true);
    expect(usesServerParam("/chat")).toBe(true);
    expect(usesServerParam("/")).toBe(false);
  });
});
