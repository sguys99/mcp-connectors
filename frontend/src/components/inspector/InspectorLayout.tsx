"use client";

// Inspector 3분할 레이아웃: 도구 목록, 요청, 응답.
//
// * 데스크톱(901px 이상): react-resizable-panels(shadcn resizable)로 분할. 핸들은 끌거나 방향키로 움직이고
//   aria-valuenow/min/max 가 따라 바뀐다. 핸들을 두 번 누르면 기본 크기로 돌아간다 (라이브러리 기본 동작).
//   비율은 폭 구간(wide, mid, narrow)마다 따로 localStorage 에 저장한다 (lib/inspector/layout.ts 참고).
// * 모바일(900px 이하): 분할 없이 도구 / 요청 / 응답 세그먼트 탭 하나만 보인다.
// * 하단 도킹 패널: dock 에 노드를 넘기면 3분할 아래에 --dock-h 높이로 붙는다 (모바일은 40vh). dockOpen 이 false 면
//   머리 줄만 남도록 높이를 33px(모바일 37px)로 줄인다. 내용은 InspectorDock 이 그린다.
//   펼쳐져 있으면 위쪽 가장자리의 핸들(role="separator")로 높이를 바꾼다: 끌기, 방향키(ArrowUp 이 키움), PageUp/PageDown,
//   Home/End, 두 번 누르면 기본값. 높이는 데스크톱과 모바일을 따로 localStorage 에 저장한다 (lib/inspector/layout.ts).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useDefaultLayout } from "react-resizable-panels";

import { InspectorSkeleton } from "@/components/skeletons/screens";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n/client";
import { safeStorage } from "@/lib/storage/safe-storage";
import {
  BAND_DEFAULTS,
  clampDockHeight,
  defaultSizes,
  DOCK_HEIGHT_KEYS,
  DOCK_MIN_PX,
  dockHeightForKey,
  dockMaxHeight,
  parseDockHeight,
  type DockMode,
  MAIN_MIN_PX,
  panesStorageKey,
  TOOLS_MAX_PX,
  TOOLS_MIN_PX,
  type SplitBand,
} from "@/lib/inspector/layout";
import { cn } from "@/lib/utils";

import { useLayoutBand } from "./use-layout-band";

const COLLAPSED_DESKTOP = { "--dock-h": "33px" } as CSSProperties;
const COLLAPSED_MOBILE = { "--dock-h": "37px" } as CSSProperties;

export type MobilePane = "tools" | "request" | "response";

interface InspectorLayoutProps {
  tools: ReactNode;
  request: ReactNode;
  response: ReactNode;
  // 모바일에서 보이는 패널
  mobilePane: MobilePane;
  onMobilePane: (pane: MobilePane) => void;
  // 첫 세그먼트 탭의 이름 (활성 기능 탭에 따라 Tools, Resources, Prompts)
  listLabel?: string;
  // 하단 도킹 패널. 없으면 자리를 차지하지 않는다.
  dock?: ReactNode;
  // 도킹 패널이 펼쳐져 있는지 (접히면 머리 줄만 보인다)
  dockOpen?: boolean;
}

