"use client";

// 대화 한 건 (사용자 또는 어시스턴트). final.html 의 .msg 문법을 따른다: 24px 아바타, 머리(이름, 시각), 본문.
// 어시스턴트 본문은 반복(iteration)마다 Markdown 텍스트와 도구 호출 카드를 순서대로 놓고,
// 중지와 반복 한도, LLM 오류는 알림(alert)으로 알린다. 끝난 메시지에는 푸터(도구 호출 수, 시간, 복사)가 붙는다.

import { BotIcon, CircleAlertIcon, HandIcon, UserIcon } from "lucide-react";

import { CopyIconButton } from "@/components/dashboard/CopyCommand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatClock, formatCount } from "@/lib/chat/format";
import { joinIterationTexts, pendingApprovals, type AssistantTurn, type ChatTurn, type UserTurn } from "@/lib/chat/serialize";
import { toolSpanId, waitSpanId, type TurnTrace } from "@/lib/chat/trace";
import { useT } from "@/lib/i18n/client";
import { DEFAULT_MAX_ITERATIONS } from "@/lib/llm/constants";
import { formatDuration } from "@/lib/trace/scale";
import { cn } from "@/lib/utils";

import { ChatMarkdown } from "./LazyMarkdown";
import { ToolCard, toolCardStatus, type TurnPhase } from "./ToolCard";

export interface LinkProps {
  selectedSpanId: string | null;
  linkedSpanId: string | null;
  onLink: (spanId: string | null) => void;
  onShowInTrace: (spanId: string) => void;
  // 수동 승인 모드: 호출 하나의 결정, 대기 중인 호출 전체의 결정
  onDecide: (toolUseId: string, decision: "approve" | "deny", always: boolean) => void;
  onDecideAll: (decision: "approve" | "deny") => void;
}

interface MessageCardProps extends LinkProps {
  turn: ChatTurn;
  // 진행 중인 어시스턴트 메시지 (본문 끝에 깜빡이는 커서, 끝나면 푸터가 붙음)
  streaming?: boolean;
  trace?: TurnTrace;
  // 진행 중일 때 머리에 보일 모델 이름 (turn.model 은 끝난 뒤에 채워진다)
  model?: string;
}

export function MessageCard({ turn, streaming = false, trace, model, ...link }: MessageCardProps) {
  if (turn.role === "user") return <UserMessage turn={turn} />;
  return <AssistantMessage turn={turn} streaming={streaming} trace={trace} model={model} {...link} />;
}

