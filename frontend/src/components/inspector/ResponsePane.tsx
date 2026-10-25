"use client";

// 응답 패널: 탭(내용 / 소요 시간), 상태 줄(배지, 메서드, id, 시간, 크기, JSON 복사), 내용 블록, 오류 안내, 워터폴.
// JSON-RPC 원문 탭은 Phase 5-A 에서 더한다.

import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BracesIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  BanIcon,
  DatabaseIcon,
  WaypointsIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCopy } from "@/components/dashboard/CopyCommand";
import { ResponseSkeleton } from "@/components/skeletons/screens";
import { Waterfall, WaterfallLegend, kindsPresent } from "@/components/trace/Waterfall";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsApple } from "@/components/shell/shortcuts";
import { useT } from "@/lib/i18n/client";
import { errorHint, joinText } from "@/lib/inspector/errors";
import { formatBytes } from "@/lib/inspector/json-tokens";
import { formatDuration } from "@/lib/trace/scale";
import { buildCallSpans } from "@/lib/trace/timing";
import { contentsToBlock, sampleDataNotice } from "@/lib/inspector/content";
import type { CallDetail, CallOutcome, CallToolPayload, GetPromptPayload, ReadResourcePayload } from "@/lib/mcp/types";
import { cn } from "@/lib/utils";

import { ContentBlock, JsonCode, StructuredBlock } from "./ResponseBlocks";
import type { CallPayload, CallRecord, ResponseView } from "./types";

export type ResponseTab = "content" | "timing";

interface ResponsePaneProps {
  view: ResponseView;
  tab: ResponseTab;
  onTab: (tab: ResponseTab) => void;
}

const BADGE: Record<
  CallOutcome,
  { tone: ChipTone; icon: typeof CheckIcon; label: "inspector.badgeOk" | "inspector.badgeError" | "inspector.badgeRpcError" | "inspector.badgeCancelled" | "inspector.badgeTransport" }
> = {
  ok: { tone: "ok", icon: CheckIcon, label: "inspector.badgeOk" },
  "tool-error": { tone: "err", icon: AlertCircleIcon, label: "inspector.badgeError" },
  "rpc-error": { tone: "err", icon: AlertCircleIcon, label: "inspector.badgeRpcError" },
  cancelled: { tone: "warn", icon: BanIcon, label: "inspector.badgeCancelled" },
  transport: { tone: "err", icon: AlertTriangleIcon, label: "inspector.badgeTransport" },
};

