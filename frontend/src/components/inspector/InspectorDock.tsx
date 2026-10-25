"use client";

// 하단 도킹 패널 (final.html 의 .dock). 탭 머리(왼쪽)와 지우기, 접기 버튼(오른쪽, ⌘J), 본문으로 이루어진다.
// 탭: JSON-RPC 로그(RpcLogPanel), History(HistoryPanel), Server info.
//
// Server info: initialize 결과 (serverInfo, protocolVersion, transport, endpoint, Mcp-Session-Id, auth, capabilities, instructions)와
// 같은 값을 조립한 initialize 원문 JSON.

import { CheckIcon, ChevronDownIcon, ChevronUpIcon, FileJsonIcon, InfoIcon, Trash2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsApple } from "@/components/shell/shortcuts";
import { useT } from "@/lib/i18n/client";
import type { HistoryEntry } from "@/lib/inspector/history";
import type { RpcLog } from "@/lib/inspector/rpc-log";
import type { RuntimeInfo, ServerInfo } from "@/lib/mcp/types";

import { HistoryPanel } from "./HistoryPanel";
import { JsonCode } from "./ResponseBlocks";
import { RpcLogPanel } from "./RpcLogPanel";

export type DockTab = "log" | "history" | "server";

export type ServerInfoState = { kind: "loading" } | { kind: "ready"; info: ServerInfo } | { kind: "unavailable" };

interface InspectorDockProps {
  open: boolean;
  onToggle: () => void;
  tab: DockTab;
  onTab: (tab: DockTab) => void;
  serverName: string;
  endpoint: string;
  // 런타임 서버면 연결 방식과 헤더 이름 (값은 담지 않는다)
  runtime?: RuntimeInfo;
  // 클라이언트 설정 복사 대화상자 열기
  onCopyConfig: () => void;
  info: ServerInfoState;
  // JSON-RPC 로그 (이 화면을 연 뒤 이 서버와 주고받은 메시지)
  log: RpcLog;
  onClearLog: () => void;
  // 이 서버의 호출 기록 (최근 순)
  history: readonly HistoryEntry[];
  onOpenHistory: (entry: HistoryEntry) => void;
  onRerunHistory: (entry: HistoryEntry) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
  running: boolean;
}

// 자주 쓰는 capability 는 선언하지 않았을 때도 줄에 보여 준다. 서버가 더 선언한 것(예: completions)은 뒤에 붙인다.
const KNOWN_CAPABILITIES = ["tools", "resources", "prompts", "logging"] as const;

export function InspectorDock({
  open,
  onToggle,
  tab,
  onTab,
  serverName,
  endpoint,
  runtime,
  onCopyConfig,
  info,
  log,
  onClearLog,
  history,
  onOpenHistory,
  onRerunHistory,
  onDeleteHistory,
  onClearHistory,
  running,
}: InspectorDockProps) {
  const t = useT();
  const apple = useIsApple();
  const { confirm, confirmDialog } = useConfirm();
  const toggleLabel = `${t("inspector.dockToggle")} (${apple ? "⌘J" : "Ctrl+J"})`;

  // 지우기: 로그는 바로, 기록은 되돌릴 수 없어 한 번 묻는다.
  const clearable = tab === "log" ? log.entries.length > 0 : tab === "history" ? history.length > 0 : false;
  const clear = async () => {
    if (tab === "log") {
      onClearLog();
      return;
    }
    if (tab === "history") {
      const ok = await confirm({
        title: t("inspector.histClearTitle", { server: serverName }),
        description: t("inspector.histClearBody"),
        confirmLabel: t("inspector.dockClear"),
        destructive: true,
      });
      if (ok) onClearHistory();
    }
  };

  return (
    <section aria-label={t("inspector.dockLabel")} data-dock={open ? "open" : "closed"} className="flex h-full min-h-0 flex-col bg-background">
      <div className={"flex h-8 flex-none items-stretch gap-2 pr-2 pl-3 max-[901px]:h-9 max-[901px]:pl-1.5 " + (open ? "border-b border-line" : "")}>
        <Tabs value={tab} onValueChange={(v) => onTab(v as DockTab)} className="min-w-0 flex-1">
          <TabsList variant="line" aria-label={t("inspector.dockLabel")} className="h-full gap-3 p-0">
            <TabsTrigger value="log" className="min-w-6 flex-none px-1 font-mono text-2xs" data-dock-tab="log">
              {t("inspector.dockLog")}
              <TabCount n={log.entries.length} />
            </TabsTrigger>
            <TabsTrigger value="history" className="min-w-6 flex-none px-1 font-mono text-2xs" data-dock-tab="history">
              {t("inspector.dockHistory")}
              <TabCount n={history.length} />
            </TabsTrigger>
            <TabsTrigger value="server" className="min-w-6 flex-none px-1 font-mono text-2xs" data-dock-tab="server">
              {t("inspector.dockServerInfo")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-0.5">
          {open && tab === "server" ? (
            <Button type="button" variant="ghost" size="xs" onClick={onCopyConfig} data-action="open-config">
              <FileJsonIcon aria-hidden />
              <span className="max-[901px]:sr-only">{t("inspector.copyConfig")}</span>
            </Button>
          ) : null}
          {open && clearable ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => void clear()} data-action="clear-dock">
              <Trash2Icon aria-hidden />
              <span className="max-[901px]:sr-only">{t("inspector.dockClear")}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggle}
            data-action="toggle-dock"
          >
            {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </Button>
        </div>
      </div>
      {open ? (
        <div className={tab === "server" ? "min-h-0 flex-1 overflow-auto" : "min-h-0 flex-1 overflow-hidden"} data-dock-body>
          {tab === "log" ? <RpcLogPanel log={log} /> : null}
          {tab === "history" ? (
            <HistoryPanel
              serverName={serverName}
              entries={history}
              onOpen={onOpenHistory}
              onRerun={onRerunHistory}
              onDelete={onDeleteHistory}
              running={running}
            />
          ) : null}
          {tab === "server" ? <ServerInfoPanel serverName={serverName} endpoint={endpoint} runtime={runtime} state={info} /> : null}
        </div>
      ) : null}
      {confirmDialog}
    </section>
  );
}

// 탭 이름 옆 개수 (0 이면 숨긴다)
function TabCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="ml-1 rounded-sm bg-surface-sunken px-1 text-2xs text-fg-muted tabular-nums" data-tab-count>
      {n}
    </span>
  );
}

