"use client";

// 앱 셸 (final.html 의 A 골격): 타이틀바, 활동 바, 사이드바, 본문, 상태바, ⌘K 팔레트, 모바일 탭바와 드로어.
// 서버 컴포넌트인 루트 레이아웃이 레지스트리를 읽어 servers 로 넘기고, 화면은 children 으로 들어온다.
//
// 레이아웃 계약
//   * <main id="main"> 은 grid 행을 채우는 스크롤 컨테이너(overflow-auto)다.
//     화면이 뷰포트 높이 패널을 쓰려면 루트를 `h-full min-h-0` 으로 두고 안쪽에서 스크롤하면 된다.
//   * 사이드바: /, /inspector 는 공용 서버 탐색기, /chat 은 화면이 <SidebarSlot> 으로 채울 때만 열린다.
//     /settings 는 사이드바가 없다.

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { GettingStartedWatcher } from "@/components/onboarding/GettingStartedWatcher";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n/client";
import type { PublicServer } from "@/lib/mcp/types";
import { toRuntimeServerCached } from "@/lib/runtime/connection";
import { removeRuntimeServer } from "@/lib/runtime/store";
import { useRuntimeServers } from "@/lib/runtime/use-runtime-servers";
import { notify } from "@/lib/ui/notify";
import { sidebarKindFor, usesServerParam } from "@/lib/shell/routes";
import { createStore, type Store } from "@/lib/shell/store";

import { ActivityBar } from "./ActivityBar";
import { HealthProvider, useHealthActions } from "./health-store";
import { MobileTabBar } from "./MobileTabBar";
import { DesktopSidebar, MobileDrawer } from "./Sidebar";
import {
  ShellContext,
  SlotContext,
  type ServerDialogState,
  type ShellApi,
  type ShellMeta,
  type SlotState,
  type SlotTargets,
} from "./shell-context";
import { ShortcutProvider, useShortcut } from "./shortcuts";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { MOBILE_QUERY, useMediaQuery } from "./use-media-query";

// 팔레트와 서버 대화상자는 처음 열 때까지 필요 없는 코드(cmdk, 서버 추가 폼, 설정 복사 생성기)라서 첫 화면 번들에서 뺀다.
// 처음 열 때 청크를 받는다(로컬과 사내망에서는 수십 ms). 미리 받아 두기(idle preload)는 모바일 Lighthouse 의 TBT 를
// 오히려 늘려서 쓰지 않는다.
const loadPalette = () => import("./CommandPalette").then((m) => m.CommandPalette);
const loadAddServer = () => import("@/components/servers/AddServerDialog").then((m) => m.AddServerDialog);
const loadClientConfig = () => import("@/components/servers/ClientConfigDialog").then((m) => m.ClientConfigDialog);
const CommandPalette = dynamic(loadPalette, { ssr: false });
const AddServerDialog = dynamic(loadAddServer, { ssr: false });
const ClientConfigDialog = dynamic(loadClientConfig, { ssr: false });

// 한 번 열린 뒤로는 계속 마운트해 닫힘 애니메이션과 포커스 복귀를 지킨다.
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  return mounted || open;
}

interface AppShellProps {
  // 레지스트리 서버 (서버 컴포넌트가 읽어 넘긴다)
  servers: PublicServer[];
  runtimeProxyEnabled?: boolean;
  children: ReactNode;
}

export function AppShell({ servers, runtimeProxyEnabled = false, children }: AppShellProps) {
  // 이 탭의 런타임 서버를 레지스트리 서버 뒤에 붙인다. 상태 점검, 탐색기, 팔레트, Dashboard 가 같은 목록을 본다.
  const runtime = useRuntimeServers();
  const all = useMemo<PublicServer[]>(
    () => [...servers, ...runtime.map((def) => toRuntimeServerCached(def))],
    [servers, runtime],
  );
  return (
    <ShortcutProvider>
      <HealthProvider servers={all}>
        <TooltipProvider delay={300}>
          <GettingStartedWatcher />
          <ShellFrame servers={all} runtimeProxyEnabled={runtimeProxyEnabled}>
            {children}
          </ShellFrame>
        </TooltipProvider>
      </HealthProvider>
    </ShortcutProvider>
  );
}

