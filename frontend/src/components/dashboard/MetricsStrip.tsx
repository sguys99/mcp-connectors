"use client";

import type { ReactNode } from "react";

import type { DashboardMetrics } from "@/lib/dashboard/metrics";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

// 지표 띠 네 칸 (카드가 아니라 1px 구획). 값이 없으면 "n/a" 와 이유를 보여 주고 임의의 숫자를 만들지 않는다.
// 1080px 이하에서는 2열 x 2행으로 접힌다.
export function MetricsStrip({ metrics }: { metrics: DashboardMetrics }) {
  const t = useT();
  const na = t("dashboard.notAvailable");

  let reachableNote = t("dashboard.mReachableOk");
  let reachableTone: "ok" | "err" | "muted" = "ok";
  if (metrics.httpTotal === 0) {
    reachableNote = t("dashboard.mReachableNone");
    reachableTone = "muted";
  } else if (metrics.httpOffline > 0) {
    reachableNote = t("dashboard.mReachableOff", { n: metrics.httpOffline });
    reachableTone = "err";
  } else if (metrics.httpOnline < metrics.httpTotal) {
    reachableNote = t("dashboard.mReachableWait");
    reachableTone = "muted";
  }

  return (
    <section aria-label={t("nav.dashboard")} className="rounded-md border border-line bg-background">
      <dl className="m-0 grid grid-cols-4 max-[1081px]:grid-cols-2">
        <Cell
          index={0}
          label={t("dashboard.mReachable")}
          note={reachableNote}
          value={
            <span
              className={cn(
                reachableTone === "ok" && "text-success-fg",
                reachableTone === "err" && "text-danger-fg",
                reachableTone === "muted" && "text-foreground",
              )}
            >
              {metrics.httpOnline}
              <Unit>/ {metrics.httpTotal}</Unit>
            </span>
          }
        />
        <Cell
          index={1}
          label={t("dashboard.mOnDemand")}
          note={t("dashboard.mOnDemandNote")}
          value={<span>{metrics.stdio}</span>}
        />
        <Cell
          index={2}
          label={t("dashboard.mTools")}
          note={
            metrics.toolsTotal === null
              ? t("dashboard.mToolsNone")
              : t("dashboard.mToolsNote", { n: metrics.toolServers })
          }
          value={
            metrics.toolsTotal === null ? <span className="text-fg-muted">{na}</span> : <span>{metrics.toolsTotal}</span>
          }
        />
        <Cell
          index={3}
          label={t("dashboard.mP50")}
          note={metrics.p50 === null ? t("dashboard.mP50None") : t("dashboard.mP50Note")}
          value={
            metrics.p50 === null ? (
              <span className="text-fg-muted">{na}</span>
            ) : (
              <span>
                {metrics.p50}
                <Unit>ms</Unit>
              </span>
            )
          }
        />
      </dl>
    </section>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return <small className="ml-1 text-sm font-normal text-fg-muted">{children}</small>;
}

const BORDERS = [
  "",
  "border-l",
  "min-[1081px]:border-l max-[1081px]:border-t",
  "border-l max-[1081px]:border-t",
];

function Cell({ index, label, value, note }: { index: number; label: string; value: ReactNode; note: string }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5 border-line px-4 py-3 max-[901px]:px-3 max-[901px]:py-2.5", BORDERS[index])}>
      <dt className="font-mono text-2xs leading-4 font-medium tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-[0.02em]">
        {label}
      </dt>
      <dd className="m-0 font-heading text-2xl leading-8 font-semibold tracking-tight tabular-nums max-[901px]:text-xl max-[901px]:leading-[30px]">
        {value}
      </dd>
      <dd className="m-0 text-xs text-fg-muted">{note}</dd>
    </div>
  );
}
