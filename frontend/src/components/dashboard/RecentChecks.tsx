"use client";

import { useId } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { classifyProbeError } from "@/lib/dashboard/offline";
import { formatClock } from "@/lib/dashboard/time";
import { useLocale, useT } from "@/lib/i18n/client";
import type { CheckEvent } from "@/lib/shell/health-history";
import { cn } from "@/lib/utils";

// 화면에 그리는 최대 행 수 (스토어는 100건까지 보관한다).
const VISIBLE_EVENTS = 50;

// 최근 점검 로그. 이 세션에서 보낸 ping 결과를 최신순으로 보여 주고, 키보드로 스크롤할 수 있다.
export function RecentChecks({ events }: { events: readonly CheckEvent[] }) {
  const t = useT();
  const locale = useLocale();
  const titleId = useId();
  const rows = events.slice(0, VISIBLE_EVENTS);

  return (
    <section aria-labelledby={titleId} className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id={titleId} className="font-heading text-sm font-semibold">
          {t("dashboard.recentTitle")}
        </h2>
        <p className="text-xs text-fg-muted">{t("dashboard.recentSub")}</p>
      </div>
      <div className="rounded-md border border-line bg-surface-sunken py-2">
        <ScrollArea className="max-h-[220px] overflow-auto">
          <div
            role="log"
            aria-live="off"
            tabIndex={0}
            aria-label={t("dashboard.recentTitle")}
            className="max-h-[220px] overflow-auto font-mono text-2xs leading-5 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
          >
            {rows.length === 0 ? (
              <p className="px-3 text-fg-muted">{t("dashboard.recentEmpty")}</p>
            ) : (
              rows.map((event) => {
                const ok = event.outcome.ok;
                const message = event.outcome.ok
                  ? t("dashboard.logOkMessage", { ms: event.outcome.latencyMs, n: event.outcome.toolCount ?? 0 })
                  : classifyProbeError(event.outcome.error).detail;
                return (
                  <div
                    key={event.id}
                    className="grid grid-cols-[64px_28px_minmax(96px,160px)_minmax(0,1fr)] gap-x-2 px-3 whitespace-nowrap max-[901px]:grid-cols-[64px_28px_minmax(0,1fr)] max-[901px]:pb-1"
                  >
                    <time dateTime={new Date(event.at).toISOString()} className="tabular-nums text-fg-muted">
                      {formatClock(event.at, locale)}
                    </time>
                    <span className={cn(ok ? "text-success-fg" : "text-danger-fg")}>
                      {ok ? t("dashboard.logOk") : t("dashboard.logErr")}
                    </span>
                    <span className="truncate text-foreground" title={event.server}>
                      {event.server}
                    </span>
                    <span className="truncate text-fg-muted max-[901px]:col-span-3 max-[901px]:whitespace-normal max-[901px]:[overflow-wrap:anywhere]" title={message}>
                      {message}
                      {event.background && <span className="ml-2 text-fg-muted">{t("dashboard.logBackground")}</span>}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </section>
  );
}
