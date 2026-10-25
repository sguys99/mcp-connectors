"use client";

// 도구 호출 카드 (final.html 의 .tcard). 머리에 "서버 / 도구", 입력 요약, 상태 칩, 소요 시간이 있고
// 펼치면 입력(SQL 이면 SQL 블록), 결과(JSON 구문 강조, 길면 잘림), "추적에서 보기" 버튼이 나온다.
//
// 카드와 trace 의 스팬은 서로 연결된다. 카드에 마우스나 키보드 포커스를 올리면 onLink 로 스팬 id 를 알려서
// 워터폴이 그 행을 강조하고, 스팬을 고르거나 가리키면 linked/selected 로 이 카드가 강조된다.

import { ChartGanttIcon, CheckIcon, ChevronRightIcon, CircleSlashIcon, HandIcon, Loader2Icon, WrenchIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { useClock } from "@/components/chat/use-clock";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { argsShort } from "@/lib/chat/format";
import type { ChatToolUseWithResult } from "@/lib/chat/serialize";
import { useT } from "@/lib/i18n/client";
import { formatDuration } from "@/lib/trace/scale";
import { cn } from "@/lib/utils";

import { ToolInput, ToolResult } from "./ChatCode";

// approval 은 사용자 결정을 기다리는 중, approved 는 승인했지만 나머지 호출의 결정을 기다리느라 아직 실행 전, denied 는 거부해서 실행하지 않음.
export type ToolCardStatus = "running" | "done" | "error" | "cancelled" | "approval" | "approved" | "denied";

// 턴의 상태: running 이면 서버가 일하는 중, awaiting 이면 사용자 결정을 기다리는 중, ended 면 끝난 턴.
export type TurnPhase = "running" | "awaiting" | "ended";

export function toolCardStatus(tool: ChatToolUseWithResult, phase: TurnPhase): ToolCardStatus {
  if (tool.result) {
    if (tool.approval?.state === "denied") return "denied";
    return tool.result.isError ? "error" : "done";
  }
  if (phase === "awaiting" && tool.approval) return tool.approval.state === "pending" ? "approval" : "approved";
  return phase === "running" ? "running" : "cancelled";
}

const STATUS_TONE: Record<ToolCardStatus, ChipTone> = {
  running: "info",
  done: "ok",
  error: "err",
  cancelled: "neutral",
  approval: "warn",
  approved: "ok",
  denied: "neutral",
};

interface ToolCardProps {
  tool: ChatToolUseWithResult;
  status: ToolCardStatus;
  // 이 카드의 스팬 id. 시각 정보가 없는 예전 서버면 null (추적 연동 없음).
  spanId: string | null;
  durationMs: number | null;
  linked: boolean;
  selected: boolean;
  onLink: (spanId: string | null) => void;
  onShowInTrace: (spanId: string) => void;
  // 승인 대기 카드의 결정. always 는 "이 대화에서 항상 허용"을 함께 고른 승인이다.
  onDecide?: (toolUseId: string, decision: "approve" | "deny", always: boolean) => void;
}

export function ToolCard({ tool, status, spanId, durationMs, linked, selected, onLink, onShowInTrace, onDecide }: ToolCardProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const pending = status === "approval";
  const name = tool.tool ?? tool.name;
  const label = tool.server ? `${tool.server} / ${name}` : name;

  const link = spanId ? { onMouseEnter: () => onLink(spanId), onMouseLeave: () => onLink(null) } : {};

  return (
    <div
      role="group"
      aria-label={t("chat.toolCardLabel", { tool: label })}
      data-card-span={spanId ?? undefined}
      data-status={status}
      data-linked={linked || undefined}
      data-selected={selected || undefined}
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-line bg-surface transition-colors",
        linked && "border-line-strong",
        status === "error" && "border-danger-border",
        selected && "border-focus-ring ring-1 ring-focus-ring",
      )}
      {...link}
    >
      <Collapsible open={open || pending} onOpenChange={setOpen}>
        <h3 className="m-0">
          {pending ? (
            // 결정을 기다리는 카드는 항상 펼쳐 둔다 (입력을 보고 결정해야 하므로 접을 수 없다).
            <div className="flex min-h-[34px] w-full min-w-0 items-center gap-2 py-1 pr-3 pl-3 font-mono text-xs max-[901px]:min-h-11">
              <HandIcon aria-hidden className="size-3.5 shrink-0 text-warning-fg" />
              {tool.server ? <span className="min-w-0 shrink truncate text-fg-muted max-[901px]:hidden">{tool.server} /</span> : null}
              <span className="font-medium whitespace-nowrap text-foreground">{name}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted max-[560px]:hidden">{argsShort(tool.input)}</span>
              <StatusChip status={status} />
            </div>
          ) : (
            <CollapsibleTrigger
              className="flex min-h-[34px] w-full min-w-0 items-center gap-2 py-1 pr-2 pl-3 text-left font-mono text-xs transition-colors outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset max-[901px]:min-h-11"
              onFocus={() => spanId && onLink(spanId)}
              onBlur={() => spanId && onLink(null)}
            >
              <WrenchIcon aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
              {tool.server ? (
                <span className="min-w-0 shrink truncate text-fg-muted max-[901px]:hidden">{tool.server} /</span>
              ) : null}
              <span className="font-medium whitespace-nowrap text-foreground">{name}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted max-[560px]:hidden">{argsShort(tool.input)}</span>
              <StatusChip status={status} />
              {durationMs !== null ? (
                <span className="text-2xs whitespace-nowrap text-fg-muted tabular-nums">{formatDuration(durationMs)}</span>
              ) : null}
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3.5 shrink-0 text-fg-muted transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")}
              />
            </CollapsibleTrigger>
          )}
        </h3>
        <CollapsibleContent>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-line px-3 py-3">
            <ToolInput input={tool.input} />
            {tool.result && status !== "denied" ? <ToolResult content={tool.result.content} isError={tool.result.isError} /> : null}
            <ApprovalNote tool={tool} status={status} />
            {spanId ? (
              <div>
                <Button type="button" variant="ghost" size="xs" onClick={() => onShowInTrace(spanId)} className="font-mono text-2xs">
                  <ChartGanttIcon aria-hidden />
                  {t("chat.showInTrace")}
                </Button>
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
        {pending && onDecide ? <ApprovalPanel tool={tool} label={label} onDecide={onDecide} /> : null}
      </Collapsible>
    </div>
  );
}

// 결정을 마친 카드에 남는 한 줄 설명 (승인 방식, 거부 결과)
function ApprovalNote({ tool, status }: { tool: ChatToolUseWithResult; status: ToolCardStatus }) {
  const t = useT();
  const approval = tool.approval;
  if (!approval || status === "approval") return null;
  let text: string | null = null;
  if (status === "denied") text = t("chat.deniedByYou");
  else if (approval.auto) text = t("chat.approvedAuto");
  else if (status === "approved") text = t("chat.approvedQueued");
  else if (approval.state === "approved") text = t("chat.approvedByYou");
  return text ? <p className="text-xs text-fg-muted">{text}</p> : null;
}

// 승인 대기 패널 (final.html 의 .approve): 제목과 대기 타이머, 설명, 항상 허용 체크, 승인/거부 버튼.
function ApprovalPanel({
  tool,
  label,
  onDecide,
}: {
  tool: ChatToolUseWithResult;
  label: string;
  onDecide: (toolUseId: string, decision: "approve" | "deny", always: boolean) => void;
}) {
  const t = useT();
  const [always, setAlways] = useState(false);
  const checkId = useId();
  const clock = useClock(true);
  const started = tool.approval?.waitStartClient;
  const waited = started !== undefined && clock > 0 ? Math.max(0, clock - started) : 0;

  return (
    <div role="group" aria-label={t("chat.pendingTitle")} className="grid gap-3 border-t border-warning-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <HandIcon aria-hidden className="size-3.5 text-warning-fg" />
        <b className="text-sm">{t("chat.pendingTitle")}</b>
        <span className="ml-auto font-mono text-2xs text-warning-fg tabular-nums">{t("chat.waitingFor", { time: formatDuration(Math.floor(waited / 100) * 100) })}</span>
      </div>
      <p className="text-xs text-fg-muted">{t("chat.pendingBody")}</p>
      <div className="flex items-center gap-2">
        <Checkbox id={checkId} checked={always} onCheckedChange={(v) => setAlways(v === true)} />
        <label htmlFor={checkId} className="min-w-0 text-xs [overflow-wrap:anywhere]">
          {t("chat.alwaysAllow", { tool: label })}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" data-approval-action="approve" onClick={() => onDecide(tool.id, "approve", always)} className="gap-1.5 max-[901px]:h-9">
          <CheckIcon aria-hidden />
          {t("chat.approve")}
        </Button>
        <Button type="button" variant="destructive" data-approval-action="deny" onClick={() => onDecide(tool.id, "deny", false)} className="gap-1.5 max-[901px]:h-9">
          <XIcon aria-hidden />
          {t("chat.deny")}
        </Button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: ToolCardStatus }) {
  const t = useT();
  const text = {
    running: t("chat.statusRunning"),
    done: t("chat.statusDone"),
    error: t("chat.statusError"),
    cancelled: t("chat.statusCancelled"),
    approval: t("chat.statusApproval"),
    approved: t("chat.statusApproved"),
    denied: t("chat.statusDenied"),
  }[status];
  return (
    <Chip tone={STATUS_TONE[status]}>
      {status === "running" ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      {status === "done" ? <CheckIcon aria-hidden /> : null}
      {status === "error" ? <XIcon aria-hidden /> : null}
      {status === "cancelled" || status === "denied" ? <CircleSlashIcon aria-hidden /> : null}
      {status === "approval" ? <HandIcon aria-hidden /> : null}
      {status === "approved" ? <CheckIcon aria-hidden /> : null}
      {text}
    </Chip>
  );
}
