"use client";

import { AlertCircleIcon, ArrowRightIcon, PencilIcon, RefreshCwIcon, SquareTerminalIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { ServerMenu, isRuntimeServer } from "@/components/servers/ServerMenu";
import { PING_UI_TIMEOUT_MS } from "@/components/shell/health-store";
import { useShell } from "@/components/shell/shell-context";
import { StatusDot } from "@/components/shell/StatusDot";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { classifyProbeError, recoveryCommands, type ProbeErrorKind } from "@/lib/dashboard/offline";
import { p50Of } from "@/lib/dashboard/latency";
import { agoParts, formatClock } from "@/lib/dashboard/time";
import { useLocale, useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/translate";
import { pickDescription } from "@/lib/mcp/description";
import { displayTarget } from "@/lib/runtime/connection";
import type { PublicServer } from "@/lib/mcp/types";
import type { HealthState } from "@/lib/shell/health";
import type { HealthHistory } from "@/lib/shell/health-history";
import { cn } from "@/lib/utils";

import { CommandLine } from "./CopyCommand";
import { Sparkline } from "./Sparkline";
import { useNow } from "./use-now";

// 열 트랙. 1280px 이하는 트랙이 줄고 작업 버튼이 아이콘만 남으며, 1080px 이하는 마지막 점검 열이 사라진다.
// 900px 이하는 카드형 그리드(이름+상태, 전송+도구 수, 지연+점검, 작업 전체 폭)로 바뀐다.
const ROW_GRID = cn(
  "grid items-center gap-3 px-4 py-2.5",
  "grid-cols-[96px_minmax(140px,1fr)_minmax(0,150px)_44px_176px_84px_124px]",
  "max-[1281px]:grid-cols-[92px_minmax(120px,1fr)_minmax(0,128px)_40px_176px_80px_76px] max-[1281px]:gap-2",
  "max-[1081px]:grid-cols-[88px_minmax(120px,1fr)_minmax(0,120px)_40px_140px_76px]",
  "max-[901px]:grid-cols-[minmax(0,1fr)_auto] max-[901px]:gap-x-3 max-[901px]:gap-y-2 max-[901px]:p-3",
  "max-[901px]:[grid-template-areas:'nm_st'_'tr_tl'_'lat_chk'_'acts_acts']",
);

interface ServerTableProps {
  // 표 머리글 레이블 (Registry 표와 Runtime 표를 구분한다)
  label?: string;
  servers: readonly PublicServer[];
  health: Readonly<Record<string, HealthState>>;
  history: HealthHistory;
  // 지연 스파크라인의 공용 눈금(ms). Registry 표와 Runtime 표가 같은 값을 받는다.
  scaleMs: number;
  onRetry: (server: PublicServer) => void;
}

export function ServerTable({ label, servers, health, history, scaleMs, onRetry }: ServerTableProps) {
  const t = useT();
  const headClass =
    "overflow-hidden font-mono text-2xs font-normal tracking-[var(--tracking-caps)] text-ellipsis whitespace-nowrap text-fg-muted uppercase lang-ko:tracking-[0.02em]";

  return (
    <div role="table" aria-label={label ?? t("dashboard.tableLabel")} className="overflow-hidden rounded-md border border-line">
      <div role="row" className={cn(ROW_GRID, "bg-background py-[7px] max-[901px]:hidden")}>
        <span role="columnheader" className={headClass}>
          {t("dashboard.colStatus")}
        </span>
        <span role="columnheader" className={headClass}>
          {t("dashboard.colServer")}
        </span>
        <span role="columnheader" className={headClass}>
          {t("dashboard.colTransport")}
        </span>
        <span role="columnheader" className={cn(headClass, "text-right")}>
          {t("dashboard.colTools")}
        </span>
        <span role="columnheader" className={headClass} title={t("dashboard.scaleNote", { max: scaleMs })}>
          {t("dashboard.colLatency")}
        </span>
        <span role="columnheader" className={cn(headClass, "max-[1081px]:hidden")}>
          {t("dashboard.colChecked")}
        </span>
        <span role="columnheader" className={cn(headClass, "text-right")}>
          {t("dashboard.colActions")}
        </span>
      </div>
      {servers.map((server) => (
        <ServerRow
          key={server.name}
          server={server}
          state={health[server.name] ?? { status: server.transport === "stdio" ? "na" : "idle" }}
          history={history}
          scaleMs={scaleMs}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}

const STATUS_WORD = {
  idle: { key: "dashboard.stChecking", tone: "text-warning-fg" },
  checking: { key: "dashboard.stChecking", tone: "text-warning-fg" },
  healthy: { key: "dashboard.stOnline", tone: "text-success-fg" },
  offline: { key: "dashboard.stOffline", tone: "text-danger-fg" },
  na: { key: "dashboard.stOnDemand", tone: "text-fg-muted" },
} as const;

interface ServerRowProps {
  server: PublicServer;
  state: HealthState;
  history: HealthHistory;
  scaleMs: number;
  onRetry: (server: PublicServer) => void;
}

function ServerRow({ server, state, history, scaleMs, onRetry }: ServerRowProps) {
  const t = useT();
  const locale = useLocale();
  const isStdio = server.transport === "stdio";
  const word = STATUS_WORD[state.status];
  const samples = history.samples[server.name];
  const p50 = p50Of(samples);
  const tools = history.knownTools[server.name];
  const checkedAt = history.checkedAt[server.name];
  const lastError = history.lastError[server.name];
  const runtime = isRuntimeServer(server);
  const description = runtime && server.transport === "streamable_http" && server.runtime
    ? t("runtime.rowDescription", { mode: t(server.runtime.mode === "proxy" ? "runtime.modeProxyShort" : "runtime.modeDirectShort"), target: displayTarget(server.runtime.target) })
    : pickDescription(server, locale);
  const showAlert = !isStdio && (state.status === "offline" || (state.status === "checking" && lastError !== undefined));

  return (
    <>
      <div
        role="row"
        className={cn(ROW_GRID, "border-t border-line transition-colors duration-(--duration-instant) hover:bg-surface-hover/55")}
      >
        <span
          role="cell"
          className={cn("flex items-center gap-2 text-xs whitespace-nowrap max-[901px]:[grid-area:st] max-[901px]:justify-self-end", word.tone)}
        >
          <span aria-hidden>
            <StatusDot status={state.status} />
          </span>
          {t(word.key)}
        </span>

        <div role="cell" className="grid min-w-0 gap-px max-[901px]:[grid-area:nm]">
          <b className="truncate font-mono text-sm font-medium">{server.name}</b>
          {description && (
            <span
              className="truncate text-xs text-fg-muted max-[1081px]:line-clamp-2 max-[1081px]:whitespace-normal"
              title={description}
            >
              {description}
            </span>
          )}
        </div>

        <div role="cell" className="grid min-w-0 gap-px font-mono text-2xs text-fg-muted max-[901px]:[grid-area:tr]">
          <span
            className={cn(
              "inline-flex h-4 items-center justify-self-start rounded-xs border px-[5px] text-[10px] tracking-[0.02em]",
              isStdio ? "border-line text-fg-muted" : "border-brand-border text-brand-text",
            )}
          >
            {isStdio ? "stdio" : "streamable_http"}
          </span>
          <span className="truncate" title={isStdio ? undefined : runtime ? server.runtime?.target : server.url}>
            {isStdio ? t("dashboard.stdioAddress") : runtime && server.runtime ? displayTarget(server.runtime.target) : server.url}
          </span>
        </div>

        <span
          role="cell"
          className="text-right font-mono text-sm tabular-nums max-[901px]:[grid-area:tl] max-[901px]:self-end"
          title={tools === undefined ? (isStdio ? t("dashboard.toolsStdio") : t("dashboard.toolsUnknown")) : undefined}
        >
          {tools === undefined ? (
            <span className="text-fg-muted">{t("dashboard.notAvailable")}</span>
          ) : (
            <span className={cn(state.status === "offline" && "text-fg-muted")}>{tools}</span>
          )}
          <span className="ml-1 hidden text-2xs font-normal text-fg-muted max-[901px]:inline">
            {t("dashboard.toolsShort")}
          </span>
        </span>

        <div role="cell" className="min-w-0 max-[901px]:[grid-area:lat]">
          <Latency server={server} samples={samples} p50={p50} scaleMs={scaleMs} offline={state.status === "offline"} />
        </div>

        <span
          role="cell"
          className="font-mono text-2xs leading-4 tabular-nums text-fg-muted max-[1081px]:hidden max-[901px]:block max-[901px]:self-center max-[901px]:text-right max-[901px]:[grid-area:chk]"
        >
          <Checked isStdio={isStdio} at={checkedAt} locale={locale} />
        </span>

        <div
          role="cell"
          className="flex justify-end gap-1 max-[1081px]:col-start-6 max-[901px]:col-auto max-[901px]:[grid-area:acts]"
        >
          <InspectAction server={server} />
          <ServerMenu server={server} />
        </div>
      </div>

      {showAlert && (
        <div role="row" className="border-t border-line px-4 pb-3 pl-[calc(16px+96px+12px)] max-[1281px]:pl-[calc(16px+92px+8px)] max-[1081px]:pl-[calc(16px+88px+8px)] max-[901px]:px-3">
          <div role="cell">
            <OfflineAlert
              server={server}
              error={state.status === "offline" ? state.error : (lastError ?? "")}
              checking={state.status === "checking"}
              onRetry={onRetry}
            />
          </div>
        </div>
      )}
    </>
  );
}

function Latency({
  server,
  samples,
  p50,
  scaleMs,
  offline,
}: {
  server: PublicServer;
  samples: HealthHistory["samples"][string];
  p50: number | null;
  scaleMs: number;
  offline: boolean;
}) {
  const t = useT();
  const na = "font-mono text-2xs leading-4 text-fg-muted";
  if (server.transport === "stdio") return <span className={na}>{t("dashboard.stdioNoSamples")}</span>;
  if (!samples || samples.length === 0) return <span className={na}>{t("dashboard.collecting")}</span>;

  const label = offline
    ? t("dashboard.sparkLabelOffline", { name: server.name, n: samples.length, max: scaleMs })
    : t("dashboard.sparkLabel", { name: server.name, ms: p50 ?? 0, n: samples.length, max: scaleMs });

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Sparkline samples={samples} label={label} scaleMs={scaleMs} className="w-[120px] max-[1081px]:w-[92px] max-[901px]:w-[120px]" />
      <span
        className={cn(
          "w-10 flex-none text-right font-mono text-xs whitespace-nowrap tabular-nums",
          (offline || p50 === null) && "text-fg-muted",
        )}
      >
        {p50 === null ? (
          t("dashboard.notAvailable")
        ) : (
          <>
            {p50}
            <span className="ml-px text-2xs text-fg-muted" aria-hidden>
              ms
            </span>
            <span className="sr-only"> ms</span>
          </>
        )}
      </span>
    </div>
  );
}

function Checked({ isStdio, at, locale }: { isStdio: boolean; at: number | undefined; locale: string }) {
  const t = useT();
  const now = useNow();
  if (isStdio) return <>{t("dashboard.checkedNever")}</>;
  if (at === undefined) return <>{t("dashboard.checkedPending")}</>;
  const { unit, n } = agoParts(Math.max(0, now - at));
  const ago = t(unit === "s" ? "dashboard.checkedAgoS" : unit === "m" ? "dashboard.checkedAgoM" : "dashboard.checkedAgoH", { n });
  return (
    <>
      <b className="block text-xs font-normal text-foreground">{formatClock(at, locale)}</b>
      {now === 0 ? null : ago}
    </>
  );
}

function InspectAction({ server }: { server: PublicServer }) {
  const t = useT();
  const hintId = useId();
  const label = t("dashboard.inspect");
  const aria = t("dashboard.inspectAria", { name: server.name });
  const className = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "rounded-md max-[901px]:h-8 max-[901px]:flex-1",
  );
  const text = (
    <span className="max-[1281px]:hidden max-[901px]:inline">{label}</span>
  );

  if (server.transport === "stdio") {
    // 비활성 버튼은 포커스를 못 받아 툴팁을 못 띄우므로 aria-disabled 로 둔다.
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-disabled="true"
                aria-label={aria}
                aria-describedby={hintId}
                onClick={(e) => e.preventDefault()}
                className={cn(className, "cursor-not-allowed opacity-50 aria-disabled:pointer-events-auto")}
              />
            }
          >
            <ArrowRightIcon aria-hidden />
            {text}
          </TooltipTrigger>
          <TooltipContent>{t("dashboard.inspectStdio")}</TooltipContent>
        </Tooltip>
        <span id={hintId} className="sr-only">
          {t("dashboard.inspectStdio")}
        </span>
      </>
    );
  }

  return (
    <Link href={`/inspector?server=${encodeURIComponent(server.name)}`} aria-label={aria} title={aria} className={className}>
      <ArrowRightIcon aria-hidden />
      {text}
    </Link>
  );
}

const ALERT_TITLE: Record<ProbeErrorKind, TKey> = {
  unreachable: "dashboard.offlineUnreachable",
  timeout: "dashboard.offlineTimeout",
  auth: "dashboard.offlineAuth",
  other: "dashboard.offlineOther",
};

function OfflineAlert({
  server,
  error,
  checking,
  onRetry,
}: {
  server: PublicServer;
  error: string;
  checking: boolean;
  onRetry: (server: PublicServer) => void;
}) {
  const t = useT();
  const { openEditServer } = useShell();
  const runtime = isRuntimeServer(server);
  const probe = classifyProbeError(error);
  const cmds = recoveryCommands(server.name);
  const cause = runtime
    ? t("runtime.offlineCause")
    : probe.kind === "unreachable"
      ? t("dashboard.causeUnreachable")
      : probe.kind === "timeout"
        ? t("dashboard.causeTimeout", { s: PING_UI_TIMEOUT_MS / 1000 })
        : probe.kind === "auth"
          ? t("dashboard.causeAuth")
          : t("dashboard.causeOther");

  return (
    <Alert className="gap-x-2 rounded-md border-danger-border bg-danger-bg p-3 text-xs leading-[18px] text-foreground">
      <AlertCircleIcon aria-hidden className="text-danger-fg" />
      <AlertTitle className="font-semibold text-danger-fg">{t(ALERT_TITLE[probe.kind], { name: server.name })}</AlertTitle>
      <div className="col-start-2 grid min-w-0 gap-2">
        <p>{cause}</p>
        <p className="font-mono text-2xs break-words text-fg-muted">
          <span className="font-medium text-foreground">{t("dashboard.errorLabel")}</span> {probe.detail}
        </p>
        {!runtime && probe.kind === "unreachable" && (
          <div className="grid gap-1.5">
            {cmds.compose && (
              <Cmd caption={t("dashboard.cmdDocker")} command={cmds.compose} label={t("dashboard.copyCommand", { cmd: cmds.compose })} />
            )}
            <Cmd caption={t("dashboard.cmdLocal")} command={cmds.make} label={t("dashboard.copyCommand", { cmd: cmds.make })} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-md"
            disabled={checking}
            onClick={() => onRetry(server)}
          >
            <RefreshCwIcon className={cn(checking && "animate-spin")} />
            {checking ? t("dashboard.retrying") : t("dashboard.retry")}
          </Button>
          {runtime && (
            <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={() => openEditServer(server.name)}>
              <PencilIcon aria-hidden />
              {t("runtime.menuEdit")}
            </Button>
          )}
          <Link
            href={`/inspector?server=${encodeURIComponent(server.name)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-md")}
          >
            <SquareTerminalIcon aria-hidden />
            {t("dashboard.openInspector")}
          </Link>
        </div>
      </div>
    </Alert>
  );
}

function Cmd({ caption, command, label }: { caption: string; command: string; label: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="font-mono text-2xs text-fg-muted">{caption}</span>
      <CommandLine command={command} label={label} />
    </div>
  );
}