export function ResponsePane({ view, tab, onTab }: ResponsePaneProps) {
  const t = useT();
  const apple = useIsApple();

  return (
    <section aria-label={t("inspector.paneResponse")} className="flex h-full min-h-0 flex-col bg-surface">
      <Tabs value={tab} onValueChange={(v) => onTab(v as ResponseTab)} className="min-h-0 flex-1 gap-0">
        <div className="flex h-9 flex-none items-stretch border-b border-line px-3">
          <TabsList variant="line" aria-label={t("inspector.paneResponse")} className="h-full gap-3 p-0">
            <TabsTrigger value="content" className="min-w-6 flex-none px-1 font-mono text-2xs">
              {t("inspector.tabContent")}
            </TabsTrigger>
            <TabsTrigger value="timing" className="min-w-6 flex-none px-1 font-mono text-2xs">
              {t("inspector.tabTiming")}
            </TabsTrigger>
          </TabsList>
        </div>

        {view.kind === "done" ? <StatusRow record={view} /> : null}
        {view.kind === "running" ? <RunningRow tool={view.tool} method={view.method} /> : null}

        <TabsContent value="content" className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
          {view.kind === "idle" ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BracesIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{t("inspector.idleTitle")}</EmptyTitle>
                <EmptyDescription>{t("inspector.idleBody", { key: apple ? "⌘↵" : "Ctrl+↵" })}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : view.kind === "running" ? (
            <div className="grid gap-3">
              <p className="flex items-center gap-2 font-mono text-xs text-fg-muted" role="status">
                <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
                {t("inspector.waiting", { method: view.method })}
              </p>
              <ResponseSkeleton label={t("inspector.waiting", { method: view.method })} />
            </div>
          ) : (
            <DoneContent record={view} />
          )}
        </TabsContent>

        <TabsContent value="timing" className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
          {view.kind === "done" ? (
            <TimingView record={view} />
          ) : (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ClockIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{view.kind === "running" ? t("inspector.waiting", { method: view.method }) : t("inspector.idleTitle")}</EmptyTitle>
                <EmptyDescription>{t("inspector.timingEmpty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function detailOf(record: CallRecord): CallDetail<CallPayload> {
  return (
    record.result.detail ?? {
      outcome: record.result.isError ? "tool-error" : "ok",
      elapsedMs: record.result.durationMs,
    }
  );
}

function RunningRow({ tool, method }: { tool: string; method: string }) {
  const t = useT();
  return (
    <div className="flex min-h-9 flex-none flex-wrap items-center gap-2 border-b border-line bg-background px-4 py-2 font-mono text-2xs text-fg-muted">
      <Chip tone="info">
        <Spinner aria-hidden="true" role="presentation" className="size-3" />
        {t("trace.running")}
      </Chip>
      <span>{method}</span>
      <span className="min-w-0 truncate text-foreground">{tool}</span>
    </div>
  );
}

function StatusRow({ record }: { record: CallRecord }) {
  const t = useT();
  const copy = useCopy();
  const detail = detailOf(record);
  const badge = BADGE[detail.outcome];
  const Icon = badge.icon;
  const copyText = JSON.stringify(detail.payload ?? { error: detail.errorMessage ?? String(record.result.content) }, null, 2);

  return (
    <div className="flex min-h-9 flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-background px-4 py-1.5 font-mono text-2xs text-fg-muted">
      <Chip tone={badge.tone}>
        <Icon aria-hidden />
        {t(badge.label)}
      </Chip>
      <span>{record.method}</span>
      {detail.requestId !== undefined ? (
        <span>
          id <b className="font-normal text-foreground tabular-nums">{String(detail.requestId)}</b>
        </span>
      ) : null}
      <span>
        {t("inspector.kvTime")} <b className="font-normal text-foreground tabular-nums">{formatDuration(detail.elapsedMs)}</b>
      </span>
      {detail.bytes !== undefined ? (
        <span>
          {t("inspector.kvSize")} <b className="font-normal text-foreground tabular-nums">{formatBytes(detail.bytes)}</b>
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="ml-auto"
        aria-label={t("inspector.copyResponse")}
        title={t("inspector.copyResponse")}
        onClick={() => void copy(copyText)}
      >
        <CopyIcon />
      </Button>
    </div>
  );
}

function DoneContent({ record }: { record: CallRecord }) {
  const t = useT();
  const detail = detailOf(record);

  if (detail.outcome === "cancelled") {
    return (
      <Alert role="status" className="border-warning-border bg-warning-bg text-warning-fg">
        <BanIcon aria-hidden />
        <AlertTitle>{t("inspector.cancelledTitle")}</AlertTitle>
        <AlertDescription className="text-warning-fg">
          {t(detail.cancelNotified ? "inspector.cancelledBody" : "inspector.cancelledUnconfirmed", {
            id: detail.requestId !== undefined ? String(detail.requestId) : "?",
          })}
        </AlertDescription>
      </Alert>
    );
  }

  if (detail.outcome === "transport") {
    return (
      <Alert className="border-danger-border bg-danger-bg text-danger-fg">
        <AlertTriangleIcon aria-hidden />
        <AlertTitle>{t("inspector.transportTitle")}</AlertTitle>
        <AlertDescription className="grid gap-2 text-danger-fg">
          <p>{t("inspector.transportBody")}</p>
          <pre tabIndex={0} className="max-h-40 overflow-auto rounded-sm border border-danger-border/50 bg-surface p-2 font-mono text-2xs break-words whitespace-pre-wrap text-foreground">
            {detail.errorMessage ?? String(record.result.content)}
          </pre>
          <div>
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("inspector.goDashboard")}
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (detail.outcome === "rpc-error") {
    return (
      <Alert className="border-danger-border bg-danger-bg text-danger-fg">
        <AlertCircleIcon aria-hidden />
        <AlertTitle>{t("inspector.rpcErrorTitle")}</AlertTitle>
        <AlertDescription className="grid gap-2 text-danger-fg">
          {detail.errorCode !== undefined ? <Chip tone="err" className="justify-self-start">{detail.errorCode}</Chip> : null}
          <p>{t("inspector.rpcErrorBody")}</p>
          <pre tabIndex={0} className="max-h-40 overflow-auto rounded-sm border border-danger-border/50 bg-surface p-2 font-mono text-2xs break-words whitespace-pre-wrap text-foreground">
            {detail.errorMessage}
          </pre>
        </AlertDescription>
      </Alert>
    );
  }

  if (record.method === "resources/read") return <ResourceContent payload={(detail.payload ?? {}) as ReadResourcePayload} />;
  if (record.method === "prompts/get") return <PromptContent payload={(detail.payload ?? {}) as GetPromptPayload} />;

  const payload = (detail.payload ?? {}) as CallToolPayload;
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const isError = detail.outcome === "tool-error";
  const { code, hintKey } = isError ? errorHint(joinText(blocks)) : { code: null, hintKey: null };
  const sample = isError ? null : sampleDataNotice(payload.structuredContent);

  return (
    <div className="grid gap-3">
      {sample !== null ? (
        <Alert className="border-warning-border bg-warning-bg" data-sample-notice>
          <DatabaseIcon aria-hidden className="text-warning-fg" />
          <AlertTitle className="text-foreground">{t("inspector.sampleDataTitle")}</AlertTitle>
          <AlertDescription className="text-foreground">{sample || t("inspector.sampleDataBody")}</AlertDescription>
        </Alert>
      ) : null}
      {isError ? (
        <Alert className="border-danger-border bg-danger-bg text-danger-fg">
          <AlertCircleIcon aria-hidden />
          <AlertTitle>{t("inspector.isErrorTitle")}</AlertTitle>
          <AlertDescription className="grid gap-1.5 text-danger-fg">
            {code ? (
              <Chip tone="err" className="justify-self-start bg-surface text-xs" data-error-code={code}>
                [{code}]
              </Chip>
            ) : null}
            <p>{t("inspector.isErrorBody")}</p>
            {hintKey ? <p className="font-semibold">{t(hintKey)}</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {blocks.map((block, i) => (
        <ContentBlock key={i} block={block} index={i} />
      ))}
      {payload.structuredContent !== undefined ? <StructuredBlock value={payload.structuredContent} /> : null}
      {blocks.length === 0 && payload.structuredContent === undefined ? (
        <>
          <p className="text-fg-muted">{t("inspector.noContent")}</p>
          <div className="overflow-hidden rounded-md border border-line">
            <JsonCode text={JSON.stringify(payload, null, 2)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

// resources/read: contents[i] 를 content 블록과 같은 렌더러로 그린다 (text, JSON, Markdown, 이미지 blob).
function ResourceContent({ payload }: { payload: ReadResourcePayload }) {
  const t = useT();
  const contents = Array.isArray(payload.contents) ? payload.contents : [];
  if (contents.length === 0) {
    return (
      <>
        <p className="text-fg-muted">{t("inspector.noContents")}</p>
        <div className="mt-3 overflow-hidden rounded-md border border-line">
          <JsonCode text={JSON.stringify(payload, null, 2)} />
        </div>
      </>
    );
  }
  return (
    <div className="grid gap-3">
      {contents.map((item, i) => (
        <ContentBlock key={i} block={contentsToBlock(item)} index={i} prefix="contents" />
      ))}
    </div>
  );
}

// prompts/get: description 과 messages[i] (역할 칩 + content 블록)
function PromptContent({ payload }: { payload: GetPromptPayload }) {
  const t = useT();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return (
    <div className="grid gap-3">
      {payload.description ? (
        <p className="text-xs text-fg-muted">
          <span className="font-mono">{t("inspector.promptDescription")}</span> {payload.description}
        </p>
      ) : null}
      {messages.length === 0 ? <p className="text-fg-muted">{t("inspector.noMessages")}</p> : null}
      {messages.map((message, i) => (
        <div key={i} className="grid gap-1" data-message-role={message.role}>
          <div className="flex items-center gap-2 font-mono text-2xs text-fg-muted">
            <span>{t("inspector.messagesTitle")}[{i}]</span>
            <Chip tone={message.role === "assistant" ? "brand" : "info"}>{message.role}</Chip>
          </div>
          <ContentBlock block={message.content} index={0} label={`messages[${i}].content`} />
        </div>
      ))}
    </div>
  );
}

function TimingView({ record }: { record: CallRecord }) {
  const t = useT();
  const detail = detailOf(record);
  const [selected, setSelected] = useState<string | null>(null);

  const spans = useMemo(
    () =>
      buildCallSpans({
        totalMs: detail.elapsedMs,
        outcome: detail.outcome,
        timing: detail.proxyTiming ?? null,
        path: record.endpoint,
        labels: {
          browser: t("inspector.spanBrowser"),
          proxy: t("inspector.spanProxy"),
          upstream: t("inspector.spanUpstream"),
          network: t("inspector.spanNetwork"),
        },
      }),
    [detail.elapsedMs, detail.outcome, detail.proxyTiming, record.endpoint, t],
  );
  const chosen = spans.find((s) => s.id === selected) ?? null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 font-mono text-2xs text-fg-muted">
        <WaypointsIcon aria-hidden className="size-3.5" />
        <span>{t("inspector.timingTitle")}</span>
        <span className="ml-auto tabular-nums">
          {t("inspector.timingTotal")} <b className="font-medium text-foreground">{formatDuration(detail.elapsedMs)}</b>
        </span>
      </div>
      <div className={cn("overflow-hidden rounded-md border border-line bg-surface-sunken")}>
        <Waterfall
          spans={spans}
          label={t("inspector.timingTrace")}
          selectedId={selected}
          onSelect={setSelected}
          labelWidth={176}
          legend={false}
          minTotal={2}
        />
      </div>
      <WaterfallLegend kinds={kindsPresent(spans)} className="mt-0 px-0" />
      {chosen ? (
        <p className="font-mono text-2xs text-fg-muted tabular-nums" role="status">
          <b className="font-medium text-foreground">{chosen.label}</b>
          {chosen.sub ? ` ${chosen.sub}` : ""},{" "}
          {t("inspector.spanRange", {
            from: formatDuration(chosen.start),
            to: formatDuration(chosen.start + chosen.dur),
            dur: formatDuration(chosen.dur),
          })}
        </p>
      ) : null}
      <p className="text-2xs leading-4 text-fg-muted">{detail.proxyTiming ? t("inspector.timingNote") : t("inspector.timingNoProxy")}</p>
    </div>
  );
}
