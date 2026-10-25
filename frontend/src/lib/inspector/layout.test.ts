import { describe, expect, it } from "vitest";

import {
  BAND_DEFAULTS,
  bandFromMatches,
  clampDockHeight,
  DOCK_HEIGHT_KEYS,
  DOCK_MIN_PX,
  DOCK_OPEN_KEYS,
  DOCK_PAGE_STEP_PX,
  DOCK_PANES_MIN_PX,
  DOCK_STEP_PX,
  DOCK_STORAGE_PREFIX,
  dockHeightForKey,
  panesStorageKey,
  parseDockHeight,
  parseDockOpen,
} from "./layout";

describe("bandFromMatches", () => {
  it("picks the narrowest matching band", () => {
    expect(bandFromMatches({ mobile: true, narrow: true, mid: true })).toBe("mobile");
    expect(bandFromMatches({ mobile: false, narrow: true, mid: true })).toBe("narrow");
    expect(bandFromMatches({ mobile: false, narrow: false, mid: true })).toBe("mid");
    expect(bandFromMatches({ mobile: false, narrow: false, mid: false })).toBe("wide");
  });
});

describe("band defaults", () => {
  it("follows the global layout variables", () => {
    expect(BAND_DEFAULTS.wide.toolsPx).toBe(264);
    expect(BAND_DEFAULTS.mid.toolsPx).toBe(250);
    expect(BAND_DEFAULTS.narrow.request / BAND_DEFAULTS.narrow.response).toBeCloseTo(1.06 / 0.94);
  });

  it("stores each band under its own key", () => {
    expect(panesStorageKey("wide")).not.toBe(panesStorageKey("narrow"));
  });
});

import { defaultSizes } from "./layout";

describe("defaultSizes", () => {
  it("sums to 100 and keeps the tools panel at its pixel width", () => {
    const s = defaultSizes(BAND_DEFAULTS.wide, 1112);
    const num = (v: string) => Number.parseFloat(v);
    expect(num(s.tools) + num(s.request) + num(s.response)).toBeCloseTo(100, 2);
    expect((num(s.tools) / 100) * 1112).toBeCloseTo(264, 0);
    expect(num(s.request)).toBeCloseTo(num(s.response), 2);
  });

  it("splits the rest by the band ratio", () => {
    const s = defaultSizes(BAND_DEFAULTS.narrow, 800);
    expect(Number.parseFloat(s.request) / Number.parseFloat(s.response)).toBeCloseTo(1.06 / 0.94, 2);
  });
});

describe("dock height", () => {
  it("clamps between the minimum and the container minus the panes reserve", () => {
    expect(clampDockHeight(10, 800)).toBe(DOCK_MIN_PX);
    expect(clampDockHeight(300.4, 800)).toBe(300);
    expect(clampDockHeight(9999, 800)).toBe(800 - DOCK_PANES_MIN_PX);
    // 아주 낮은 창에서도 최소 높이는 지킨다
    expect(clampDockHeight(500, 200)).toBe(DOCK_MIN_PX);
  });

  it("parses stored heights and open state with per-mode defaults", () => {
    expect(parseDockHeight(null)).toBeNull();
    expect(parseDockHeight("abc")).toBeNull();
    expect(parseDockHeight("20")).toBeNull();
    expect(parseDockHeight("240.6")).toBe(241);
    expect(parseDockOpen(null, "desktop")).toBe(true);
    expect(parseDockOpen(null, "mobile")).toBe(false);
    expect(parseDockOpen("open", "mobile")).toBe(true);
    expect(parseDockOpen("closed", "desktop")).toBe(false);
  });

  it("maps keys to heights (ArrowUp grows the panel)", () => {
    expect(dockHeightForKey("ArrowUp", 216, 800)).toBe(216 + DOCK_STEP_PX);
    expect(dockHeightForKey("ArrowDown", 216, 800)).toBe(216 - DOCK_STEP_PX);
    expect(dockHeightForKey("PageUp", 216, 800)).toBe(216 + DOCK_PAGE_STEP_PX);
    expect(dockHeightForKey("PageDown", 100, 800)).toBe(DOCK_MIN_PX);
    expect(dockHeightForKey("Home", 400, 800)).toBe(DOCK_MIN_PX);
    expect(dockHeightForKey("End", 216, 800)).toBe(800 - DOCK_PANES_MIN_PX);
    expect(dockHeightForKey("Enter", 216, 800)).toBeNull();
  });

  it("keeps the dock keys under one prefix (Settings local data counts them as layout)", () => {
    for (const key of [...Object.values(DOCK_OPEN_KEYS), ...Object.values(DOCK_HEIGHT_KEYS)]) {
      expect(key.startsWith(DOCK_STORAGE_PREFIX)).toBe(true);
    }
  });
});
