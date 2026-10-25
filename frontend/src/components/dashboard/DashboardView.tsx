"use client";

import { GlobeIcon, ListChecksIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isRuntimeServer } from "@/components/servers/ServerMenu";
import {
  useHealthActions,
  useHealthHistory,
  useHealthMap,
  useHealthSummary,
} from "@/components/shell/health-store";
import { useShell, useShellMeta } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { sharedSparkScale } from "@/lib/dashboard/latency";
import { computeMetrics } from "@/lib/dashboard/metrics";
import { useT } from "@/lib/i18n/client";
import { GS_HIDDEN_ATTR, STEP_IDS, setGettingStartedHidden, countDone } from "@/lib/onboarding/getting-started";
import { useGettingStarted, useHydrated } from "@/lib/onboarding/use-getting-started";
import type { PublicServer } from "@/lib/mcp/types";
import { notify } from "@/lib/ui/notify";

import { GettingStarted } from "./GettingStarted";
import { MetricsStrip } from "./MetricsStrip";
import { RecentChecks } from "./RecentChecks";
import { RegistryEmpty, RegistryError } from "./RegistryStates";
import { ServerTable } from "./ServerTable";

interface DashboardViewProps {
  servers: PublicServer[];
  // 레지스트리를 읽지 못했을 때의 오류 메시지. 있으면 오류 상태를 보여 준다.
  registryError: string | null;
}

