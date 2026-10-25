"use client";

// 도킹 패널의 History 탭 (final.html 의 .hist-row). 이 서버로 보낸 도구 호출, 리소스 읽기, 프롬프트 가져오기를 최근 순으로 보여 준다.
//   * 한 줄: 선택 칸, 시각, 대상, 입력, 상태 칩, 소요 시간, [열기] [다시 실행] [삭제]
//   * 열기는 요청 패널에 입력을 채우기만 하고, 다시 실행은 채운 뒤 바로 보낸다 (가려진 값이 있으면 채우기만 한다).
//   * 선택한 줄(없으면 전체)을 시나리오 YAML 로 내보낸다 (ExportScenarioDialog).

import { FileDownIcon, HistoryIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useT } from "@/lib/i18n/client";
import { summarizeArgs, type HistoryEntry } from "@/lib/inspector/history";
import { isExportable } from "@/lib/inspector/exportable";
import { cn } from "@/lib/utils";

// 내보내기 대화상자는 yaml 라이브러리를 쓰므로 처음 열 때 불러온다 (Inspector 첫 번들에서 뺀다).
const ExportScenarioDialog = dynamic(() => import("./ExportScenarioDialog").then((m) => m.ExportScenarioDialog), { ssr: false });

const ROW_GRID =
  "grid grid-cols-[20px_64px_minmax(90px,170px)_minmax(0,1fr)_92px_64px_auto] max-[1081px]:grid-cols-[20px_60px_minmax(80px,130px)_minmax(0,1fr)_92px_auto] max-[901px]:grid-cols-[20px_minmax(0,1fr)_auto_auto] max-[901px]:[grid-template-areas:'chk_tool_st_acts'_'chk_args_args_acts']";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ts: string) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

interface HistoryPanelProps {
  serverName: string;
  // 이 서버의 기록 (최근 순)
  entries: readonly HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onRerun: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  // 실행 중에는 다시 실행을 막는다
  running: boolean;
}

export function HistoryPanel({ serverName, entries, onOpen, onRerun, onDelete, running }: HistoryPanelProps) {
  const t = useT();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  // 한 번 열린 뒤로는 계속 마운트해 닫힘 애니메이션과 포커스 복귀를 지킨다.
  const [exportMounted, setExportMounted] = useState(false);
  if (exportOpen && !exportMounted) setExportMounted(true);

  const exportable = useMemo(() => entries.filter(isExportable), [entries]);
  // 지워진 기록의 선택은 자연히 걸러진다
  const chosen = useMemo(() => exportable.filter((e) => selected.has(e.id)), [exportable, selected]);
  const exportEntries = chosen.length > 0 ? chosen : exportable;
  const allSelected = exportable.length > 0 && chosen.length === exportable.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const statusChip = (e: HistoryEntry): { tone: ChipTone; label: string } => {
    if (e.status === "ok") return { tone: "ok", label: t("inspector.histOk") };
    if (e.status === "cancelled") return { tone: "warn", label: t("inspector.histCancelled") };
    if (e.outcome === "transport") return { tone: "err", label: t("inspector.histTransport") };
    return { tone: "err", label: e.errorCode ? `${t("inspector.histError")} ${e.errorCode}` : t("inspector.histError") };
  };

  if (entries.length === 0) {
    return (
      <Empty className="py-6" data-history-empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("inspector.histEmpty")}</EmptyTitle>
          <EmptyDescription>{t("inspector.histEmptyHint")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-history>
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
        <label className="flex items-center gap-2 text-2xs text-fg-muted">
          <Checkbox
            checked={allSelected}
            indeterminate={chosen.length > 0 && !allSelected}
            disabled={exportable.length === 0}
            onCheckedChange={(on) => setSelected(on ? new Set(exportable.map((e) => e.id)) : new Set())}
            aria-label={t("inspector.histSelectAll")}
            data-history-select-all
          />
          <span className="font-mono" data-history-count>
            {chosen.length > 0 ? t("inspector.histSelected", { n: chosen.length }) : t("inspector.histCount", { n: entries.length })}
          </span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={exportEntries.length === 0}
          onClick={() => setExportOpen(true)}
          data-action="export-scenario"
        >
          <FileDownIcon aria-hidden />
          {chosen.length > 0 ? t("inspector.histExportSelected", { n: chosen.length }) : t("inspector.histExportAll")}
        </Button>
      </div>

      <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-0" aria-label={t("inspector.dockHistory")}>
        {entries.map((e) => {
          const chip = statusChip(e);
          const label = e.target;
          const redacted = e.redacted === true;
          return (
            <li
              key={e.id}
              data-history-row={e.id}
              data-kind={e.kind}
              data-status={e.status}
              className={cn(ROW_GRID, "min-h-[30px] items-center gap-2 border-b border-line py-1 pr-2 pl-3 font-mono text-2xs hover:bg-surface-hover [&>*]:min-w-0")}
            >
              <span className="flex items-center max-[901px]:[grid-area:chk]">
                <Checkbox
                  checked={selected.has(e.id) && isExportable(e)}
                  disabled={!isExportable(e)}
                  onCheckedChange={(on) => toggle(e.id, on)}
                  aria-label={t("inspector.histSelectRow", { name: label })}
                />
              </span>
              <span className="text-fg-muted tabular-nums max-[901px]:hidden">{clock(e.ts)}</span>
              <span className="truncate max-[901px]:[grid-area:tool]" title={label}>
                <span className="text-fg-muted">{e.kind === "tool" ? "" : e.kind === "resource" ? "resource " : "prompt "}</span>
                {label}
              </span>
              <span className="truncate text-fg-muted max-[901px]:[grid-area:args]" title={summarizeArgs(e)}>
                {summarizeArgs(e)}
              </span>
              <span className="max-[901px]:[grid-area:st]">
                <Chip tone={chip.tone}>{chip.label}</Chip>
              </span>
              <span className="text-right tabular-nums max-[1081px]:hidden max-[901px]:hidden">{e.durationMs} ms</span>
              <span className="flex items-center justify-end gap-0.5 max-[901px]:[grid-area:acts]">
                <Button type="button" variant="ghost" size="xs" onClick={() => onOpen(e)} data-action="history-open" aria-label={`${t("inspector.histOpen")}: ${label}`}>
                  {t("inspector.histOpen")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={running}
                  title={redacted ? t("inspector.histRedactedBlocked") : undefined}
                  onClick={() => onRerun(e)}
                  data-action="history-rerun"
                  aria-label={`${t("inspector.histRerun")}: ${label}`}
                >
                  <RefreshCwIcon aria-hidden />
                  <span className="max-[901px]:sr-only">{t("inspector.histRerun")}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(e.id)}
                  data-action="history-delete"
                  aria-label={`${t("inspector.histDelete")}: ${label}`}
                  title={t("inspector.histDelete")}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      {exportOpen || exportMounted ? (
        <ExportScenarioDialog open={exportOpen} onOpenChange={setExportOpen} serverName={serverName} entries={exportEntries} />
      ) : null}
    </div>
  );
}
