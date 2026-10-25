"use client";

// 지금 화면의 대화를 저장소와 이어 주는 훅 (P5-7).
//
//   * 자동 저장: 대화가 바뀌면(질문, 답변 확정, 모델이나 서버 변경) 300ms 뒤에 저장한다. 실행 중(streaming)에는 저장하지 않고 끝난 뒤 저장한다.
//     창을 닫거나 숨길 때, 화면을 떠날 때는 기다리지 않고 바로 저장한다. 쓰기는 한 줄로 이어 붙여 순서가 뒤바뀌지 않는다.
//   * 첫 질문을 보낼 때 id 를 만들고 주소를 ?c=<id> 로 바꾼다 (새로고침하거나 링크로 같은 대화를 연다).
//   * 열기: 저장된 대화를 불러와 화면(useChatStream.restore)과 툴바 값(모델, 반복, 승인, 노출 서버)을 되돌린다. 승인 대기는 만료로 표시한다.
//   * 세션 토큰 합계: 대화를 바꿀 때 지금 대화에서 "이 세션에 새로 쓴 만큼"(전체 - 열 때의 값)만 합계에 넘긴다.
//   * 저장소를 쓸 수 없으면(store 가 null) 아무것도 저장하지 않고 대화는 그대로 동작한다.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatTurn } from "@/lib/chat/serialize";
import { conversationUsage, subtractUsage } from "@/lib/chat/usage";
import type { TokenUsage } from "@/lib/llm/usage";

import {
  autoTitle,
  buildStoredConversation,
  newConversationId,
  restoreTurns,
  type ApprovalSetting,
  type ProviderId,
  type StoredConversation,
} from "./schema";
import type { ConversationStore } from "./store";

export interface SessionSnapshot {
  provider: ProviderId;
  model: string;
  maxIterations: number;
  approval: ApprovalSetting;
  servers: readonly string[];
  runtimeServers: readonly string[];
}

export interface SessionChat {
  turns: ChatTurn[];
  status: "idle" | "streaming" | "awaiting" | "error";
  allowedTools: readonly string[];
  restore: (turns: ChatTurn[], allowedTools: readonly string[], archive?: TokenUsage | null) => void;
  reset: (archive?: TokenUsage | null) => void;
}

interface Options {
  store: ConversationStore | null;
  refresh: () => Promise<void>;
  chat: SessionChat;
  snapshot: SessionSnapshot;
  // 설정을 읽어 snapshot 이 믿을 만해졌는지
  ready: boolean;
  // 저장된 대화를 연 직후 툴바 값을 되돌린다
  onRestore: (record: StoredConversation) => void;
  onSaveError: (reason: "quota" | "error") => void;
}

export interface ConversationSession {
  activeId: string | null;
  // 저장된 대화를 열 때 이미 들어 있던 토큰 사용량 (세션 합계에서 뺀다). 새 대화이면 null.
  baseline: TokenUsage | null;
  open: (id: string) => Promise<"opened" | "missing" | "unavailable">;
  startNew: () => Promise<void>;
  // 대화를 지운다 (저장된 것 포함). id 를 주면 그 대화, 생략하면 지금 대화.
  remove: (id?: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<boolean>;
  // 다른 곳(가져오기 등)에서 저장소를 바꿨을 때 목록을 새로 읽게 한다
  refresh: () => Promise<void>;
}

function replaceUrl(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("c", id);
      url.searchParams.delete("server");
    } else {
      url.searchParams.delete("c");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* 주소를 못 바꿔도 저장은 동작한다 */
  }
}

function signature(snapshot: SessionSnapshot, allowedTools: readonly string[]): string {
  return JSON.stringify([snapshot.provider, snapshot.model, snapshot.maxIterations, snapshot.approval, snapshot.servers, snapshot.runtimeServers, allowedTools]);
}