// Dashboard 본문. 상태는 셸의 공용 스토어(health-store)가 한 번만 확인한 값을 읽고, 이 화면은 따로 ping 하지 않는다.
export function DashboardView({ servers, registryError }: DashboardViewProps) {
  const t = useT();
  const { refreshServers, openAddServer, servers: shellServers } = useShell();
  // 이 탭 세션에서 추가한 런타임 서버 (레지스트리 서버는 props 로 받는다)
  const runtimeServers = useMemo(() => shellServers.filter(isRuntimeServer), [shellServers]);
  const { check, checkAll, getHealth } = useHealthActions();
  const health = useHealthMap();
  const history = useHealthHistory();
  const summary = useHealthSummary();
  const gs = useGettingStarted();
  const hydrated = useHydrated();

  // 하이드레이션 뒤에는 React 상태가 패널을 정하므로 그리기 전 숨김 표시를 지운다.
  useLayoutEffect(() => {
    if (hydrated) document.documentElement.removeAttribute(GS_HIDDEN_ATTR);
  }, [hydrated]);

  const metrics = useMemo(() => computeMetrics(servers, health, history), [servers, health, history]);
  // 지연 스파크라인 공용 눈금: Registry 표와 Runtime 표의 모든 HTTP 서버가 같은 값을 쓴다.
  const scaleMs = useMemo(
    () => sharedSparkScale([...servers, ...runtimeServers].map((s) => history.samples[s.name])),
    [servers, runtimeServers, history],
  );
  // 상태바 p50 도 실측값이 있을 때만 올린다.
  useShellMeta({ p50Ms: metrics.p50 ?? undefined });

  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || summary.checking > 0;

  // 숨기기와 다시 보기 사이에서 포커스가 사라지지 않게 옮긴다.
  const showButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<"show" | "title" | null>(null);
  useEffect(() => {
    if (pendingFocus.current === "show") showButtonRef.current?.focus();
    if (pendingFocus.current === "title") titleRef.current?.focus();
    pendingFocus.current = null;
  }, [gs.hidden]);

  async function handleRefreshAll() {
    const httpCount = servers.filter((s) => s.transport !== "stdio").length;
    if (httpCount === 0) {
      notify.info(t("dashboard.refreshNone"));
      return;
    }
    setRefreshing(true);
    try {
      await checkAll();
      const online = servers.filter((s) => getHealth()[s.name]?.status === "healthy").length;
      notify.success(t("dashboard.refreshDone", { n: httpCount, online }));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRetry(server: PublicServer) {
    await check(server);
    const status = getHealth()[server.name]?.status;
    if (status === "healthy") notify.success(t("dashboard.retryDone", { name: server.name }));
    else notify.warning(t("dashboard.retryStill", { name: server.name }));
  }

  const inspectorServer =
    servers.find((s) => s.transport !== "stdio" && health[s.name]?.status === "healthy")?.name ??
    servers.find((s) => s.transport !== "stdio")?.name ??
    null;

  const hasServers = servers.length > 0 && !registryError;

  return (
    <div className="mx-0 grid max-w-[1320px] content-start gap-5 px-6 pt-5 pb-8 max-[901px]:gap-4 max-[901px]:px-3 max-[901px]:pt-4 max-[901px]:pb-6">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-heading text-xl leading-[30px] font-semibold tracking-tight">{t("dashboard.title")}</h1>
          {!registryError && (
            <p className="mt-0.5 text-xs text-fg-muted">
              {t.rich("dashboard.subtitle", {
                count: t("dashboard.serverCount", { n: servers.length }),
                file: <code className="font-mono text-foreground">configs/mcp_servers.yaml</code>,
              })}
            </p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2 max-[901px]:ml-0 max-[901px]:w-full">
          {hasServers && hydrated && gs.hidden && (
              <Button
                ref={showButtonRef}
                type="button"
                variant="ghost"
                size="lg"
                className="rounded-md max-[901px]:flex-1"
                onClick={() => {
                  pendingFocus.current = "title";
                  setGettingStartedHidden(false);
                }}
              >
                <ListChecksIcon className="text-brand-text" />
                {t("dashboard.showGettingStarted", { n: countDone(gs), total: STEP_IDS.length })}
              </Button>
            )}
          {hasServers && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="rounded-md max-[901px]:flex-1"
              disabled={busy}
              // 누른 뒤 disabled 가 되면 포커스가 body 로 빠진다. aria-disabled 로만 막아 포커스를 버튼에 남긴다.
              focusableWhenDisabled
              onClick={() => void handleRefreshAll()}
            >
              <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
              {busy ? t("dashboard.refreshing") : t("dashboard.refreshAll")}
            </Button>
          )}
          <Button type="button" size="lg" className="rounded-md max-[901px]:flex-1" onClick={openAddServer} data-action="add-server-header">
            <PlusIcon />
            {t("runtime.addServer")}
          </Button>
        </div>
      </header>

      {registryError ? (
        <RegistryError message={registryError} onReload={refreshServers} />
      ) : servers.length === 0 ? (
        <RegistryEmpty onReload={refreshServers} />
      ) : (
        <>
          {/* 시작하기 패널은 서버에서도 그린다 (첫 화면의 가장 큰 글자라 하이드레이션을 기다리면 모바일 LCP 가 늦어진다).
              숨긴 사용자는 <head> 의 작은 스크립트가 그리기 전에 <html data-gs-hidden> 을 달아 CSS 로 감추고,
              하이드레이션 뒤에는 저장값(gs.hidden)이 패널을 빼며 속성을 지운다. 자리표시자와 실제 패널의 높이가 달라 생기던
              레이아웃 이동도 없어진다. */}
          {!gs.hidden && (
            <div className="contents [html[data-gs-hidden]_&]:hidden">
              <GettingStarted
                state={gs}
                inspectorServer={inspectorServer}
                headingRef={titleRef}
                onHide={() => {
                  pendingFocus.current = "show";
                  setGettingStartedHidden(true);
                }}
              />
            </div>
          )}
          <MetricsStrip metrics={metrics} />
          <div className="grid gap-2">
            <ServerTable servers={servers} health={health} history={history} scaleMs={scaleMs} onRetry={(s) => void handleRetry(s)} />
            <p className="font-mono text-2xs text-fg-muted">{t("dashboard.scaleNote", { max: scaleMs })}</p>
          </div>
          <RecentChecks events={history.events} />
        </>
      )}

      <RuntimeSection
        servers={runtimeServers}
        health={health}
        history={history}
        scaleMs={scaleMs}
        onRetry={(s) => void handleRetry(s)}
        onAdd={openAddServer}
      />
    </div>
  );
}

// Runtime servers: 이 탭 세션에서만 유지되는 서버. 레지스트리 표와 같은 행(상태, 지연, 작업)을 쓴다.
function RuntimeSection({
  servers,
  health,
  history,
  scaleMs,
  onRetry,
  onAdd,
}: {
  servers: PublicServer[];
  health: ReturnType<typeof useHealthMap>;
  history: ReturnType<typeof useHealthHistory>;
  scaleMs: number;
  onRetry: (server: PublicServer) => void;
  onAdd: () => void;
}) {
  const t = useT();
  return (
    <section aria-labelledby="runtime-servers-title" className="grid gap-2" data-section="runtime-servers">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="runtime-servers-title" className="font-heading text-base font-semibold tracking-tight">
          {t("runtime.sectionTitle")}
        </h2>
        <p className="text-xs text-fg-muted">{t("runtime.sectionSub")}</p>
      </div>
      {servers.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-dashed border-line-strong p-4">
          <GlobeIcon aria-hidden className="size-5 flex-none text-fg-muted" />
          <div className="grid min-w-0 flex-1 basis-60 gap-0.5 text-xs text-fg-muted">
            <b className="text-sm font-semibold text-foreground">{t("runtime.emptyTitle")}</b>
            {t("runtime.emptyBody")}
          </div>
          <Button type="button" size="lg" className="rounded-md" onClick={onAdd}>
            <PlusIcon />
            {t("runtime.addServer")}
          </Button>
        </div>
      ) : (
        <ServerTable label={t("runtime.sectionTitle")} servers={servers} health={health} history={history} scaleMs={scaleMs} onRetry={onRetry} />
      )}
    </section>
  );
}
