"use client";

// 서버 상태 스냅샷을 셸 전체가 함께 쓰는 스토어. 탐색기, 상태바, 활동 바 배지, Dashboard 카드가
// 같은 값을 보고, 서버마다 ping 을 한 번만 보낸다. (이전에는 카드마다 따로 ping 했다.)
//
// * streamable_http 서버만 프록시(/api/mcp/<name>)로 ping 한다. stdio 는 항상 "na".
// * UI 타임아웃 5초는 client.ts 의 30초(callTool 상한)와 따로 둔다.
// * 점검이 끝나면 클라이언트를 닫고 버려 다음 확인이 새 세션을 만들게 한다 (서버 재기동 대비, 열린 SSE 스트림이 쌓이지 않게).
// * 탭이 보이는 동안 30초마다 조용히(silent) 다시 확인한다. silent 점검은 "checking" 으로 바꾸지 않아
//   점이 깜빡이지 않고, 숨겨진 탭에서는 멈췄다가 다시 보이면 마지막 점검이 30초를 넘었을 때만 바로 돌린다.
// * 점검 결과는 이력 스토어(지연 샘플, 마지막 점검 시각, 최근 로그)에도 쌓는다. 이 세션 한정이다.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useT } from "@/lib/i18n/client";
import { summarizeHealth, type HealthState, type HealthSummary } from "@/lib/shell/health";
import {
  emptyHistory,
  pruneHistory,
  recordCheck,
  type CheckOutcome,
  type HealthHistory,
} from "@/lib/shell/health-history";
import { createStore, type Store } from "@/lib/shell/store";
import { createMCPClient, type MCPClient } from "@/lib/mcp/client";
import type { PublicServer } from "@/lib/mcp/types";
import { describeNetworkFailure } from "@/lib/runtime/errors";

export const PING_UI_TIMEOUT_MS = 5_000;
// 백그라운드 재확인 주기.
export const RECHECK_INTERVAL_MS = 30_000;

export type HealthMap = Record<string, HealthState>;

const IDLE: HealthState = { status: "idle" };
const NA: HealthState = { status: "na" };

interface CheckOptions {
  // true 면 상태를 "checking" 으로 바꾸지 않는다 (주기 재확인용).
  silent?: boolean;
}

interface HealthApi {
  store: Store<HealthMap>;
  history: Store<HealthHistory>;
  check: (server: PublicServer, options?: CheckOptions) => Promise<void>;
  checkAll: () => Promise<void>;
}

const HealthContext = createContext<HealthApi | null>(null);

// 서버 정의가 바뀌었는지 알아보는 키 (런타임 서버는 수정 번호 rev 가 올라간다. 헤더 값은 키에 넣지 않는다).
function serverKey(s: PublicServer): string {
  const rt = s.transport === "streamable_http" ? s.runtime : undefined;
  return `${s.name}:${s.transport}${rt ? `:${rt.mode}:${rt.target}:${rt.rev}` : ""}`;
}

function initialMap(servers: readonly PublicServer[]): HealthMap {
  const map: HealthMap = {};
  for (const s of servers) map[s.name] = s.transport === "stdio" ? NA : IDLE;
  return map;
}

