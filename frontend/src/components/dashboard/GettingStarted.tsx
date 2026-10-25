"use client";

import { CheckIcon, ChevronRightIcon, CopyIcon, FileJsonIcon, MessageSquareIcon, RocketIcon, SquareTerminalIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode, type Ref } from "react";

import { useShell } from "@/components/shell/shell-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useT } from "@/lib/i18n/client";
import {
  STEP_IDS,
  countDone,
  type GettingStartedState,
  type StepId,
} from "@/lib/onboarding/getting-started";
import { useHydrated } from "@/lib/onboarding/use-getting-started";
import { cn } from "@/lib/utils";

import { useCopy } from "./CopyCommand";

export const START_COMMAND = "make run-starter-mcp-http";

interface GettingStartedProps {
  state: GettingStartedState;
  // Inspector 링크가 열 서버 (온라인인 HTTP 서버 우선, 없으면 첫 HTTP 서버). 없으면 서버 선택 없이 연다.
  inspectorServer: string | null;
  headingRef: Ref<HTMLHeadingElement>;
  onHide: () => void;
}

// 시작하기 패널 (final.html Getting started 를 A 패널 문법으로: 1px 선, 4px 라운드, mono 머리글).
// 4단계 모두 실제 동작으로 저절로 체크된다. 이 화면을 열 때 이미 끝나 있던 단계는 접히고(제목을 누르면 다시 펼침),
// 보고 있는 동안 끝난 단계는 펼친 채 체크만 바뀐다. 첫 상태 점검이 끝나는 순간 단계가 접히며 아래 내용이 밀려 올라가던
// 레이아웃 이동(CLS)을 없애려는 것이다.
// 단계 목록은 lib/onboarding/getting-started.ts 의 STEP_IDS 이고, 칸 수와 열 수가 거기서 따라온다.
export function GettingStarted({ state, inspectorServer, headingRef, onHide }: GettingStartedProps) {
  const t = useT();
  const titleId = useId();
  const total = STEP_IDS.length;
  const done = countDone(state);
  const all = done === total;
  const progressText = t("gettingStarted.progress", { n: done, total });
  const { servers, openClientConfig } = useShell();
  // 설정 복사 단계가 여는 서버: 온라인인 HTTP 서버 우선, 없으면 첫 서버
  const configServer = inspectorServer ?? servers[0]?.name ?? null;
  // 하이드레이션이 끝난 첫 렌더의 완료 상태 (서버 렌더와 하이드레이션 렌더는 저장값을 모른다).
  const hydrated = useHydrated();
  const [doneAtOpen, setDoneAtOpen] = useState<GettingStartedState["done"] | null>(null);
  if (hydrated && doneAtOpen === null) setDoneAtOpen(state.done);

  const steps: Record<StepId, { title: string; body: ReactNode; action: ReactNode }> = {
    startServer: {
      title: t("gettingStarted.startServerTitle"),
      body: t.rich("gettingStarted.startServerBody", { cmd: <Code>{START_COMMAND}</Code> }),
      action: <CopyLabelButton command={START_COMMAND} label={t("gettingStarted.copyCommand")} />,
    },
    inspectorCall: {
      title: t("gettingStarted.inspectorCallTitle"),
      body: t("gettingStarted.inspectorCallBody"),
      action: (
        <StepLink
          href={inspectorServer ? `/inspector?server=${encodeURIComponent(inspectorServer)}` : "/inspector"}
          icon={<SquareTerminalIcon />}
          label={t("gettingStarted.openInspector")}
        />
      ),
    },
    chatToolCall: {
      title: t("gettingStarted.chatToolCallTitle"),
      body: t("gettingStarted.chatToolCallBody"),
      action: <StepLink href="/chat" icon={<MessageSquareIcon />} label={t("gettingStarted.openChat")} />,
    },
    copyConfig: {
      title: t("gettingStarted.copyConfigTitle"),
      body: t("gettingStarted.copyConfigBody"),
      action: (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-md"
          disabled={configServer === null}
          onClick={() => configServer && openClientConfig(configServer)}
        >
          <FileJsonIcon />
          {t("gettingStarted.copyConfigAction")}
        </Button>
      ),
    },
  };

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-md border border-line bg-surface">
      <div
        className={cn(
          "flex min-h-[38px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-background py-1 pr-2 pl-3 shadow-[inset_2px_0_0_var(--brand)] max-[901px]:flex-nowrap max-[901px]:py-0.5",
          all && "shadow-[inset_2px_0_0_var(--success-solid)]",
        )}
      >
        <span
          aria-hidden
          className="grid size-5 flex-none place-items-center rounded-xs bg-brand-subtle text-brand-text"
        >
          <RocketIcon className="size-3.5" />
        </span>
        <h2
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="font-mono text-2xs font-semibold tracking-[var(--tracking-caps)] whitespace-nowrap uppercase outline-hidden lang-ko:tracking-[0.02em] max-[901px]:min-w-0 max-[901px]:truncate"
        >
          {t("gettingStarted.title")}
        </h2>
        <div
          role="progressbar"
          aria-label={t("gettingStarted.title")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={progressText}
          className="inline-grid flex-none gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${total}, 18px)` }}
        >
          {STEP_IDS.map((id) => (
            <i
              key={id}
              className={cn(
                "h-1.5 rounded-[1px]",
                state.done[id] ? "bg-brand" : "bg-surface-active shadow-[inset_0_0_0_1px_var(--line-strong)]",
              )}
            />
          ))}
        </div>
        <span className="text-xs whitespace-nowrap tabular-nums max-[901px]:hidden">{progressText}</span>
        <span aria-hidden className="hidden font-mono text-2xs tabular-nums max-[901px]:inline">
          {done}/{total}
        </span>
        <span className="min-w-0 flex-[1_1_160px] text-2xs text-fg-muted max-[901px]:hidden">
          {all ? t("gettingStarted.noteAll") : t("gettingStarted.note")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto flex-none rounded-md max-[901px]:h-8"
          onClick={onHide}
          aria-label={t("gettingStarted.hideAria")}
        >
          {t("gettingStarted.hide")}
        </Button>
      </div>

      <ol
        className={cn(
          "m-0 grid list-none grid-cols-1 p-0",
          STEP_IDS.length >= 4 ? "min-[901px]:grid-cols-2 min-[1281px]:grid-cols-4" : "min-[901px]:grid-cols-3",
        )}
      >
        {STEP_IDS.map((id, index) => (
          <StepItem key={id} index={index} done={state.done[id]} collapseWhenDone={doneAtOpen?.[id] === true} {...steps[id]} />
        ))}
      </ol>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs border border-line bg-surface-sunken px-[3px] text-[0.92em] text-foreground [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

function CopyLabelButton({ command, label }: { command: string; label: string }) {
  const copy = useCopy();
  return (
    <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={() => void copy(command)}>
      <CopyIcon />
      {label}
    </Button>
  );
}

function StepLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-md")}>
      {icon}
      {label}
    </Link>
  );
}

interface StepItemProps {
  index: number;
  done: boolean;
  // 화면을 열 때 이미 끝나 있던 단계만 기본으로 접는다.
  collapseWhenDone: boolean;
  title: string;
  body: ReactNode;
  action: ReactNode;
}

function StepItem({ index, done, collapseWhenDone, title, body, action }: StepItemProps) {
  const t = useT();
  // 사용자가 연 상태는 "그때의 완료 여부"와 함께 기억한다. 단계가 완료로 바뀌면 다시 기본값(접힘)으로 돌아간다.
  const [override, setOverride] = useState<{ done: boolean; open: boolean } | null>(null);
  const open = override && override.done === done ? override.open : !(done && collapseWhenDone);

  const box = (
    <span
      aria-hidden
      className={cn(
        "grid size-[22px] flex-none place-items-center rounded-sm border border-line-strong font-mono text-2xs tabular-nums",
        done && "border-brand bg-brand text-brand-fg",
      )}
    >
      {done ? <CheckIcon className="size-[13px]" strokeWidth={2.25} /> : index + 1}
    </span>
  );

  return (
    <li className="min-w-0 border-line max-[901px]:not-first:border-t min-[901px]:not-first:border-l">
      <Collapsible
        open={open}
        onOpenChange={(next) => setOverride({ done, open: next })}
        className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 py-3 pr-4 pl-3 max-[901px]:py-2.5 max-[901px]:pr-3"
      >
        {box}
        <div className="grid min-w-0 content-start gap-1">
          {done ? (
            <CollapsibleTrigger className="flex min-h-6 w-full min-w-0 items-center gap-2 rounded-xs text-left outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring">
              <span className="min-w-0 truncate text-sm font-medium text-fg-muted">{title}</span>
              <span className="inline-flex flex-none items-center gap-1 font-mono text-2xs whitespace-nowrap text-success-fg">
                <CheckIcon aria-hidden className="size-3" />
                {t("gettingStarted.done")}
              </span>
              <ChevronRightIcon
                aria-hidden
                className={cn("ml-auto size-3.5 flex-none text-fg-muted transition-transform", open && "rotate-90")}
              />
            </CollapsibleTrigger>
          ) : (
            <h3 className="text-sm leading-[22px] font-semibold">{title}</h3>
          )}
          <CollapsibleContent className="grid gap-1">
            <p className="text-xs leading-[18px] text-fg-muted">{body}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">{action}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  );
}
