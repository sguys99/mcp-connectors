"use client";

// Chat 화면 틀: 위에 툴바, 아래에 대화 열(스레드 + 고정 Composer)과 Trace 열 (final.html 의 .chat 그리드).
//
// * 데스크톱(901px 이상): react-resizable-panels(shadcn resizable)로 대화 | Trace 분할. Trace 기본 폭은 --trace-w
//   (420px, 1280px 이하 340px)이고, 핸들은 끌거나 방향키로 움직이며 aria-valuenow 가 따라 바뀐다. 두 번 누르면 기본 크기로 돌아간다.
//   사용자가 끈 비율은 폭 구간(wide, mid, narrow)마다 localStorage 에 저장한다 (lib/chat/layout.ts).
// * 모바일(900px 이하): 툴바 아래에 대화 / 추적 세그먼트 탭. 두 열을 모두 마운트해 두고 하나만 보여서,
//   추적을 보고 돌아와도 입력 중이던 글과 스크롤 위치가 그대로다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";

import { ChatSkeleton } from "@/components/skeletons/screens";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLayoutBand } from "@/components/inspector/use-layout-band";
import {
  readTraceWidth,
  THREAD_MIN_PX,
  TRACE_DEFAULT_PX,
  TRACE_MAX_PX,
  TRACE_MIN_PX,
  traceDefaultSizes,
  tracePanesKey,
} from "@/lib/chat/layout";
import { useT } from "@/lib/i18n/client";
import type { SplitBand } from "@/lib/inspector/layout";
import { safeStorage } from "@/lib/storage/safe-storage";
import { cn } from "@/lib/utils";

export type ChatPane = "thread" | "trace";

interface ChatLayoutProps {
  toolbar: ReactNode;
  // 대화 열: 스레드와 하단 Composer. 높이를 채우는(h-full) 세로 flex 컨테이너여야 한다.
  thread: ReactNode;
  trace: ReactNode;
  pane: ChatPane;
  onPane: (pane: ChatPane) => void;
}

export function ChatLayout({ toolbar, thread, trace, pane, onPane }: ChatLayoutProps) {
  const t = useT();
  const band = useLayoutBand();

  if (band === null) return <ChatSkeleton label={t("common.loading")} />;

  if (band === "mobile") {
    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)]">
        {toolbar}
        <div className="border-b border-line bg-background px-3 py-2">
          <Tabs value={pane} onValueChange={(v) => onPane(v as ChatPane)}>
            <TabsList aria-label={t("chat.panelsLabel")} className="h-9 w-full">
              <TabsTrigger value="thread">{t("chat.threadTab")}</TabsTrigger>
              <TabsTrigger value="trace">{t("chat.traceTab")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="min-h-0">
          <div className={cn("h-full min-h-0", pane !== "thread" && "hidden")}>{thread}</div>
          <div className={cn("h-full min-h-0", pane !== "trace" && "hidden")}>{trace}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      {toolbar}
      {/* key: 구간이 바뀌면 그 구간에 저장된 비율로 다시 시작한다 */}
      <DesktopPanes key={band} band={band} thread={thread} trace={trace} />
    </div>
  );
}

const PANEL_IDS = ["thread", "trace"];

// Trace 폭(px)을 퍼센트로 바꾸려면 그룹의 실제 폭이 필요하다 (Inspector 와 같은 이유). 마운트 직후 한 번 재서 기본 크기를 계산한다.
function DesktopPanes({ band, thread, trace }: { band: SplitBand; thread: ReactNode; trace: ReactNode }) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const layout = useDefaultLayout({
    id: tracePanesKey(band),
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
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sizes = width === null ? null : traceDefaultSizes(readTraceWidth(TRACE_DEFAULT_PX[band]), width);

  return (
    <div ref={hostRef} className="h-full min-h-0 min-w-0">
      {sizes === null ? (
        <ChatSkeleton label={t("common.loading")} />
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          id={tracePanesKey(band)}
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
          className="h-full min-h-0"
        >
          <ResizablePanel id="thread" defaultSize={sizes.thread} minSize={`${THREAD_MIN_PX}px`} className="min-h-0 min-w-0">
            {thread}
          </ResizablePanel>
          <ResizableHandle
            aria-label={t("chat.resizeTrace")}
            title={t("inspector.resizeHint")}
            className="z-10 w-px bg-line transition-colors after:w-2 data-[separator=active]:bg-brand data-[separator=focus]:bg-brand data-[separator=hover]:bg-brand-border"
          />
          <ResizablePanel
            id="trace"
            defaultSize={sizes.trace}
            minSize={`${TRACE_MIN_PX}px`}
            maxSize={`${TRACE_MAX_PX}px`}
            groupResizeBehavior="preserve-pixel-size"
            className="min-h-0 min-w-0"
          >
            {trace}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
