"use client";

// Chat 의 Trace 열 (final.html 의 .trace-col, 이 제품의 대표 화면). 위에서 아래로:
//   머리(run 번호 칩) > 범례 > 턴별 워터폴(질문, 총 시간) > 선택한 스팬의 상세 > 실행 요약
// 워터폴은 Inspector 의 Timing 탭과 같은 공용 컴포넌트(components/trace/Waterfall)이고, 스팬은 lib/chat/trace 가
// SSE 의 서버 측 시각으로 만든다 (실측만, 추정값 없음).

import { ChartGanttIcon, CheckIcon, CircleSlashIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";

import { Chip, type ChipTone } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { KIND_ICON, KIND_LABEL, kindsPresent, Waterfall, WaterfallLegend } from "@/components/trace/Waterfall";
import type { SpanDetail as SpanDetailData, TurnTrace } from "@/lib/chat/trace";
import { formatCompact, formatCount } from "@/lib/chat/format";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/translate";
import { formatDuration } from "@/lib/trace/scale";
import type { SpanStatus, TraceSpan } from "@/lib/trace/spans";
import { cn } from "@/lib/utils";

import { ToolInput, ToolResult } from "./ChatCode";

export interface TraceTurnView {
  id: string;
  // 몇 번째 질문인지 (1부터)와 질문 문구
  number: number;
  question: string;
  trace: TurnTrace;
  maxIterations: number;
}

interface TracePanelProps {
  turns: readonly TraceTurnView[];
  selectedSpanId: string | null;
  linkedSpanId: string | null;
  onSelectSpan: (id: string) => void;
  onLink: (id: string | null) => void;
}

export function TracePanel({ turns, selectedSpanId, linkedSpanId, onSelectSpan, onLink }: TracePanelProps) {
  const t = useT();
  const allSpans = useMemo(() => turns.flatMap((turn) => turn.trace.spans), [turns]);
  const kinds = useMemo(() => kindsPresent(allSpans), [allSpans]);
  const latest = turns[turns.length - 1];

  // 선택한 스팬과 상세 (턴 수가 적어 매번 찾아도 싸다)
  const owner = selectedSpanId ? turns.find((turn) => turn.trace.details.has(selectedSpanId)) : undefined;
  const span = owner?.trace.spans.find((s) => s.id === selectedSpanId);
  const detail = selectedSpanId ? owner?.trace.details.get(selectedSpanId) : undefined;
  const selected = span && detail ? { span, detail } : null;

  return (
    <section aria-label={t("chat.trace")} className="flex h-full min-h-0 min-w-0 flex-col bg-surface-sunken">
      <div className="flex h-9 flex-none items-center gap-2 border-b border-line bg-background px-3">
        <h2 className="flex-1 font-mono text-2xs font-medium tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-[0.02em]">
          {t("chat.trace")}
        </h2>
        <Chip tone={latest?.trace.summary.awaiting ? "warn" : latest?.trace.summary.running ? "info" : "neutral"} className="tabular-nums">
          {turns.length > 0 ? t("chat.runChip", { n: turns.length }) : t("chat.runIdle")}
        </Chip>
      </div>

      {kinds.length > 0 ? <WaterfallLegend kinds={kinds} className="mt-0 flex-none border-b border-line bg-background px-3 py-1.5" /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <Empty className="p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartGanttIcon aria-hidden />
              </EmptyMedia>
              <EmptyDescription>{t("chat.traceEmpty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="border-b border-line last:border-b-0">
              <div className="flex min-h-[30px] min-w-0 items-center gap-2 border-b border-line bg-background px-3 py-0.5 text-2xs">
                <span className="flex-none font-mono font-semibold text-brand-text tabular-nums">#{turn.number}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={turn.question}>
                  {turn.question}
                </span>
                <span className="flex-none font-mono whitespace-nowrap text-fg-muted tabular-nums">
                  {turn.trace.summary.running ? `${formatDuration(turn.trace.summary.elapsedMs)} ${t("trace.running")}` : formatDuration(turn.trace.summary.elapsedMs)}
                </span>
              </div>
              {turn.trace.spans.length > 0 ? (
                <Waterfall
                  spans={turn.trace.spans}
                  label={t("chat.turnLabel", { n: turn.number, question: turn.question })}
                  selectedId={selectedSpanId}
                  onSelect={onSelectSpan}
                  linkedId={linkedSpanId}
                  onHover={onLink}
                  labelWidth={164}
                  minTotal={20}
                  legend={false}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div
        role="region"
        aria-label={t("chat.spanDetails")}
        tabIndex={0}
        className="max-h-[42%] flex-none overflow-y-auto border-t border-line bg-surface p-3 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
      >
        {selected ? <SpanDetailView span={selected.span} detail={selected.detail} /> : <p className="text-xs text-fg-muted">{t("chat.selectSpan")}</p>}
      </div>

      <dl className="grid flex-none grid-cols-4 gap-2 border-t border-line bg-background px-3 py-2">
        <Summary
          label={t("chat.sumIterations")}
          value={latest ? `${Math.min(latest.trace.summary.iterations, latest.maxIterations)} / ${latest.maxIterations}` : "0"}
        />
        <Summary label={t("chat.sumCalls")} value={String(latest?.trace.summary.toolCalls ?? 0)} />
        <Summary label={t("chat.sumElapsed")} value={latest ? formatDuration(latest.trace.summary.elapsedMs) : "n/a"} />
        <Summary
          label={t("chat.sumTokens")}
          value={tokenSummary(latest?.trace.summary.usage)}
          title={latest?.trace.summary.usage.usage ? undefined : latest && latest.trace.summary.usage.total > 0 ? t("chat.tokNoneTitle") : undefined}
        />
      </dl>
    </section>
  );
}

// 요약 칸의 토큰 합계: 제공자가 알려 준 입력과 출력의 합 (줄임 표기). 알려 준 것이 없으면 n/a.
function tokenSummary(usage: { usage: { input: number; output: number } | null } | undefined): string {
  return usage?.usage ? formatCompact(usage.usage.input + usage.usage.output) : "n/a";
}

function Summary({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="grid min-w-0 gap-0" title={title}>
      <dt className="truncate font-mono text-[10px] tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-normal">{label}</dt>
      <dd className="font-mono text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

const STATUS_TONE: Record<SpanStatus, ChipTone> = { ok: "ok", error: "err", running: "info", waiting: "warn", cancelled: "neutral" };
const STATUS_ICON = { ok: CheckIcon, error: TriangleAlertIcon, running: ClockIcon, waiting: ClockIcon, cancelled: CircleSlashIcon };
const STATUS_KEY: Record<SpanStatus, TKey> = {
  ok: "trace.statusOk",
  error: "trace.statusError",
  running: "trace.statusRunning",
  waiting: "trace.statusWaiting",
  cancelled: "trace.statusCancelled",
};
const DECISION_KEY: Record<Extract<SpanDetailData, { kind: "wait" }>["decision"], TKey> = {
  pending: "chat.decisionPending",
  approved: "chat.decisionApproved",
  denied: "chat.decisionDenied",
};
const OUTCOME_KEY: Record<Extract<SpanDetailData, { kind: "llm" }>["outcome"], TKey> = {
  tool_use: "chat.outcomeToolUse",
  end_turn: "chat.outcomeEndTurn",
  error: "chat.outcomeError",
  cancelled: "chat.outcomeCancelled",
  running: "chat.outcomeRunning",
};

function SpanDetailView({ span, detail }: { span: TraceSpan; detail: SpanDetailData }) {
  const t = useT();
  const StatusIcon = STATUS_ICON[span.status];
  const KindIcon = KIND_ICON[span.kind];
  const heading = detail.kind === "llm" ? detail.model : detail.server ? `${detail.server} / ${detail.tool}` : detail.tool;

  // 서버, 도구, 모델 이름은 머리의 제목에 이미 있어서 표에는 시간과 반복 정보만 둔다.
  let items: [string, string][];
  if (detail.kind === "tool") {
    items = [
      [t("chat.spanDuration"), formatDuration(span.dur)],
      [t("chat.spanStart"), `+${formatDuration(span.start)}`],
    ];
  } else if (detail.kind === "wait") {
    // 승인 대기는 사용자가 결정하는 시간이라 도구 실행 시간과 따로 센다.
    items = [
      [t("chat.spanWaited"), formatDuration(span.dur)],
      [t("chat.spanDecision"), detail.auto ? t("chat.decisionApproved") : t(DECISION_KEY[detail.decision])],
      [t("chat.spanStart"), `+${formatDuration(span.start)}`],
    ];
  } else {
    items = [
      [t("chat.spanIteration"), String(detail.iteration)],
      [t("chat.spanDuration"), formatDuration(span.dur)],
      [t("chat.spanEnded"), t(OUTCOME_KEY[detail.outcome])],
      [t("chat.spanToolCalls"), String(detail.toolCalls)],
      [t("chat.spanStart"), `+${formatDuration(span.start)}`],
    ];
    // 토큰은 제공자가 알려 준 값만 보인다. 알려 주지 않았으면 "보고되지 않음", 아직 진행 중이면 칸을 두지 않는다.
    if (detail.usage) {
      items.push([t("chat.spanInputTokens"), formatCount(detail.usage.input)], [t("chat.spanOutputTokens"), formatCount(detail.usage.output)]);
      // 캐시 토큰은 캐시를 실제로 쓴 요청에서만 보인다 (제공자가 0 을 보고하면 줄을 늘리지 않는다).
      if ((detail.usage.cacheRead ?? 0) > 0 || (detail.usage.cacheWrite ?? 0) > 0) {
        items.push([t("chat.spanCacheRead"), formatCount(detail.usage.cacheRead ?? 0)], [t("chat.spanCacheWrite"), formatCount(detail.usage.cacheWrite ?? 0)]);
      }
    } else if (detail.usage === null) {
      items.push([t("chat.sumTokens"), t("chat.spanNotReported")]);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Chip
          className="pl-2"
          style={{ boxShadow: `inset 3px 0 0 var(--span-${span.kind === "db" ? "proxy" : span.kind})` }}
        >
          <KindIcon aria-hidden />
          {t(KIND_LABEL[span.kind])}
        </Chip>
        <h3 className="min-w-0 font-mono text-sm font-semibold [overflow-wrap:anywhere]">{heading}</h3>
        <Chip tone={STATUS_TONE[span.status]}>
          <StatusIcon aria-hidden />
          {t(STATUS_KEY[span.status])}
        </Chip>
      </div>

      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-2">
        {items.map(([k, v]) => (
          <div key={k} className="grid min-w-0 gap-px">
            <dt className="font-mono text-[10px] text-fg-muted">{k}</dt>
            <dd className={cn("m-0 font-mono text-xs tabular-nums [overflow-wrap:anywhere]")}>{v}</dd>
          </div>
        ))}
      </dl>

      {detail.kind === "tool" ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <ToolInput input={detail.toolUse.input} />
          {detail.toolUse.result ? <ToolResult content={detail.toolUse.result.content} isError={detail.toolUse.result.isError} /> : null}
        </div>
      ) : null}
    </div>
  );
}