function Avatar({ kind }: { kind: "user" | "assistant" }) {
  const Icon = kind === "user" ? UserIcon : BotIcon;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 place-items-center rounded-sm border max-[901px]:hidden",
        kind === "assistant" ? "border-brand-border bg-brand-subtle text-brand-text" : "border-line bg-background text-fg-muted",
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

const ROW = "grid grid-cols-[24px_minmax(0,1fr)] gap-3 max-[901px]:grid-cols-[minmax(0,1fr)] max-[901px]:gap-1.5";
const HEAD = "flex min-h-6 flex-wrap items-center gap-2 font-mono text-2xs text-fg-muted";

function UserMessage({ turn }: { turn: UserTurn }) {
  const t = useT();
  const time = formatClock(turn.at, t.locale);
  return (
    <article className={ROW}>
      <Avatar kind="user" />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
        <header className={HEAD}>
          <b className="font-semibold text-foreground">{t("chat.you")}</b>
          {time ? <time className="tabular-nums">{time}</time> : null}
          <span className="ml-auto">
            <CopyIconButton text={turn.content} label={t("chat.copyMessage")} />
          </span>
        </header>
        <div className="max-w-full justify-self-start rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-base whitespace-pre-wrap [overflow-wrap:anywhere]">
          {turn.content}
        </div>
      </div>
    </article>
  );
}

function AssistantMessage({
  turn,
  streaming,
  trace,
  model,
  selectedSpanId,
  linkedSpanId,
  onLink,
  onShowInTrace,
  onDecide,
  onDecideAll,
}: {
  turn: AssistantTurn;
  streaming: boolean;
  trace?: TurnTrace;
  model?: string;
} & LinkProps) {
  const t = useT();
  const time = formatClock(turn.startedAt, t.locale);
  const spanById = new Map(trace?.spans.map((s) => [s.id, s]));
  const text = joinIterationTexts(turn);
  const lastIndex = turn.iterations.length - 1;
  const lastIteration = turn.iterations[lastIndex];
  const hasToolRunning = streaming && turn.iterations.some((it) => it.toolUses.some((tool) => tool.result === null));
  // 모델이 말을 시작하기 전(또는 도구 결과를 읽는 중)에는 "생각하는 중" 표시
  const thinking = streaming && !hasToolRunning && (lastIteration?.text.length ?? 0) === 0;
  const calls = trace?.summary.toolCalls ?? turn.iterations.reduce((n, it) => n + it.toolUses.length, 0);
  const isEmpty = text.length === 0 && calls === 0;
  const phase: TurnPhase = streaming ? "running" : turn.stopReason === "awaiting_approval" ? "awaiting" : "ended";
  const pendingCount = phase === "awaiting" ? pendingApprovals(turn).length : 0;
  const usage = trace?.summary.usage;
  const waitMs = trace?.summary.waitMs ?? 0;

  return (
    <article className={ROW}>
      <Avatar kind="assistant" />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <header className={HEAD}>
          <b className="font-semibold text-foreground">{turn.model ?? model ?? "LLM"}</b>
          {time ? <time className="tabular-nums">{time}</time> : null}
        </header>

        {turn.iterations.map((it, i) => (
          <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 empty:hidden">
            {it.text.length > 0 ? (
              <div>
                <ChatMarkdown text={it.text} />
                {streaming && i === lastIndex && it.toolUses.length === 0 ? <Caret /> : null}
              </div>
            ) : null}
            {it.toolUses.map((tool) => {
              // 실행 전(승인 대기, 거부)인 호출은 도구 스팬이 없어서 승인 스팬에 연결한다.
              const spanId =
                tool.startT !== undefined
                  ? toolSpanId(turn.id, tool.id)
                  : tool.approval && !tool.approval.auto
                    ? waitSpanId(turn.id, tool.id)
                    : null;
              const span = spanId ? spanById.get(spanId) : undefined;
              const status = toolCardStatus(tool, phase);
              return (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  status={status}
                  spanId={spanId}
                  durationMs={span && span.kind === "tool" && status !== "running" && status !== "cancelled" ? span.dur : null}
                  linked={spanId !== null && linkedSpanId === spanId}
                  selected={spanId !== null && selectedSpanId === spanId}
                  onLink={onLink}
                  onShowInTrace={onShowInTrace}
                  onDecide={onDecide}
                />
              );
            })}
          </div>
        ))}

        {pendingCount >= 2 ? (
          <div role="group" aria-label={t("chat.pendingTitle")} className="flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 text-foreground">{t("chat.pendingCount", { n: pendingCount })}</span>
            <Button type="button" size="sm" onClick={() => onDecideAll("approve")} className="max-[901px]:h-9">
              {t("chat.approveAll")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onDecideAll("deny")} className="max-[901px]:h-9">
              {t("chat.denyAll")}
            </Button>
          </div>
        ) : null}

        {thinking ? (
          <div className="flex h-[22px] items-center gap-1.5 font-mono text-2xs text-fg-muted" role="presentation">
            <Caret />
            {t("chat.thinking")}
          </div>
        ) : null}

        {!streaming && isEmpty && turn.stopReason === "end_turn" ? (
          <p className="text-xs text-fg-muted italic">{t("chat.emptyResponse")}</p>
        ) : null}

        {!streaming && turn.expired ? (
          <Alert role="status" className="border-warning-border bg-warning-bg text-xs" data-approval-expired>
            <CircleAlertIcon aria-hidden className="text-warning-fg" />
            <AlertDescription className="text-foreground">{t("chat.approvalExpired")}</AlertDescription>
          </Alert>
        ) : null}
        {!streaming && turn.stopReason === "aborted" && !turn.expired ? (
          <Alert role="status" className="border-line-strong text-xs">
            <HandIcon aria-hidden />
            <AlertDescription className="text-foreground">{t("chat.stoppedByYou")}</AlertDescription>
          </Alert>
        ) : null}
        {!streaming && turn.stopReason === "max_iterations" ? (
          <Alert role="status" className="border-warning-border bg-warning-bg text-xs">
            <CircleAlertIcon aria-hidden className="text-warning-fg" />
            <AlertDescription className="text-foreground">
              {t("chat.stoppedAfter", { n: turn.maxIterations ?? DEFAULT_MAX_ITERATIONS })}
            </AlertDescription>
          </Alert>
        ) : null}
        {!streaming && turn.stopReason === "error" ? (
          <Alert variant="destructive" role="status" className="border-danger-border bg-danger-bg text-xs">
            <CircleAlertIcon aria-hidden className="text-danger-fg" />
            <AlertDescription className="text-danger-fg">
              {t("chat.llmError", { error: turn.error ?? t("chat.unknownCause") })}
            </AlertDescription>
          </Alert>
        ) : null}

        {!streaming ? (
          <footer className="flex min-h-6 flex-wrap items-center gap-3 font-mono text-2xs text-fg-muted tabular-nums">
            {trace && trace.summary.elapsedMs > 0 ? <span>{formatDuration(trace.summary.elapsedMs)}</span> : null}
            {calls > 0 ? <span>{t("chat.footCalls", { n: calls })}</span> : null}
            {waitMs > 0 ? <span>{t("chat.footWaited", { time: formatDuration(waitMs) })}</span> : null}
            {usage && usage.total > 0 ? (
              usage.usage ? (
                <span data-testid="turn-tokens">
                  {t(usage.reported < usage.total ? "chat.footTokensPartial" : "chat.footTokens", {
                    in: formatCount(usage.usage.input),
                    out: formatCount(usage.usage.output),
                  })}
                </span>
              ) : (
                <span data-testid="turn-tokens">{t("chat.footTokensNone")}</span>
              )
            ) : null}
            {text.length > 0 ? <CopyIconButton text={text} label={t("chat.copyMessage")} /> : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="mcpc-blink ml-0.5 inline-block h-[13px] w-[7px] animate-[mcpc-blink_1s_steps(2,start)_infinite] bg-brand align-[-2px]"
    />
  );
}