export function HealthProvider({
  servers,
  children,
}: {
  servers: readonly PublicServer[];
  children: ReactNode;
}) {
  const t = useT();
  const [store] = useState(() => createStore<HealthMap>(initialMap(servers)));
  const [history] = useState(() => createStore<HealthHistory>(emptyHistory()));
  const eventId = useRef(0);
  const lastRecheckAt = useRef(0);
  const clients = useRef(new Map<string, MCPClient>());
  // 언어를 바꿔도 재확인하지 않도록 번역기와 서버 목록은 ref 로 읽는다.
  const tRef = useRef(t);
  const serversRef = useRef(servers);
  useEffect(() => {
    tRef.current = t;
    serversRef.current = servers;
  }, [t, servers]);

  const drop = useCallback(async (name: string) => {
    const stale = clients.current.get(name);
    clients.current.delete(name);
    if (!stale) return;
    try {
      await stale.close();
    } catch {
      /* 이미 끊긴 연결은 무시 */
    }
  }, []);

  const record = useCallback(
    (name: string, outcome: CheckOutcome, background: boolean) => {
      eventId.current += 1;
      const id = eventId.current;
      history.set((prev) => recordCheck(prev, name, outcome, Date.now(), id, background));
    },
    [history],
  );

  const check = useCallback(
    async (server: PublicServer, options?: CheckOptions) => {
      if (server.transport === "stdio") return;
      const { name } = server;
      const silent = options?.silent === true;
      if (!silent) store.set((prev) => ({ ...prev, [name]: { status: "checking" } }));

      let client = clients.current.get(name);
      if (!client) {
        client = createMCPClient(server);
        clients.current.set(name, client);
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(tRef.current("errors.pingTimeout", { s: PING_UI_TIMEOUT_MS / 1000 }))),
          PING_UI_TIMEOUT_MS,
        );
      });

      try {
        const result = await Promise.race([client.ping(), timeout]);
        if (result.ok) {
          store.set((prev) => ({
            ...prev,
            [name]: {
              status: "healthy",
              latencyMs: result.latencyMs,
              toolCount: result.toolCount,
              protocolVersion: result.protocolVersion,
            },
          }));
          record(name, { ok: true, latencyMs: result.latencyMs, toolCount: result.toolCount }, silent);
        } else {
          const error = describeNetworkFailure(server, result.errorKind, tRef.current) ?? result.error ?? tRef.current("errors.unknown");
          store.set((prev) => ({ ...prev, [name]: { status: "offline", error } }));
          record(name, { ok: false, error }, silent);
          await drop(name);
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        store.set((prev) => ({ ...prev, [name]: { status: "offline", error } }));
        record(name, { ok: false, error }, silent);
        await drop(name);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        // 확인이 끝나면 연결을 닫는다(세션 종료 DELETE 포함). 붙잡아 두면 서버마다 GET SSE 스트림이 하나씩 열린 채 남아
        // 브라우저의 호스트당 연결 수(HTTP/1.1 은 6개)를 쓴다. 레지스트리 서버 세 개를 두 탭에서 열면 같은 origin 의 프록시로
        // 가는 스트림만 6개가 되어 Chat 의 /api/chat 요청과 화면 이동이 멈췄다. 직결 런타임 서버는 Inspector 와 팔레트가 여는
        // 연결과도 겹친다. 30초마다 새로 여는 비용(initialize 왕복)은 작고, 지연 값은 연결 뒤 tools/list 왕복만 잰다.
        await drop(name);
      }
    },
    [store, drop, record],
  );

  const checkAll = useCallback(async () => {
    const pending = serversRef.current.filter(
      (s) => s.transport !== "stdio" && store.get()[s.name]?.status !== "checking",
    );
    await Promise.all(pending.map((s) => check(s)));
  }, [store, check]);

  // 탭이 보이는 동안 30초마다 조용히 다시 확인한다. 첫 확인 전(idle)이거나 점검 중인 서버는 건너뛴다.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      lastRecheckAt.current = Date.now();
      const due = serversRef.current.filter((s) => {
        if (s.transport === "stdio") return false;
        const status = (store.get()[s.name] ?? IDLE).status;
        return status !== "checking" && status !== "idle";
      });
      void Promise.all(due.map((s) => check(s, { silent: true })));
    };
    lastRecheckAt.current = Date.now();
    const timerId = setInterval(recheck, RECHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRecheckAt.current >= RECHECK_INTERVAL_MS) {
        recheck();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store, check]);

  // 서버 목록이 바뀌면(레지스트리 새로고침, 런타임 서버 추가/수정/삭제) 새 항목을 채우고 첫 확인을 돌린다.
  // 런타임 서버를 고치거나 지우면 이전 연결(클라이언트)을 닫고, 고친 서버는 처음 상태로 되돌려 다시 확인한다.
  const serversKey = servers.map((s) => serverKey(s)).join("|");
  const prevKeys = useRef(new Map<string, string>());
  useEffect(() => {
    const nextKeys = new Map(serversRef.current.map((s) => [s.name, serverKey(s)] as const));
    const changed = new Set<string>();
    for (const [name, key] of prevKeys.current) {
      if (nextKeys.get(name) !== key) {
        changed.add(name);
        void drop(name);
      }
    }
    prevKeys.current = nextKeys;
    store.set((prev) => {
      const next: HealthMap = {};
      for (const s of serversRef.current) {
        const fresh = s.transport === "stdio" ? NA : IDLE;
        next[s.name] = changed.has(s.name) ? fresh : (prev[s.name] ?? fresh);
      }
      return next;
    });
    const names = new Set(serversRef.current.map((s) => s.name));
    history.set((prev) => pruneHistory(prev, names));
    // effect 본체와 다른 macrotask 에서 첫 ping (react-hooks/set-state-in-effect 회피, 기존 패턴과 동일).
    const timerId = setTimeout(() => {
      const fresh = serversRef.current.filter(
        (s) => s.transport !== "stdio" && (store.get()[s.name] ?? IDLE).status === "idle",
      );
      void Promise.all(fresh.map((s) => check(s)));
    }, 0);
    return () => clearTimeout(timerId);
  }, [serversKey, store, history, check, drop]);

  // 셸이 사라질 때(전체 새로고침 등) 열린 세션을 닫는다.
  useEffect(() => {
    const open = clients.current;
    return () => {
      for (const client of open.values()) void client.close().catch(() => {});
      open.clear();
    };
  }, []);

  const api = useMemo<HealthApi>(() => ({ store, history, check, checkAll }), [store, history, check, checkAll]);
  return <HealthContext.Provider value={api}>{children}</HealthContext.Provider>;
}

