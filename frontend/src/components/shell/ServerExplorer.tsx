"use client";

import { FileTextIcon, GlobeIcon, LockIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { ServerMenu, isRuntimeServer } from "@/components/servers/ServerMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import type { PublicServer } from "@/lib/mcp/types";
import { filterServers } from "@/lib/shell/explorer";
import { cn } from "@/lib/utils";

import { useHealthSummary, useServerHealth } from "./health-store";
import { useSelectedServer, useShell } from "./shell-context";
import { StatusDot } from "./StatusDot";

// 공용 서버 탐색기 (Dashboard, Inspector 사이드바). configs/mcp_servers.yaml 의 Registry 그룹과, 이 탭 세션에서 추가한 Runtime 그룹을 보여 준다.
// 서버를 누르면 Inspector 에서 열고, 상태 점과 전송 방식, 도구 수(확인된 경우)를 함께 표시한다.
export function ServerExplorer() {
  const t = useT();
  const { servers, refreshServers, openAddServer } = useShell();
  const selected = useSelectedServer();
  const summary = useHealthSummary();
  const [query, setQuery] = useState("");
  const registryId = useId();
  const runtimeId = useId();
  const registryServers = useMemo(() => servers.filter((s) => !isRuntimeServer(s)), [servers]);
  const runtimeServers = useMemo(() => servers.filter(isRuntimeServer), [servers]);
  const visible = useMemo(() => filterServers(registryServers, query), [registryServers, query]);
  const visibleRuntime = useMemo(() => filterServers(runtimeServers, query), [runtimeServers, query]);
  const refreshing = summary.checking > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 flex-none items-center gap-1 pr-2 pl-3">
        <h2 className="flex-1 font-mono text-2xs font-medium tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-[0.02em]">
          {t("shell.servers")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={openAddServer}
          aria-label={t("runtime.addServer")}
          title={t("runtime.addServer")}
          data-action="add-server"
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={refreshServers}
          disabled={refreshing}
          aria-label={t("shell.refreshAll")}
          title={t("shell.refreshAll")}
        >
          <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-none px-3 pb-2">
        <div className="relative flex items-center">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-fg-muted" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            placeholder={t("shell.filterServers")}
            aria-label={t("shell.filterServers")}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <section aria-labelledby={registryId} className="pt-1 pb-1">
          <div className="flex items-center gap-1.5 px-3 py-1 font-mono text-2xs text-fg-muted">
            <FileTextIcon aria-hidden className="size-3" />
            <h3 id={registryId} className="font-normal">
              {t("shell.registry")}
            </h3>
            <span className="ml-auto">mcp_servers.yaml</span>
          </div>
          {registryServers.length === 0 ? (
            <p className="mx-3 mt-1 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted">
              {t("shell.noServers")}
            </p>
          ) : visible.length === 0 ? (
            <p className="mx-3 mt-1 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted">
              {t("shell.noMatch", { q: query.trim() })}
            </p>
          ) : (
            <ul>
              {visible.map((server) => (
                <ExplorerItem key={server.name} server={server} active={selected === server.name} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={runtimeId} className="pt-1 pb-1" data-explorer-group="runtime">
          <div className="flex items-center gap-1.5 px-3 py-1 font-mono text-2xs text-fg-muted">
            <GlobeIcon aria-hidden className="size-3" />
            <h3 id={runtimeId} className="font-normal">
              {t("shell.runtime")}
            </h3>
            <span className="ml-auto tabular-nums">{runtimeServers.length}</span>
          </div>
          {runtimeServers.length === 0 ? (
            <div className="mx-3 mt-1 grid gap-2 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted">
              <span>{t("runtime.emptySide")}</span>
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={openAddServer}>
                <PlusIcon aria-hidden />
                {t("runtime.addServer")}
              </Button>
            </div>
          ) : visibleRuntime.length === 0 ? (
            <p className="mx-3 mt-1 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted">
              {t("shell.noMatch", { q: query.trim() })}
            </p>
          ) : (
            <ul>
              {visibleRuntime.map((server) => (
                <ExplorerItem key={server.name} server={server} active={selected === server.name} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-none items-start gap-2 border-t border-line px-3 py-2.5 text-2xs leading-4 text-fg-muted">
        <LockIcon aria-hidden className="mt-px size-3.5 shrink-0 text-success-fg" />
        <span>
          {t.rich("shell.proxyNote", {
            path: <code className="font-mono text-foreground">/api/mcp/&lt;name&gt;</code>,
            header: <code className="font-mono text-foreground">X-MCP-API-Key</code>,
          })}
        </span>
      </div>
    </div>
  );
}

function ExplorerItem({ server, active }: { server: PublicServer; active: boolean }) {
  const t = useT();
  const { selectServer } = useShell();
  const health = useServerHealth(server);
  const isStdio = server.transport === "stdio";
  const toolCount = health.status === "healthy" ? health.toolCount : undefined;
  const runtime = isRuntimeServer(server);

  return (
    <li className="flex items-stretch" title={isStdio ? t("shell.stdioUnavailable") : (server.description ?? undefined)}>
      <button
        type="button"
        disabled={isStdio}
        aria-current={active ? "true" : undefined}
        onClick={() => selectServer(server.name)}
        className={cn(
          "flex h-[30px] min-w-0 flex-1 items-center gap-2 pl-3 text-left font-mono text-xs text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:hover:bg-transparent max-[901px]:h-10",
          "pr-2",
          active && "bg-sel-row shadow-[inset_2px_0_0_var(--brand)]",
        )}
      >
        <StatusDot status={health.status} />
        <span className="min-w-0 flex-1 truncate">{server.name}</span>
        {toolCount !== undefined && (
          <span className="text-2xs text-fg-muted min-[901px]:max-[1081px]:hidden">
            <span aria-hidden>{toolCount}</span>
            <span className="sr-only">{t("shell.toolsCount", { n: toolCount })}</span>
          </span>
        )}
        <span
          className={cn(
            "inline-flex h-4 w-[38px] flex-none items-center justify-center rounded-xs border border-line text-[10px] tracking-[0.02em] text-fg-muted",
            !isStdio && "border-brand-border text-brand-text",
          )}
        >
          {isStdio ? "stdio" : "http"}
        </span>
      </button>
      {runtime ? <ServerMenu server={server} className="mr-1 size-[30px] flex-none max-[901px]:size-10" /> : null}
    </li>
  );
}
