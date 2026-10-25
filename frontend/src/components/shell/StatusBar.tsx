"use client";

import { ClockIcon, LayersIcon, SparklesIcon, TerminalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import { useHealthSummary, useServerHealthByName } from "./health-store";
import { useSelectedServer, useShellMetaValue } from "./shell-context";

function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[var(--sb-h)] flex-none items-center gap-[5px] px-2 whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

// 상태바 (24px, 브랜드 면). 선택한 서버와 연결 상태, 협상된 MCP 프로토콜 버전을 보여 준다.
// 마지막 호출 시간, p50, 모델 이름, "Sample data" 태그는 화면이 useShellMeta 로 값을 올릴 때만 나타난다.
export function StatusBar() {
  const t = useT();
  const selected = useSelectedServer();
  const health = useServerHealthByName(selected);
  const summary = useHealthSummary();
  const meta = useShellMetaValue();

  let stateText: string | null = null;
  switch (health?.status) {
    case "healthy":
      stateText = t("shell.statusConnected");
      break;
    case "offline":
      stateText = t("shell.statusOffline");
      break;
    case "na":
      stateText = t("shell.statusStdio");
      break;
    case "checking":
    case "idle":
      stateText = t("shell.statusChecking");
      break;
  }

  // 협상된 버전은 ping 에 성공한 서버에서만 알 수 있다. 모르면 라벨을 숨긴다.
  const protocolVersion = health?.status === "healthy" ? health.protocolVersion : undefined;

  return (
    <footer
      aria-label={t("shell.statusBar")}
      className="flex min-w-0 items-center overflow-hidden bg-brand pr-(--gutter-r) pb-[env(safe-area-inset-bottom,0px)] pl-(--gutter-l) font-mono text-2xs text-brand-fg"
      style={{ lineHeight: "var(--sb-h)" }}
    >
      {meta.model ? (
        <Item className="-ml-2 min-w-0 overflow-hidden">
          <SparklesIcon aria-hidden className="size-3" strokeWidth={1.75} />
          <span className="truncate">{meta.model}</span>
        </Item>
      ) : selected ? (
        <Item className="-ml-2 min-w-0 flex-initial overflow-hidden">
          <span
            aria-hidden
            className={cn(
              "size-[7px] flex-none rounded-full",
              health?.status === "healthy" ? "bg-current" : "border-[1.5px] border-current",
            )}
          />
          <span className="truncate">{selected}</span>
          {stateText && <span className="max-[901px]:hidden">{stateText}</span>}
        </Item>
      ) : summary.total > 0 ? (
        <Item className="-ml-2">
          <span
            aria-hidden
            className={cn(
              "size-[7px] flex-none rounded-full",
              summary.online > 0 ? "bg-current" : "border-[1.5px] border-current",
            )}
          />
          {t("shell.statusSummary", { online: summary.online, total: summary.total })}
        </Item>
      ) : null}

      {protocolVersion && (
        <Item className="max-[901px]:hidden">
          <LayersIcon aria-hidden className="size-3" strokeWidth={1.75} />
          {t("shell.protocol", { version: protocolVersion })}
        </Item>
      )}
      {typeof meta.p50Ms === "number" && (
        <Item className="max-[901px]:hidden">
          <ClockIcon aria-hidden className="size-3" strokeWidth={1.75} />
          p50 {meta.p50Ms} ms
        </Item>
      )}
      {typeof meta.lastCallMs === "number" && (
        <Item className="max-[901px]:hidden">
          <TerminalIcon aria-hidden className="size-3" strokeWidth={1.75} />
          {t("shell.lastCall", { ms: meta.lastCallMs })}
        </Item>
      )}

      <span className="min-w-2 flex-1" />

      {meta.sample && (
        <Item className="pr-0">
          <span className="h-4 rounded-xs border border-[color-mix(in_oklch,var(--brand-fg)_45%,transparent)] px-1.5 leading-3.5">
            {t("shell.sample")}
          </span>
        </Item>
      )}
    </footer>
  );
}