function ServerInfoPanel({ serverName, endpoint, runtime, state }: { serverName: string; endpoint: string; runtime?: RuntimeInfo; state: ServerInfoState }) {
  const t = useT();

  if (state.kind === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 p-4 font-mono text-xs text-fg-muted">
        <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
        {t("inspector.siLoading")}
      </p>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <Empty className="py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InfoIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("inspector.siUnavailable")}</EmptyTitle>
          <EmptyDescription>{t("inspector.siUnavailableHint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const { info } = state;
  const raw = {
    protocolVersion: info.protocolVersion,
    capabilities: info.capabilities,
    serverInfo: info.serverInfo,
    ...(info.instructions ? { instructions: info.instructions } : {}),
  };
  const capNames = [...KNOWN_CAPABILITIES, ...Object.keys(info.capabilities).filter((k) => !(KNOWN_CAPABILITIES as readonly string[]).includes(k))];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 p-3 max-[1081px]:grid-cols-1" data-server-info>
      <dl className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] content-start gap-x-3 gap-y-1.5 text-xs max-[1081px]:grid-cols-[104px_minmax(0,1fr)]">
        <Row label={t("inspector.siServer")}>
          <span className="font-mono">
            {info.serverInfo.name} {info.serverInfo.version}
          </span>
        </Row>
        <Row label={t("inspector.siProtocol")}>
          <Chip tone="brand">{info.protocolVersion || "?"}</Chip>
        </Row>
        <Row label={t("inspector.siTransport")}>
          {runtime
            ? t("inspector.siTransportRuntime", { mode: t(runtime.mode === "proxy" ? "runtime.modeProxyShort" : "runtime.modeDirectShort") })
            : t("inspector.siTransportValue")}
        </Row>
        <Row label={t("inspector.siEndpoint")}>
          <span className="font-mono [overflow-wrap:anywhere]">
            {endpoint} <span className="text-fg-muted">({serverName})</span>
          </span>
        </Row>
        <Row label={t("inspector.siSession")}>
          <span className="font-mono [overflow-wrap:anywhere]">{info.sessionId ?? t("inspector.siSessionNone")}</span>
        </Row>
        <Row label={t("inspector.siAuth")}>
          {runtime
            ? runtime.headerNames.length > 0
              ? t("inspector.siAuthRuntime", { names: runtime.headerNames.join(", ") })
              : t("inspector.siAuthRuntimeNone")
            : t("inspector.siAuthValue")}
        </Row>
        <Row label={t("inspector.siCaps")}>
          <span className="flex flex-wrap gap-1">
            {capNames.map((name) => {
              const value = info.capabilities[name];
              const declared = value !== undefined && value !== null;
              const flags = declared && typeof value === "object" ? Object.entries(value as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k) : [];
              return (
                <Chip key={name} tone={declared ? "ok" : "neutral"} data-capability={name} data-declared={declared}>
                  {declared ? <CheckIcon aria-hidden /> : <XIcon aria-hidden />}
                  {name}
                  {flags.length ? ` ${flags.join(" ")}` : ""}
                  <span className="sr-only"> {t(declared ? "inspector.siDeclared" : "inspector.siNotDeclared")}</span>
                </Chip>
              );
            })}
          </span>
        </Row>
        <Row label={t("inspector.siInstructions")}>
          {info.instructions ? <span className="[overflow-wrap:anywhere]">{info.instructions}</span> : <span className="text-fg-muted">{t("inspector.siInstructionsNone")}</span>}
        </Row>
      </dl>
      <div className="grid min-w-0 content-start gap-1.5">
        <span className="font-mono text-2xs text-fg-muted">{t("inspector.siRaw")}</span>
        <div className="overflow-hidden rounded-md border border-line">
          <JsonCode text={JSON.stringify(raw, null, 2)} className="max-h-64" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-2xs leading-[18px] text-fg-muted">{label}</dt>
      <dd className="min-w-0 leading-[18px]">{children}</dd>
    </>
  );
}
