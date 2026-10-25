"use client";

// 도킹 패널의 JSON-RPC 로그 탭 (final.html 의 .log-row). transport 를 지나는 요청, 응답, 알림을 시각 순으로 보여 준다.
//   * 한 줄: 시각, 방향(→ 보냄, ← 받음, • 알림), 메서드, id, 요약(상태 포함), 소요 시간(ms), 크기
//   * 줄을 누르면 비밀을 가린 JSON 을 펼친다. 펼친 메시지 하나 또는 전체를 JSON 으로 복사할 수 있다.
//   * 필터: 메서드, id, 상태, 본문 글자 (단어가 모두 들어 있는 줄). 새 메시지가 오면 맨 아래에 붙어 있을 때만 따라 내려간다.

import { CopyIcon, SearchIcon, TerminalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CopyIconButton, useCopy } from "@/components/dashboard/CopyCommand";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import {
  exportRpcLog,
  filterRpc,
  formatBytes,
  messageJson,
  RPC_LOG_MAX,
  type RpcLog,
  type RpcLogEntry,
  type RpcStatus,
} from "@/lib/inspector/rpc-log";
import { cn } from "@/lib/utils";

import { JsonCode } from "./ResponseBlocks";

// 데스크톱 열: 시각, 방향, 메서드, id, 요약, ms, 크기. 1081px 이하에서 크기를, 901px 이하에서 id 와 요약과 크기를 접는다.
const ROW_GRID =
  "grid grid-cols-[92px_18px_minmax(120px,170px)_48px_minmax(0,1fr)_56px_56px] max-[1081px]:grid-cols-[84px_18px_minmax(100px,150px)_40px_minmax(0,1fr)_48px] max-[901px]:grid-cols-[84px_14px_minmax(0,1fr)_40px]";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatClockMs(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function statusClass(status: RpcStatus): string {
  if (status === "error") return "text-(--log-error)";
  if (status === "cancelled") return "text-(--log-warn)";
  return "text-fg-muted";
}

export function RpcLogPanel({ log }: { log: RpcLog }) {
  const t = useT();
  const copy = useCopy();
  const [query, setQuery] = useState("");
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 맨 아래에 붙어 있으면 새 메시지를 따라 내려간다.
  const stickRef = useRef(true);

  const shown = useMemo(() => filterRpc(log.entries, query), [log.entries, query]);

  const lastSeq = log.entries.at(-1)?.seq;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current && openSeq === null) el.scrollTop = el.scrollHeight;
  }, [lastSeq, openSeq]);

  const statusLabel: Record<RpcStatus, string> = {
    pending: t("inspector.logStatusPending"),
    ok: t("inspector.logStatusOk"),
    error: t("inspector.logStatusError"),
    cancelled: t("inspector.logStatusCancelled"),
    info: t("inspector.logStatusInfo"),
  };

  if (log.entries.length === 0) {
    return (
      <Empty className="py-6" data-rpc-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TerminalIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("inspector.logEmpty")}</EmptyTitle>
          <EmptyDescription>{t("inspector.logEmptyHint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-rpc-log>
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
        <div className="relative w-64 max-w-full">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-fg-muted" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("inspector.logFilter")}
            placeholder={t("inspector.logFilterPlaceholder")}
            className="h-6 pl-7 font-mono text-xs md:text-xs"
            data-rpc-filter
          />
        </div>
        <span className="font-mono text-2xs text-fg-muted" data-rpc-count>
          {t("inspector.logCount", { shown: shown.length, total: log.entries.length })}
        </span>
        {log.dropped > 0 ? <span className="font-mono text-2xs text-fg-muted">{t("inspector.logDropped", { n: log.dropped, max: RPC_LOG_MAX })}</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={shown.length === 0}
          onClick={() => void copy(exportRpcLog(shown))}
          data-action="copy-log"
        >
          <CopyIcon aria-hidden />
          {t("inspector.logCopyAll")}
        </Button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        role="region"
        aria-label={t("inspector.dockLog")}
        className="min-h-0 flex-1 overflow-auto"
      >
        <div aria-hidden="true" className={cn(ROW_GRID, "sticky top-0 z-[1] h-[26px] items-center gap-2 border-b border-line bg-background px-3 font-mono text-2xs text-fg-muted")}>
          <span>{t("inspector.logTime")}</span>
          <span />
          <span>{t("inspector.logMethod")}</span>
          <span className="max-[901px]:hidden">id</span>
          <span className="max-[901px]:hidden">{t("inspector.logDetail")}</span>
          <span className="text-right">ms</span>
          <span className="text-right max-[1081px]:hidden">{t("inspector.logSize")}</span>
        </div>
        {shown.length === 0 ? (
          <p className="p-4 text-xs text-fg-muted" data-rpc-nomatch>
            {t("inspector.logNoMatch")}
          </p>
        ) : (
          shown.map((e) => (
            <LogRow key={e.seq} entry={e} open={openSeq === e.seq} onToggle={() => setOpenSeq(openSeq === e.seq ? null : e.seq)} statusLabel={statusLabel} />
          ))
        )}
      </div>
    </div>
  );
}

function LogRow({
  entry: e,
  open,
  onToggle,
  statusLabel,
}: {
  entry: RpcLogEntry;
  open: boolean;
  onToggle: () => void;
  statusLabel: Record<RpcStatus, string>;
}) {
  const t = useT();
  const glyph = e.kind === "notification" ? "•" : e.dir === "out" ? "→" : "←";
  const glyphClass = e.kind === "notification" ? "text-(--log-debug)" : e.dir === "out" ? "text-(--log-request)" : e.status === "error" ? "text-(--log-error)" : "text-(--log-response)";
  const dirLabel = e.kind === "notification" ? t("inspector.logKindNotification") : e.dir === "out" ? t("inspector.logDirOut") : t("inspector.logDirIn");
  // 오류, 취소, 대기는 색 말고 글자로도 알린다.
  const marked = e.status === "error" || e.status === "cancelled" || e.status === "pending";
  const bodyId = `rpc-json-${e.seq}`;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        data-rpc-row={e.seq}
        data-dir={e.dir}
        data-kind={e.kind}
        data-status={e.status}
        data-method={e.method}
        className={cn(
          ROW_GRID,
          "h-6 w-full items-center gap-2 px-3 text-left font-mono text-2xs whitespace-nowrap transition-colors outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring max-[901px]:h-[30px] [&>span]:overflow-hidden [&>span]:text-ellipsis",
          open && "bg-surface-active",
        )}
        onClick={onToggle}
      >
        <span className="text-fg-muted tabular-nums">{formatClockMs(e.at)}</span>
        <span className={glyphClass}>
          <span aria-hidden>{glyph}</span>
          <span className="sr-only">{dirLabel}</span>
        </span>
        <span>{e.method || <span className="text-fg-muted">{t("inspector.logResponse")}</span>}</span>
        <span className="text-fg-muted tabular-nums max-[901px]:hidden">{e.rpcId ?? ""}</span>
        <span className={cn("max-[901px]:hidden", statusClass(e.status))}>
          {marked ? <span className="font-semibold">{statusLabel[e.status]}</span> : <span className="sr-only">{statusLabel[e.status]}</span>}
          {marked && e.detail ? " " : ""}
          <span className={marked ? "" : "text-fg-muted"}>{e.detail}</span>
        </span>
        <span className={cn("text-right tabular-nums", e.status === "error" && "text-(--log-error)")}>{e.durationMs ?? ""}</span>
        <span className="text-right text-fg-muted tabular-nums max-[1081px]:hidden">{formatBytes(e.bytes)}</span>
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-1.5 px-3 pt-1.5 pb-3 pl-[calc(0.75rem+92px+18px+1rem)] max-[901px]:pl-3" data-rpc-json>
          <div className="flex flex-wrap items-center gap-x-3 font-mono text-2xs text-fg-muted">
            <span>
              {dirLabel}, {statusLabel[e.status]}
              {e.rpcId !== undefined ? `, id ${e.rpcId}` : ""}
              {e.durationMs !== undefined ? `, ${e.durationMs} ms` : ""}
              {`, ${formatBytes(e.bytes)}`}
            </span>
            <CopyIconButton text={messageJson(e)} label={t("inspector.logCopyOne")} />
          </div>
          <div className="overflow-hidden rounded-md border border-line">
            <JsonCode text={messageJson(e)} className="max-h-56" />
          </div>
        </div>
      ) : null}
    </>
  );
}
