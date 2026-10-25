"use client";

// Chat 의 코드 블록: 도구 입력(SQL 이면 SQL 블록)과 도구 결과(JSON 구문 강조, 길면 잘라서 펼치기).
// 도구 카드와 trace 의 스팬 상세가 함께 쓴다. 구문 강조는 Inspector 의 JsonCode(--syntax-* 토큰)를 그대로 쓴다.

import { useState } from "react";

import { CopyIconButton } from "@/components/dashboard/CopyCommand";
import { JsonCode } from "@/components/inspector/ResponseBlocks";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { prettyResult, sqlOnly, truncateText } from "@/lib/chat/format";
import { useT } from "@/lib/i18n/client";
import { formatBytes } from "@/lib/inspector/json-tokens";
import { cn } from "@/lib/utils";

// 결과가 이보다 길면 처음에는 앞부분만 보여 준다 (글자 수).
export const RESULT_PREVIEW_CHARS = 1800;

const FRAME = "min-w-0 overflow-hidden rounded-sm border border-line";
const PRE =
  "max-h-52 overflow-auto bg-surface-sunken p-2 font-mono text-xs leading-5 text-foreground [font-variant-ligatures:none]";

function Label({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-1.5 font-mono text-2xs text-fg-muted">
      <span>{children}</span>
      {extra}
    </div>
  );
}

export function ToolInput({ input }: { input: Record<string, unknown> }) {
  const t = useT();
  const sql = sqlOnly(input);
  if (sql !== null) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
        <Label extra={<Chip>sql</Chip>}>{t("chat.input")}</Label>
        <div className={FRAME}>
          <pre tabIndex={0} className={cn(PRE, "break-words whitespace-pre-wrap")}>
            {sql}
          </pre>
        </div>
      </div>
    );
  }
  const text = JSON.stringify(input, null, 2) ?? "{}";
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
      <Label>{t("chat.input")}</Label>
      <div className={FRAME}>
        <JsonCode text={text} className="max-h-52 p-2" />
      </div>
    </div>
  );
}

export function ToolResult({ content, isError }: { content: string; isError: boolean }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { text, json } = prettyResult(content);
  const view = expanded ? { text, truncated: false } : truncateText(text, RESULT_PREVIEW_CHARS);
  const canCollapse = expanded && text.length > RESULT_PREVIEW_CHARS;
  const size = formatBytes(new TextEncoder().encode(text).length);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
      <Label
        extra={
          <span className="ml-auto flex items-center">
            <CopyIconButton text={text} label={t("chat.copyResult")} />
          </span>
        }
      >
        {t("chat.result")}
      </Label>
      <div className={cn(FRAME, isError && "border-danger-border")}>
        {json && !isError ? (
          <JsonCode text={view.text} className="max-h-52 p-2" />
        ) : (
          <pre
            tabIndex={0}
            className={cn(PRE, "break-words whitespace-pre-wrap", isError && "bg-danger-bg text-danger-fg")}
          >
            {view.text}
          </pre>
        )}
        {view.truncated || canCollapse ? (
          <div className="border-t border-line bg-background px-2 py-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="font-mono text-2xs"
            >
              {expanded ? t("chat.showLess") : t("chat.showAll", { size })}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
