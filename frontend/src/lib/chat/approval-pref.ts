// Chat 승인 방식의 탭 세션 기본값.
//
// 승인 방식은 대화마다 저장된다(IndexedDB 기록의 approval). 여기에 더해 이 탭에서 마지막으로 고른 방식을 sessionStorage 에
// 남겨, 새로고침하거나 새 대화를 시작해도 수동 승인이 자동으로 돌아가지 않게 한다. 탭을 닫으면 사라지고 Settings 기본값은 없다
// (기본은 자동).
//
// 규칙: 수동은 조용히 자동으로 바뀌지 않는다. 저장된 대화를 열 때 그 대화의 방식과 지금 방식 중 더 엄격한 쪽(수동)을 쓴다.
// 자동으로 돌아가는 길은 사용자가 툴바에서 고르는 것뿐이다.

import type { ApprovalMode } from "./useChatStream";

export const APPROVAL_PREF_KEY = "mcpc-chat-approval";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadApprovalPref(storage: StorageLike | null = sessionStore()): ApprovalMode {
  try {
    return storage?.getItem(APPROVAL_PREF_KEY) === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

export function saveApprovalPref(mode: ApprovalMode, storage: StorageLike | null = sessionStore()): void {
  try {
    storage?.setItem(APPROVAL_PREF_KEY, mode);
  } catch {
    /* 저장하지 못해도 이 페이지의 상태는 그대로다 */
  }
}

// 저장된 대화를 열 때 쓸 방식: 둘 중 하나라도 수동이면 수동.
export function stricterApproval(a: ApprovalMode, b: ApprovalMode): ApprovalMode {
  return a === "manual" || b === "manual" ? "manual" : "auto";
}