export function InspectorLayout({
  tools,
  request,
  response,
  mobilePane,
  onMobilePane,
  listLabel,
  dock,
  dockOpen = true,
}: InspectorLayoutProps) {
  const t = useT();
  const band = useLayoutBand();
  // 높이 계산에 쓰는 두 요소. 구간에 따라 다른 요소가 그려지므로 콜백 ref 로 받는다.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null);
  const dockMode: DockMode = band === "mobile" ? "mobile" : "desktop";
  const dockSize = useDockHeight(dockMode, rootEl, dockEl);
  // 펼쳐져 있고 사용자가 높이를 정했으면 그 값, 아니면 CSS 기본값(--dock-h)
  const openStyle = dockOpen && dockSize.height !== null ? ({ "--dock-h": `${dockSize.height}px` } as CSSProperties) : undefined;
  const handle = dock && dockOpen ? <DockHandle size={dockSize} label={t("inspector.dockResize")} hint={t("inspector.dockResizeHint")} /> : null;

  if (band === null) {
    return <InspectorSkeleton label={t("common.loading")} />;
  }

  if (band === "mobile") {
    return (
      <div ref={setRootEl} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className="border-b border-line bg-background px-3 py-2">
          <Tabs value={mobilePane} onValueChange={(v) => onMobilePane(v as MobilePane)}>
            <TabsList aria-label={t("inspector.panelsLabel")} className="h-9 w-full">
              <TabsTrigger value="tools">{listLabel ?? t("inspector.paneTools")}</TabsTrigger>
              <TabsTrigger value="request">{t("inspector.paneRequest")}</TabsTrigger>
              <TabsTrigger value="response">{t("inspector.paneResponse")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-0">{mobilePane === "tools" ? tools : mobilePane === "request" ? request : response}</div>
        {dock ? (
          <div
            ref={setDockEl}
            className="relative h-[var(--dock-h)] min-h-0 border-t border-line"
            style={dockOpen ? openStyle : COLLAPSED_MOBILE}
          >
            {handle}
            {dock}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={setRootEl}
      className={cn("grid h-full min-h-0", dock ? "grid-rows-[minmax(0,1fr)_var(--dock-h)]" : "grid-rows-[minmax(0,1fr)]")}
      style={dock ? (dockOpen ? openStyle : COLLAPSED_DESKTOP) : undefined}
    >
      {/* key: 구간이 바뀌면 그 구간의 저장된 비율로 다시 시작한다 */}
      <DesktopPanes key={band} band={band} tools={tools} request={request} response={response} />
      {dock ? (
        <div ref={setDockEl} className="relative min-h-0 border-t border-line">
          {handle}
          {dock}
        </div>
      ) : null}
    </div>
  );
}

const PANEL_IDS = ["tools", "request", "response"];

// 도구 목록 폭(px)을 퍼센트로 바꾸려면 그룹의 실제 폭이 필요하다 (라이브러리는 px 와 % 를 섞으면 합계를 맞추려고 모두 비례 축소한다).
// 그래서 마운트 직후 폭을 한 번 재서 기본 크기를 계산하고, 그때까지는 skeleton 을 그린다.
function DesktopPanes({
  band,
  tools,
  request,
  response,
}: {
  band: SplitBand;
  tools: ReactNode;
  request: ReactNode;
  response: ReactNode;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const defaults = BAND_DEFAULTS[band];
  const layout = useDefaultLayout({
    id: panesStorageKey(band),
    panelIds: PANEL_IDS,
    storage: safeStorage,
    // 창 크기에 맞춘 자동 보정은 저장하지 않는다. 사용자가 끈 비율만 남긴다.
    onlySaveAfterUserInteractions: true,
  });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) {
        setWidth(Math.round(w));
        // 처음 한 번만 필요하다. 이후 창 크기 변화는 패널이 비율로 따라간다.
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sizes = width === null ? null : defaultSizes(defaults, width);

  return (
    <div ref={hostRef} className="h-full min-h-0 min-w-0">
      {sizes === null ? (
        <InspectorSkeleton label={t("common.loading")} />
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          id={panesStorageKey(band)}
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
          className="h-full min-h-0"
        >
          <ResizablePanel
            id="tools"
            defaultSize={sizes.tools}
            minSize={`${TOOLS_MIN_PX}px`}
            maxSize={`${TOOLS_MAX_PX}px`}
            groupResizeBehavior="preserve-pixel-size"
            className="min-h-0"
          >
            {tools}
          </ResizablePanel>
          <PaneHandle label={t("inspector.resizeTools")} hint={t("inspector.resizeHint")} />
          <ResizablePanel id="request" defaultSize={sizes.request} minSize={`${MAIN_MIN_PX}px`} className="min-h-0">
            {request}
          </ResizablePanel>
          <PaneHandle label={t("inspector.resizeRequest")} hint={t("inspector.resizeHint")} />
          <ResizablePanel id="response" defaultSize={sizes.response} minSize={`${MAIN_MIN_PX}px`} className="min-h-0">
            {response}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

// 1px 선 + 넓은 눌림 영역. 가리키거나 끌거나 포커스되면 브랜드 색으로 바뀐다.
function PaneHandle({ label, hint }: { label: string; hint: string }) {
  return (
    <ResizableHandle
      aria-label={label}
      title={hint}
      className="z-10 w-px bg-line transition-colors after:w-2 data-[separator=active]:bg-brand data-[separator=focus]:bg-brand data-[separator=hover]:bg-brand-border"
    />
  );
}

// ---------- 도킹 패널 높이 ----------

interface DockSize {
  // 사용자가 정한 높이(px). null 이면 CSS 기본값
  height: number | null;
  // 지금 실제 높이와 그룹 높이 (관찰한 값)
  current: number;
  container: number;
  max: number;
  set: (height: number, persist: boolean) => void;
  reset: () => void;
}

function useElementHeight(el: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeight(Math.round(entry?.contentRect.height ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return height;
}

function useDockHeight(mode: DockMode, rootEl: HTMLElement | null, dockEl: HTMLElement | null): DockSize {
  const [heights, setHeights] = useState<Record<DockMode, number | null>>(() => ({
    desktop: parseDockHeight(safeStorage.getItem(DOCK_HEIGHT_KEYS.desktop)),
    mobile: parseDockHeight(safeStorage.getItem(DOCK_HEIGHT_KEYS.mobile)),
  }));
  const container = useElementHeight(rootEl);
  // contentRect 는 border 를 빼므로 위쪽 1px 선을 더한다
  const dockContent = useElementHeight(dockEl);
  const current = dockContent > 0 ? dockContent + 1 : DOCK_MIN_PX;
  const stored = heights[mode];
  // 창이 줄어 저장값이 너무 크면 화면에서만 줄인다 (저장값은 그대로)
  const height = stored === null ? null : container > 0 ? clampDockHeight(stored, container) : stored;

  const set = useCallback(
    (next: number, persist: boolean) => {
      const value = clampDockHeight(next, container);
      setHeights((prev) => ({ ...prev, [mode]: value }));
      if (persist) safeStorage.setItem(DOCK_HEIGHT_KEYS[mode], String(value));
    },
    [mode, container],
  );
  const reset = useCallback(() => {
    setHeights((prev) => ({ ...prev, [mode]: null }));
    safeStorage.removeItem(DOCK_HEIGHT_KEYS[mode]);
  }, [mode]);

  return { height, current, container, max: dockMaxHeight(container), set, reset };
}

// 도킹 패널 위쪽 가장자리의 가로 핸들. 선은 패널의 border-t 이고, 핸들은 그 위아래로 넓은 눌림 영역만 가진다.
function DockHandle({ size, label, hint }: { size: DockSize; label: string; hint: string }) {
  const drag = useRef<{ startY: number; startH: number; last: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startH = size.height ?? size.current;
    drag.current = { startY: e.clientY, startH, last: startH };
    setActive(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 위로 끌면(clientY 감소) 패널이 커진다
    d.last = d.startH + (d.startY - e.clientY);
    size.set(d.last, false);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (Math.abs(d.last - d.startH) >= 1) size.set(d.last, true);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 정한 높이가 있으면 그것부터 (관찰 값은 다음 프레임에야 바뀐다)
    const next = dockHeightForKey(e.key, size.height ?? size.current, size.container);
    if (next === null) return;
    e.preventDefault();
    size.set(next, true);
  };

  const now = size.height ?? size.current;
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={DOCK_MIN_PX}
      aria-valuemax={size.max}
      aria-valuenow={now}
      title={hint}
      tabIndex={0}
      data-dock-handle
      data-active={active || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={size.reset}
      onKeyDown={onKeyDown}
      className="absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none outline-hidden before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:transition-colors hover:before:bg-brand-border focus-visible:before:h-0.5 focus-visible:before:bg-brand data-[active]:before:bg-brand"
    />
  );
}
