"use client";

// 대화 목록 상태 (사이드바). 저장소를 열어 목록을 읽고, 다른 탭의 변경(BroadcastChannel)과 창 포커스, 탭이 다시 보일 때 새로 읽는다.
// IndexedDB 를 쓸 수 없으면 status 가 "unavailable" 이 되고 목록은 비어 있다 (대화 자체는 저장 없이 동작한다).

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationMeta } from "./schema";
import { CHANNEL_NAME, getConversationStore, type ConversationStore } from "./store";

export type ListStatus = "loading" | "ready" | "unavailable";

export interface ConversationList {
  status: ListStatus;
  items: ConversationMeta[];
  store: ConversationStore | null;
  refresh: () => Promise<void>;
}

export function useConversationList(): ConversationList {
  const [status, setStatus] = useState<ListStatus>("loading");
  const [items, setItems] = useState<ConversationMeta[]>([]);
  const [store, setStore] = useState<ConversationStore | null>(null);
  const storeRef = useRef<ConversationStore | null>(null);

  const refresh = useCallback(async () => {
    const current = storeRef.current;
    if (!current) return;
    try {
      setItems(await current.listMeta());
    } catch {
      /* 읽지 못하면 이전 목록을 유지한다 */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // macrotask 로 미뤄 effect 안의 동기 setState 경고를 피한다 (다른 화면과 같은 방식).
    const tid = setTimeout(async () => {
      const candidate = getConversationStore();
      if (!candidate || !(await candidate.available())) {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      storeRef.current = candidate;
      try {
        const list = await candidate.listMeta();
        if (cancelled) return;
        setItems(list);
        setStore(candidate);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
  }, []);

  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => void refresh();
    }
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
    };
  }, [refresh]);

  return { status, items, store, refresh };
}
