"use client";

import { useEffect } from "react";

import { useHealthSummary } from "@/components/shell/health-store";
import { useT } from "@/lib/i18n/client";
import { getSnapshot, markGettingStarted, onGettingStartedProgress } from "@/lib/onboarding/getting-started";
import { notify } from "@/lib/ui/notify";

// 셸에 한 번 붙는 보이지 않는 컴포넌트.
//  * 1단계(서버 시작)는 헬스 스토어에서 HTTP 서버가 하나라도 온라인이면 자동으로 끝낸다. 한 번 끝나면 서버를 꺼도 유지한다.
//    사용자가 한 일이 아니므로 토스트 없이 조용히 체크한다 (첫 방문 때 아무것도 안 했는데 알림이 뜨지 않게).
//  * 사용자의 동작으로 단계가 끝나면(Inspector 호출, Chat 도구 호출) 패널이 숨겨져 있지 않을 때만 진행 토스트를 띄운다.
export function GettingStartedWatcher() {
  const t = useT();
  const { online } = useHealthSummary();

  useEffect(() => {
    if (online > 0) markGettingStarted("startServer", { silent: true });
  }, [online]);

  useEffect(
    () =>
      onGettingStartedProgress(({ done, total }) => {
        if (getSnapshot().hidden) return;
        notify.success(t("gettingStarted.toast", { n: done, total }));
      }),
    [t],
  );

  return null;
}
