"use client";

// 요청 패널: 머리(메서드 칩, 도구명, Form/JSON 전환, 설명, 서버 칩, readOnlyHint, 엔드포인트), 입력 본문, 실행 바.

import { BracesIcon, PlayIcon, PlugIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useIsApple } from "@/components/shell/shortcuts";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import { missingRequired, parseRawArgs, requiredNames, type FieldErrors, type FieldSpec } from "@/lib/inspector/args";
import type { InputMode, ToolDraft } from "@/lib/inspector/draft";
import { formatDuration } from "@/lib/trace/scale";
import type { ToolMeta } from "@/lib/mcp/types";

import { SchemaForm } from "./SchemaForm";

// 실행 바에 보이는 상태. 실행 중이면 startedAt 으로 경과 시간을 센다.
export type RunStatus =
  | { kind: "ready" }
  | { kind: "running"; startedAt: number }
  | { kind: "done"; ms: number }
  | { kind: "cancelled"; ms: number };

interface RequestPaneProps {
  tool: ToolMeta | null;
  serverName: string;
  endpoint: string;
  fields: readonly FieldSpec[];
  draft: ToolDraft | null;
  errors: FieldErrors;
  onField: (name: string, value: string | boolean) => void;
  onRaw: (text: string) => void;
  onMode: (mode: InputMode) => void;
  status: RunStatus;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function RequestPane({
  tool,
  serverName,
  endpoint,
  fields,
  draft,
  errors,
  onField,
  onRaw,
  onMode,
  status,
  onRun,
  onCancel,
  onReset,
}: RequestPaneProps) {
  const t = useT();

  if (!tool || !draft) {
    return (
      <section aria-label={t("inspector.paneRequest")} className="flex h-full min-h-0 flex-col bg-surface">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BracesIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("inspector.pickTool")}</EmptyTitle>
            <EmptyDescription>{t("inspector.pickToolHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    );
  }

  return (
    <section aria-label={t("inspector.paneRequest")} className="flex h-full min-h-0 flex-col bg-surface">
      <header className="grid flex-none gap-1 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 max-[1081px]:flex-nowrap max-[1081px]:gap-1.5">
          <Chip tone="brand" className="max-[1081px]:hidden">
            tools/call
          </Chip>
          <h2 className="min-w-0 font-display text-md font-semibold [overflow-wrap:anywhere] max-[1081px]:flex-1 max-[1081px]:truncate max-[1081px]:text-sm max-[1081px]:tracking-tight max-[1081px]:[overflow-wrap:normal]">
            {tool.name}
          </h2>
          <div role="group" aria-label={t("inspector.inputMode")} className="ml-auto inline-flex flex-none overflow-hidden rounded-lg border border-input">
            {(["form", "json"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.mode === mode}
                onClick={() => mode !== draft.mode && onMode(mode)}
                className={
                  "h-7 min-w-[26px] px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 " +
                  (draft.mode === mode ? "bg-muted text-foreground" : "text-fg-muted hover:bg-muted/60 hover:text-foreground")
                }
              >
                {t(mode === "form" ? "inspector.modeForm" : "inspector.modeJson")}
              </button>
            ))}
          </div>
        </div>
        {tool.description ? <p className="line-clamp-4 text-xs leading-[18px] text-fg-muted">{tool.description}</p> : null}
        <div className="flex flex-wrap items-center gap-1">
          <Chip tone="brand" className="hidden max-[1081px]:inline-flex">
            tools/call
          </Chip>
          <Chip>
            <PlugIcon aria-hidden />
            {serverName}
          </Chip>
          {tool.annotations?.readOnlyHint ? <Chip tone="info">readOnlyHint</Chip> : null}
          <Chip>POST {endpoint}</Chip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {draft.mode === "json" ? (
          <RawJsonEditor fields={fields} text={draft.raw} onChange={onRaw} />
        ) : (
          <SchemaForm toolName={tool.name} fields={fields} values={draft.values} errors={errors} onChange={onField} />
        )}
      </div>

      <RunBar status={status} onRun={onRun} onCancel={onCancel} onReset={onReset} />
    </section>
  );
}

function RawJsonEditor({ fields, text, onChange }: { fields: readonly FieldSpec[]; text: string; onChange: (text: string) => void }) {
  const t = useT();
  const parsed = parseRawArgs(text);
  const required = requiredNames(fields);
  const missing = parsed.ok ? missingRequired(fields, parsed.value) : [];

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor="inspector-raw-args" className="font-mono text-xs font-medium text-foreground">
          {t("inspector.rawLabel")}
        </label>
        <Chip>object</Chip>
      </div>
      <Textarea
        id="inspector-raw-args"
        rows={12}
        spellCheck={false}
        value={text}
        aria-invalid={parsed.ok ? undefined : true}
        aria-describedby="inspector-raw-err inspector-raw-hint"
        onChange={(e) => onChange(e.target.value)}
        className="min-h-60 font-mono text-xs leading-5 [font-variant-ligatures:none]"
      />
      <p id="inspector-raw-err" role={parsed.ok ? undefined : "alert"} className="text-2xs leading-4 text-danger-fg empty:hidden">
        {parsed.ok ? null : t("inspector.rawInvalid", { message: parsed.message })}
      </p>
      <p id="inspector-raw-hint" className="text-2xs leading-4 text-fg-muted">
        {required.length > 0 ? t("inspector.rawRequired", { keys: required.join(", ") }) : t("inspector.rawNoRequired")}
        {missing.length > 0 ? <span className="ml-2 text-warning-fg">{t("inspector.rawMissing", { keys: missing.join(", ") })}</span> : null}
      </p>
    </div>
  );
}

export function RunBar({
  status,
  onRun,
  onCancel,
  onReset,
  runLabel,
}: {
  status: RunStatus;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
  // 실행 버튼 글자 (도구는 Run, 리소스는 Read, 프롬프트는 Get)
  runLabel?: string;
}) {
  const t = useT();
  const apple = useIsApple();
  const running = status.kind === "running";

  return (
    // 버튼 세 개는 한 줄로 묶고(줄바꿈 없음), 막대 폭(@container)이 좁으면 단축키 표시를 먼저 숨기고 Reset 은 아이콘만 남긴다.
    // 1200px 의 3분할처럼 요청 칸이 좁아도 Reset 이 Run, Cancel 아래로 떨어지지 않는다. 경과 시간만 필요하면 다음 줄로 간다.
    <div className="@container flex min-h-12 flex-none flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-background px-4 py-2">
      <div className="flex flex-none items-center gap-2">
        <Button type="button" onClick={onRun} disabled={running} className="gap-1.5" data-action="run">
          {running ? <Spinner aria-hidden="true" role="presentation" className="size-3.5" /> : <PlayIcon aria-hidden className="size-3.5" />}
          {runLabel ?? t("inspector.run")}
          <Kbd aria-hidden className="bg-primary-foreground/20 text-primary-foreground max-[901px]:hidden @max-[440px]:hidden">
            {apple ? "⌘↵" : "Ctrl+↵"}
          </Kbd>
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={!running} className="gap-1.5" data-action="cancel">
          <SquareIcon aria-hidden className="size-3.5 fill-current" />
          {t("inspector.cancel")}
          <Kbd aria-hidden className="max-[901px]:hidden @max-[440px]:hidden">
            Esc
          </Kbd>
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={running}
          title={t("inspector.resetArgs")}
          className="gap-1.5 @max-[300px]:px-2"
          data-action="reset"
        >
          <RotateCcwIcon aria-hidden className="size-3.5" />
          <span className="@max-[300px]:sr-only">{t("inspector.resetArgs")}</span>
        </Button>
      </div>
      <Elapsed status={status} />
    </div>
  );
}

// 경과 시간. 눈에 보이는 숫자는 0.1초마다 갱신하지만(aria-hidden), 스크린 리더용 라이브 영역은 1초에 한 번만 바뀐다.
function Elapsed({ status }: { status: RunStatus }) {
  const t = useT();
  const [now, setNow] = useState(() => performance.now());
  const startedAt = status.kind === "running" ? status.startedAt : null;

  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  let visible: string;
  let announced: string;
  if (status.kind === "running") {
    const ms = Math.max(0, now - status.startedAt);
    visible = t("inspector.runningFor", { s: `${(ms / 1000).toFixed(1)} s` });
    announced = t("inspector.runningFor", { s: `${Math.floor(ms / 1000)} s` });
  } else if (status.kind === "done") {
    visible = announced = t("inspector.finishedIn", { t: formatDuration(status.ms) });
  } else if (status.kind === "cancelled") {
    visible = announced = t("inspector.cancelledAfter", { t: formatDuration(status.ms) });
  } else {
    visible = announced = t("inspector.ready");
  }

  return (
    <span
      className={
        "ml-auto font-mono text-2xs whitespace-nowrap tabular-nums " + (status.kind === "running" ? "text-warning-fg" : "text-fg-muted")
      }
      data-elapsed
    >
      <span aria-hidden="true">{visible}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {announced}
      </span>
    </span>
  );
}
