"use client";

// 앱 셸이 화면에 열어 주는 API.
//
//   useShell()            서버 목록, 팔레트, 서버 선택 같은 동작
//   useShellMeta({...})   화면이 브레드크럼, 상태바 값을 올린다 (언마운트하면 지워짐)
//   useShellMetaValue()   셸 컴포넌트가 그 값을 읽는다
//   useSelectedServer()   선택된 서버 이름 (meta.server, 없으면 URL 의 ?server=)
//   <SidebarSlot>         화면이 사이드바 영역을 채운다 (포털)

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { PublicServer } from "@/lib/mcp/types";
import { usesServerParam } from "@/lib/shell/routes";
import type { Store } from "@/lib/shell/store";

export interface ShellMeta {
  // 화면이 보고 있는 서버. URL 보다 우선한다 (Inspector 가 드롭다운으로 바꾼 경우 등).
  server?: string | null;
  // 브레드크럼 끝 항목. 없으면 선택된 서버, Dashboard 는 레지스트리 파일 경로.
  crumb?: string | null;
  // Chat 상태바에 보일 모델 이름.
  model?: string | null;
  // 마지막 도구 호출 소요 시간(ms)과 p50. 실측값이 있을 때만 넘긴다.
  lastCallMs?: number | null;
  p50Ms?: number | null;
  // 화면의 숫자가 샘플일 때만 true. 상태바에 "Sample data" 태그가 붙는다.
  sample?: boolean;
}

export interface SlotTargets {
  filledStore: Store<boolean>;
  desktopTarget: HTMLElement | null;
  mobileTarget: HTMLElement | null;
  isMobile: boolean;
}

// 서버 추가/수정 대화상자 상태 (Phase 5, P5-5)
export type ServerDialogState = { mode: "add" } | { mode: "edit"; name: string } | null;

export interface ShellApi {
  // 레지스트리 서버 + 이 세션의 런타임 서버 (런타임 항목은 runtime 필드가 있다)
  servers: readonly PublicServer[];
  // 서버 env MCP_ALLOW_RUNTIME_PROXY=true 인지 (꺼져 있으면 프록시 연결 방식을 고를 수 없다)
  runtimeProxyEnabled: boolean;
  serverDialog: ServerDialogState;
  openAddServer: () => void;
  openEditServer: (name: string) => void;
  closeServerDialog: () => void;
  // 런타임 서버 삭제 (확인 대화상자를 거친다)
  requestRemoveServer: (name: string) => void;
  // 클라이언트 설정 복사 대화상자 (서버 이름, 닫혀 있으면 null)
  configTarget: string | null;
  openClientConfig: (name: string) => void;
  closeClientConfig: () => void;
  metaStore: Store<ShellMeta>;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  // 현재 화면이 ?server= 를 쓰면 그대로 두고 값만 바꾸고(Inspector), 아니면 Inspector 로 간다(Dashboard).
  selectServer: (name: string) => void;
  // 어느 화면에서든 Inspector 에서 연다 (팔레트).
  openServerInInspector: (name: string) => void;
  // 서버 목록 새로고침 (레지스트리를 다시 읽고 상태를 다시 확인).
  refreshServers: () => void;
}

export const ShellContext = createContext<ShellApi | null>(null);
export const SlotContext = createContext<SlotTargets | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

export function useShellMetaValue(): ShellMeta {
  const { metaStore } = useShell();
  return useSyncExternalStore(metaStore.subscribe, metaStore.get, metaStore.getInitial);
}

export function useShellMeta(meta: ShellMeta) {
  const { metaStore } = useShell();
  const { server, crumb, model, lastCallMs, p50Ms, sample } = meta;
  useEffect(() => {
    const patch: ShellMeta = {};
    if (server !== undefined) patch.server = server;
    if (crumb !== undefined) patch.crumb = crumb;
    if (model !== undefined) patch.model = model;
    if (lastCallMs !== undefined) patch.lastCallMs = lastCallMs;
    if (p50Ms !== undefined) patch.p50Ms = p50Ms;
    if (sample !== undefined) patch.sample = sample;
    const keys = Object.keys(patch) as (keyof ShellMeta)[];
    metaStore.set((prev) => ({ ...prev, ...patch }));
    return () => {
      metaStore.set((prev) => {
        const next = { ...prev };
        for (const key of keys) delete next[key];
        return next;
      });
    };
  }, [metaStore, server, crumb, model, lastCallMs, p50Ms, sample]);
}

export function useSelectedServer(): string | null {
  const meta = useShellMetaValue();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (meta.server !== undefined) return meta.server;
  return usesServerParam(pathname) ? searchParams.get("server") : null;
}

// 화면이 사이드바 영역을 채운다. 데스크톱에서는 사이드바 열, 모바일에서는 드로어 안에 그려진다.
// 내용은 이 컴포넌트를 렌더한 쪽(화면)의 React 트리에 남아 있어 상태와 이벤트가 그대로 이어진다.
// 한 화면에서는 하나만 쓴다. 비어 있으면(채우는 화면이 없으면) 사이드바 열이 접힌다.
export function SidebarSlot({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  if (!slot) throw new Error("SidebarSlot must be used inside <AppShell>");
  const { filledStore } = slot;
  useEffect(() => {
    filledStore.set(true);
    return () => filledStore.set(false);
  }, [filledStore]);
  const target = slot.isMobile ? slot.mobileTarget : slot.desktopTarget;
  return target ? createPortal(children, target) : null;
}