function useHealthApi(): HealthApi {
  const api = useContext(HealthContext);
  if (!api) throw new Error("health hooks must be used inside <HealthProvider>");
  return api;
}

// 서버 하나의 상태. 확인 전에는 idle, stdio 는 na.
export function useServerHealth(server: PublicServer): HealthState {
  const { store } = useHealthApi();
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.get()[server.name],
    () => undefined,
  );
  return state ?? (server.transport === "stdio" ? NA : IDLE);
}

// 이름으로 읽는 상태. 서버를 모르면 undefined.
export function useServerHealthByName(name: string | null): HealthState | undefined {
  const { store } = useHealthApi();
  return useSyncExternalStore(
    store.subscribe,
    () => (name ? store.get()[name] : undefined),
    () => undefined,
  );
}

// 전체 서버 상태 맵 (Dashboard 가 한 번에 구독한다).
export function useHealthMap(): HealthMap {
  const { store } = useHealthApi();
  return useSyncExternalStore(store.subscribe, store.get, store.getInitial);
}

export function useHealthSummary(): HealthSummary {
  const { store } = useHealthApi();
  const map = useSyncExternalStore(store.subscribe, store.get, store.getInitial);
  return useMemo(() => summarizeHealth(Object.values(map)), [map]);
}

// 이번 세션의 점검 이력 (지연 샘플, 마지막 점검 시각, 마지막으로 안 도구 수, 최근 로그).
export function useHealthHistory(): HealthHistory {
  const { history } = useHealthApi();
  return useSyncExternalStore(history.subscribe, history.get, history.getInitial);
}

export function useHealthActions(): {
  check: HealthApi["check"];
  checkAll: HealthApi["checkAll"];
  // 지금 시점의 전체 상태 (await checkAll() 직후처럼 렌더를 기다릴 수 없을 때 쓴다).
  getHealth: () => HealthMap;
} {
  const { check, checkAll, store } = useHealthApi();
  return { check, checkAll, getHealth: store.get };
}