export function useConversationSession({ store, refresh, chat, snapshot, ready, onRestore, onSaveError }: Options): ConversationSession {
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [baseline, setBaselineState] = useState<TokenUsage | null>(null);

  // 렌더와 무관하게 최신 값을 읽는 ref 들 (이벤트 핸들러와 타이머에서 쓴다)
  const activeRef = useRef<string | null>(null);
  const createdAtRef = useRef(0);
  const titleRef = useRef<{ title: string; auto: boolean }>({ title: "", auto: true });
  const baselineRef = useRef<TokenUsage | null>(null);
  const savedRef = useRef<{ turns: ChatTurn[] | null; sig: string | null }>({ turns: null, sig: null });
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ chat, snapshot, store, onSaveError, refresh });
  useEffect(() => {
    latestRef.current = { chat, snapshot, store, onSaveError, refresh };
  });

  const setBaseline = useCallback((usage: TokenUsage | null) => {
    baselineRef.current = usage;
    setBaselineState(usage);
  }, []);

  const setActive = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
  }, []);

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job, job);
    queueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  // 지금 대화를 저장 줄에 올린다.
  const saveNow = useCallback(() => {
    const { chat: c, snapshot: s, store: st, onSaveError: fail, refresh: reload } = latestRef.current;
    if (!st || c.turns.length === 0) return;
    let id = activeRef.current;
    if (!id) {
      id = newConversationId();
      const first = c.turns[0];
      createdAtRef.current = first && first.role === "user" && first.at ? first.at : Date.now();
      titleRef.current = { title: "", auto: true };
      setActive(id);
      replaceUrl(id);
    }
    const title = titleRef.current.auto ? autoTitle(c.turns) : titleRef.current.title;
    const record = buildStoredConversation({
      id,
      createdAt: createdAtRef.current || Date.now(),
      updatedAt: Date.now(),
      title,
      titleAuto: titleRef.current.auto,
      provider: s.provider,
      model: s.model,
      maxIterations: s.maxIterations,
      approval: s.approval,
      servers: s.servers,
      runtimeServers: s.runtimeServers,
      allowedTools: c.allowedTools,
      turns: c.turns,
    });
    savedRef.current = { turns: c.turns, sig: signature(s, c.allowedTools) };
    void enqueue(async () => {
      const result = await st.put(record);
      if (result.ok) await reload();
      else fail(result.reason);
    });
  }, [enqueue, setActive]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  }, []);

  // 대화나 설정이 바뀌면 저장을 예약한다.
  const sig = signature(snapshot, chat.allowedTools);
  useEffect(() => {
    if (!ready || !store || chat.turns.length === 0 || chat.status === "streaming") return;
    if (savedRef.current.turns === chat.turns && savedRef.current.sig === sig) return;
    pendingRef.current = saveNow;
    timerRef.current = setTimeout(flush, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [ready, store, chat.turns, chat.status, sig, saveNow, flush]);

  // 창을 숨기거나 닫을 때, 화면을 떠날 때는 기다리지 않고 저장한다.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const incremental = useCallback((): TokenUsage | null => {
    return subtractUsage(conversationUsage(latestRef.current.chat.turns).usage, baselineRef.current);
  }, []);

  const resetRefs = useCallback(() => {
    setActive(null);
    createdAtRef.current = 0;
    titleRef.current = { title: "", auto: true };
    setBaseline(null);
    savedRef.current = { turns: null, sig: null };
  }, [setActive, setBaseline]);

  const open = useCallback(
    async (id: string): Promise<"opened" | "missing" | "unavailable"> => {
      const st = latestRef.current.store;
      if (!st) return "unavailable";
      if (id === activeRef.current) return "opened";
      flush();
      await queueRef.current;
      let record: StoredConversation | null;
      try {
        record = await st.get(id);
      } catch {
        return "unavailable";
      }
      if (!record) {
        await latestRef.current.refresh();
        return "missing";
      }
      const archive = incremental();
      const turns = restoreTurns(record.turns);
      latestRef.current.chat.restore(turns, record.allowedTools, archive);
      setActive(record.id);
      createdAtRef.current = record.createdAt;
      titleRef.current = { title: record.title, auto: record.titleAuto };
      setBaseline(conversationUsage(turns).usage);
      savedRef.current = {
        turns,
        sig: signature(
          { provider: record.provider, model: record.model, maxIterations: record.maxIterations, approval: record.approval, servers: record.servers, runtimeServers: record.runtimeServers },
          record.allowedTools,
        ),
      };
      replaceUrl(record.id);
      onRestore(record);
      return "opened";
    },
    [flush, incremental, onRestore, setActive, setBaseline],
  );

  const startNew = useCallback(async () => {
    flush();
    await queueRef.current;
    const archive = incremental();
    latestRef.current.chat.reset(archive);
    resetRefs();
    replaceUrl(null);
  }, [flush, incremental, resetRefs]);

  const remove = useCallback(
    async (id?: string) => {
      const target = id ?? activeRef.current;
      const st = latestRef.current.store;
      const isActive = target !== null && target === activeRef.current;
      if (isActive || target === null) {
        // 예약된 저장이 지운 대화를 되살리지 않게 비운다.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingRef.current = null;
        const archive = incremental();
        latestRef.current.chat.reset(archive);
        resetRefs();
        replaceUrl(null);
      }
      if (st && target) {
        await enqueue(() => st.remove(target)).catch(() => undefined);
        await latestRef.current.refresh();
      }
    },
    [enqueue, incremental, resetRefs],
  );

  const rename = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const st = latestRef.current.store;
      if (!st) return false;
      if (id === activeRef.current) titleRef.current = { title, auto: false };
      const ok = await enqueue(() => st.rename(id, title)).catch(() => false);
      await latestRef.current.refresh();
      return ok;
    },
    [enqueue],
  );

  return { activeId, baseline, open, startNew, remove, rename, refresh };
}
