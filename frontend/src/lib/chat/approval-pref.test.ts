import { beforeEach, describe, expect, it } from "vitest";

import { APPROVAL_PREF_KEY, loadApprovalPref, saveApprovalPref, stricterApproval } from "./approval-pref";

beforeEach(() => sessionStorage.clear());

describe("approval preference", () => {
  it("defaults to auto and round-trips through sessionStorage", () => {
    expect(loadApprovalPref()).toBe("auto");
    saveApprovalPref("manual");
    expect(sessionStorage.getItem(APPROVAL_PREF_KEY)).toBe("manual");
    expect(loadApprovalPref()).toBe("manual");
    saveApprovalPref("auto");
    expect(loadApprovalPref()).toBe("auto");
  });

  it("treats unknown values and blocked storage as auto without throwing", () => {
    sessionStorage.setItem(APPROVAL_PREF_KEY, "weird");
    expect(loadApprovalPref()).toBe("auto");
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadApprovalPref(blocked)).toBe("auto");
    expect(() => saveApprovalPref("manual", blocked)).not.toThrow();
  });

  it("never relaxes manual when a conversation is restored", () => {
    expect(stricterApproval("auto", "auto")).toBe("auto");
    expect(stricterApproval("manual", "auto")).toBe("manual");
    expect(stricterApproval("auto", "manual")).toBe("manual");
  });
});
