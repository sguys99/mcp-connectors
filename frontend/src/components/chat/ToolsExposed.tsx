"use client";

// Chat 사이드바 본문: "모델에 공개할 도구". 접속 가능한 HTTP 서버마다 체크박스가 있고, 체크한 서버의 도구를
// 모델이 호출할 수 있다. 상태 점은 셸의 공용 헬스 스토어를 읽는다. 오프라인 서버는 체크할 수 없고 이유를 보여 준다.
// <SidebarSlot> 안에서 쓴다 (데스크톱은 사이드바 열, 모바일은 드로어).

import { DatabaseIcon, WrenchIcon } from "lucide-react";
import { useId } from "react";

import { useServerHealth } from "@/components/shell/health-store";
import { StatusDot } from "@/components/shell/StatusDot";
import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/lib/i18n/client";
import type { StreamableHttpServer } from "@/lib/mcp/types";
import { cn } from "@/lib/utils";

interface ToolsExposedProps {
  servers: readonly StreamableHttpServer[];
  selected: readonly string[];
  onToggle: (name: string, on: boolean) => void;
  // 요약 줄: 지금 요청에 담기는 서버 수와 도구 수
  summary: { servers: number; tools: number };
  disabled?: boolean;
  // Chat 에서 쓸 수 없는 서버와 그 이유 (예: 브라우저 직결 런타임 서버)
  unavailable?: Readonly<Record<string, string>>;
  // 하단 안내 문구 (대화를 어디에 두는지)
  note: string;
}

export function ToolsExposed({ servers, selected, onToggle, summary, disabled, unavailable, note }: ToolsExposedProps) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 flex-none items-center gap-1.5 px-3">
        <WrenchIcon aria-hidden className="size-3 text-fg-muted" />
        <h2 className="flex-1 font-mono text-2xs font-medium tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-[0.02em]">
          {t("chat.toolsExposed")}
        </h2>
      </div>

      <ul aria-label={t("chat.toolsExposedList")} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {servers.map((server) => (
          <ServerRow
            key={server.name}
            server={server}
            checked={selected.includes(server.name)}
            onToggle={onToggle}
            disabled={disabled}
            unavailable={unavailable?.[server.name]}
          />
        ))}
      </ul>

      <p className="flex-none px-3 py-2 font-mono text-2xs text-fg-muted tabular-nums" aria-live="polite">
        {summary.tools > 0
          ? t("chat.toolsSummary", { n: summary.tools, s: summary.servers })
          : t("chat.toolsSummaryServers", { s: summary.servers })}
      </p>

      <div className="flex flex-none items-start gap-2 border-t border-line px-3 py-2.5 text-2xs leading-4 text-fg-muted">
        <DatabaseIcon aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>{note}</span>
      </div>
    </div>
  );
}

function ServerRow({
  server,
  checked,
  onToggle,
  disabled,
  unavailable,
}: {
  server: StreamableHttpServer;
  checked: boolean;
  onToggle: (name: string, on: boolean) => void;
  disabled?: boolean;
  unavailable?: string;
}) {
  const t = useT();
  const id = useId();
  const health = useServerHealth(server);
  const offline = health.status === "offline";
  const toolCount = health.status === "healthy" ? health.toolCount : undefined;
  const blocked = unavailable !== undefined;
  const reason = offline ? t("shell.statusOffline") : undefined;
  const noteId = useId();

  return (
    <li>
      <label
        htmlFor={id}
        title={server.description ?? undefined}
        className={cn(
          "flex h-[30px] w-full cursor-pointer items-center gap-2 px-3 font-mono text-xs text-foreground transition-colors hover:bg-surface-hover max-[901px]:h-11",
          (offline || disabled || blocked) && "cursor-not-allowed hover:bg-transparent",
        )}
      >
        <Checkbox
          id={id}
          checked={checked && !offline && !blocked}
          disabled={offline || disabled || blocked}
          aria-describedby={blocked ? noteId : undefined}
          onCheckedChange={(on) => onToggle(server.name, on === true)}
        />
        <StatusDot status={health.status} />
        <span className="min-w-0 flex-1 truncate">{server.name}</span>
        {reason ? (
          <span className="text-2xs text-danger-fg capitalize">{reason}</span>
        ) : toolCount !== undefined ? (
          <span className="text-2xs text-fg-muted">
            <span aria-hidden>{toolCount}</span>
            <span className="sr-only">{t("shell.toolsCount", { n: toolCount })}</span>
          </span>
        ) : null}
      </label>
      {blocked ? (
        <p id={noteId} className="px-3 pb-1.5 pl-[42px] text-2xs leading-4 text-fg-muted">
          {unavailable}
        </p>
      ) : null}
    </li>
  );
}