function ShellFrame({ servers, runtimeProxyEnabled = false, children }: AppShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { checkAll } = useHealthActions();
  const drawerId = useId();
  const t = useT();
  const { confirm, confirmDialog } = useConfirm();
  const [serverDialog, setServerDialog] = useState<ServerDialogState>(null);
  const [configTarget, setConfigTarget] = useState<string | null>(null);

  const [metaStore] = useState<Store<ShellMeta>>(() => createStore<ShellMeta>({}));
  const [filledStore] = useState<Store<SlotState>>(() => createStore<SlotState>("pending"));
  const slotState = useSyncExternalStore(filledStore.subscribe, filledStore.get, filledStore.getInitial);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // 드로어는 "어느 위치에서 열었는지"를 기억해 두면, 이동하는 순간 저절로 닫힌다.
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [drawerRouteKey, setDrawerRouteKey] = useState<string | null>(null);
  const drawerOpen = isMobile && drawerRouteKey === routeKey;
  const setDrawerOpen = useCallback(
    (open: boolean) => setDrawerRouteKey(open ? routeKey : null),
    [routeKey],
  );

  const [desktopTarget, setDesktopTarget] = useState<HTMLElement | null>(null);
  const [mobileTarget, setMobileTarget] = useState<HTMLElement | null>(null);

  const kind = sidebarKindFor(pathname);
  // Chat 은 레지스트리에 HTTP 서버가 있을 때만 대화 목록(사이드바)을 채운다. 없으면 처음부터 열을 잡지 않아
  // 서버가 없는 안내 화면에서 열이 나중에 접히며 본문이 밀리지 않는다. 있으면 hydration 전부터 열을 잡아 둔다.
  const chatCanFillSidebar = servers.some((s) => s.transport === "streamable_http" && !s.runtime);
  const hasSidebar = kind === "explorer" || (kind === "slot" && (slotState === "filled" || (slotState === "pending" && chatCanFillSidebar)));

  const goToServer = useCallback(
    (name: string, forceInspector: boolean) => {
      const stay = !forceInspector && usesServerParam(pathname);
      const base = stay ? pathname : "/inspector";
      const href = `${base}?server=${encodeURIComponent(name)}`;
      if (stay) router.replace(href, { scroll: false });
      else router.push(href);
    },
    [pathname, router],
  );

  const requestRemoveServer = useCallback(
    async (name: string) => {
      const ok = await confirm({
        title: t("runtime.removeTitle", { name }),
        description: t("runtime.removeBody"),
        confirmLabel: t("runtime.remove"),
        destructive: true,
      });
      if (!ok) return;
      removeRuntimeServer(name);
      notify.success(t("runtime.removed", { name }));
      // 지운 서버를 보고 있었다면 서버 선택을 비운다
      if (usesServerParam(pathname) && searchParams.get("server") === name) router.replace(pathname, { scroll: false });
    },
    [confirm, t, pathname, searchParams, router],
  );

  const shell = useMemo<ShellApi>(
    () => ({
      servers,
      runtimeProxyEnabled,
      serverDialog,
      openAddServer: () => setServerDialog({ mode: "add" }),
      openEditServer: (name) => setServerDialog({ mode: "edit", name }),
      closeServerDialog: () => setServerDialog(null),
      requestRemoveServer: (name) => void requestRemoveServer(name),
      configTarget,
      openClientConfig: setConfigTarget,
      closeClientConfig: () => setConfigTarget(null),
      metaStore,
      paletteOpen,
      setPaletteOpen,
      selectServer: (name) => goToServer(name, false),
      openServerInInspector: (name) => goToServer(name, true),
      // 레지스트리(서버 컴포넌트)를 다시 읽고, 상태도 다시 확인한다.
      refreshServers: () => {
        router.refresh();
        void checkAll();
      },
    }),
    [servers, runtimeProxyEnabled, serverDialog, configTarget, requestRemoveServer, metaStore, paletteOpen, goToServer, router, checkAll],
  );

  const slot = useMemo<SlotTargets>(
    () => ({ filledStore, desktopTarget, mobileTarget, isMobile }),
    [filledStore, desktopTarget, mobileTarget, isMobile],
  );

  const paletteMounted = useMountedOnce(paletteOpen);
  const addServerMounted = useMountedOnce(serverDialog !== null);
  const configMounted = useMountedOnce(configTarget !== null);

  // ⌘K / Ctrl+K 는 팔레트를 토글한다. 대화상자가 열려 있어도 동작한다.
  useShortcut("mod+k", () => setPaletteOpen(!paletteOpen), { allowInInput: true, allowInOverlay: true });

  return (
    <ShellContext.Provider value={shell}>
      <SlotContext.Provider value={slot}>
        <div className="grid h-dvh grid-rows-[var(--tb-h)_minmax(0,1fr)_auto] max-[901px]:grid-rows-[var(--tb-h)_minmax(0,1fr)_56px_auto]">
          <TitleBar
            drawerOpen={drawerOpen}
            drawerId={drawerId}
            onMenu={() => setDrawerOpen(true)}
          />

          <div className="flex min-h-0 pr-(--gutter-r) pb-2 pl-(--gutter-l)">
            <div
              className={
                "grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface max-[901px]:grid-cols-[minmax(0,1fr)] max-[901px]:rounded-md " +
                (hasSidebar
                  ? "grid-cols-[var(--act-w)_var(--side-w)_minmax(0,1fr)]"
                  : "grid-cols-[var(--act-w)_minmax(0,1fr)]")
              }
            >
              <ActivityBar />
              <DesktopSidebar kind={kind} visible={hasSidebar} setTarget={setDesktopTarget} />
              <main
                id="main"
                tabIndex={-1}
                className="min-h-0 min-w-0 overflow-auto bg-surface outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
              >
                {children}
              </main>
            </div>
          </div>

          <MobileTabBar />
          <StatusBar />
        </div>

        <MobileDrawer
          id={drawerId}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          kind={kind}
          setTarget={setMobileTarget}
        />
        {paletteMounted ? <CommandPalette /> : null}
        {addServerMounted ? <AddServerDialog /> : null}
        {configMounted ? <ClientConfigDialog /> : null}
        {confirmDialog}
      </SlotContext.Provider>
    </ShellContext.Provider>
  );
}
