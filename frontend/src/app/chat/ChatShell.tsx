// Chat 화면 조립 (use client).
// 책임:
//   - 설정(제공자, 모델, API 키) 로딩 (mount 시 + focus 시 reload), 노출 서버 선택 (localStorage 저장)
//   - useChatStream (SSE 실행) 과 화면 컴포넌트 합성: 툴바, 스레드, 고정 Composer, Trace 열, 사이드바(노출 서버)
//   - 도구 카드와 trace 스팬의 연동 상태(선택, 강조), 모바일 대화/추적 탭
//   - API key 미설정, 서버 없음 같은 가드
// 시계: 진행 중인 실행의 스팬은 useClock 이 흘려 주는 시각으로 자란다 (lib/chat/trace 는 순수 함수).
//
// 실행 제어 (툴바): 모델(제공자 포함), 최대 반복, 승인 방식은 이 페이지(대화)에만 적용되는 값이다.
//   * 시작값은 설정(Settings)의 제공자, 모델, 기본 최대 반복이고 승인 방식은 항상 자동이다. 설정을 고치면 아직 건드리지 않은 값은 따라간다.
//   * 툴바에서 바꾼 값은 설정에 저장하지 않는다 (시안의 툴바는 대화 상태이고 설정은 기본값이라는 구분을 따른다).
//     새로고침하면 설정 값으로 돌아간다. 단, 대화를 저장할 때 이 값들을 대화에 함께 담고, 저장된 대화를 열면 그 값으로 되돌린다 (P5-7).
//
// 대화 저장 (P5-7): 대화는 IndexedDB 에 자동 저장되고 사이드바 목록에서 열고, 이름을 바꾸고, 내보내고, 지운다.
//   저장소를 쓸 수 없으면 목록에 안내만 보이고 채팅은 그대로 동작한다. ?c=<id> 로 같은 대화를 다시 연다.

"use client";

import { MessagesSquareIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatLayout, type ChatPane } from "@/components/chat/ChatLayout";
import { ChatToolbar } from "@/components/chat/ChatToolbar";
import { ConversationList } from "@/components/chat/ConversationList";
import { Composer } from "@/components/chat/Composer";
import { Thread } from "@/components/chat/Thread";
import { ToolsExposed } from "@/components/chat/ToolsExposed";
import { TracePanel, type TraceTurnView } from "@/components/chat/TracePanel";
import { useClock } from "@/components/chat/use-clock";
import { useHealthMap } from "@/components/shell/health-store";
import { useShell, useShellMeta, SidebarSlot, SidebarSlotEmpty } from "@/components/shell/shell-context";
import { useMediaQuery, MOBILE_QUERY } from "@/components/shell/use-media-query";
import { ChatSkeleton } from "@/components/skeletons/screens";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  effectiveExposed,
  loadExposed,
  resolveExposed,
  saveExposed,
  toggleExposed,
} from "@/lib/chat/exposure";
import {
  streamingAsTurnView,
  type AssistantTurn,
  type ChatTurn,
} from "@/lib/chat/serialize";
import { autoTitle, type StoredConversation } from "@/lib/chat/history/schema";
import { useConversationList } from "@/lib/chat/history/useConversationList";
import { useConversationSession } from "@/lib/chat/history/useConversationSession";
import { conversationUsage, latestUsage, sessionTotal, subtractUsage } from "@/lib/chat/usage";
import { suggestionKeys } from "@/lib/chat/suggestions";
import { buildTurnTrace, type TurnTrace } from "@/lib/chat/trace";
import { useChatStream, type ApprovalMode, type SendOptions } from "@/lib/chat/useChatStream";
import { loadApprovalPref, saveApprovalPref, stricterApproval } from "@/lib/chat/approval-pref";
import { useT } from "@/lib/i18n/client";
import { clampIterations, DEFAULT_MAX_ITERATIONS } from "@/lib/llm/constants";
import { PROVIDER_LABELS, type LLMProvider } from "@/lib/llm/models";
import { contextWindow } from "@/lib/llm/usage";
import type { StreamableHttpServer } from "@/lib/mcp/types";
import { headersRecord } from "@/lib/runtime/connection";
import { findRuntimeServer } from "@/lib/runtime/store";
import {
  loadSettings,
  type MCPSettings,
} from "@/lib/storage/settings";
import { notify } from "@/lib/ui/notify";

interface ChatShellProps {
  // 예전 링크의 ?server= 값. 있으면 그 서버만 노출한 채로 시작한다.
  initialServerFromUrl: string | null;
  // ?c= 값. 있으면 저장된 그 대화를 연다.
  initialConversationId: string | null;
  // page.tsx 가 레지스트리에서 읽은 HTTP 서버 목록 (url 은 프록시 경로).
  reachable: readonly StreamableHttpServer[];
  // provider 별 서버 env 키 존재 여부. true 면 브라우저 키 없이도 전송 가능.
  serverKeys: Record<MCPSettings["llmProvider"], boolean>;
  // 가짜 LLM(CHAT_MOCK_LLM=1)이 켜져 있으면 키 없이도 전송할 수 있다 (e2e 전용).
  mockLlm: boolean;
}

function pickApiKey(s: MCPSettings, provider: LLMProvider): string {
  switch (provider) {
    case "anthropic":
      return s.anthropicApiKey;
    case "openai":
      return s.openaiApiKey;
    case "openrouter":
      return s.openrouterApiKey;
  }
}

function pickModel(s: MCPSettings, provider: LLMProvider): string {
  switch (provider) {
    case "anthropic":
      return s.anthropicModel;
    case "openai":
      return s.openaiModel;
    case "openrouter":
      return s.openrouterModel;
  }
}

const CRUMB_MAX = 34;

export default function ChatShell({
  initialServerFromUrl,
  initialConversationId,
  reachable: registryReachable,
  serverKeys,
  mockLlm,
}: ChatShellProps) {
  const t = useT();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { confirm, confirmDialog } = useConfirm();

  const [settings, setSettings] = useState<MCPSettings | null>(null);
  // 모델에 노출하도록 체크한 서버 이름들 (null = 아직 읽지 않음)
  const [selected, setSelected] = useState<string[] | null>(null);
  const [pane, setPane] = useState<ChatPane>("thread");
  // 툴바에서 고른 제공자와 모델 (null 이면 설정 값을 따른다), 최대 반복 (null 이면 설정의 기본값), 승인 방식
  const [choice, setChoice] = useState<{ provider: LLMProvider; model: string } | null>(null);
  const [iterations, setIterations] = useState<number | null>(null);
  const [approval, setApproval] = useState<ApprovalMode>("auto");
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [linkedSpanId, setLinkedSpanId] = useState<string | null>(null);
  const [stickSignal, setStickSignal] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chat = useChatStream();
  const health = useHealthMap();

  // 레지스트리 서버 + 이 탭의 런타임 서버. /api/chat 이 MCP 를 서버 쪽에서 부르므로 프록시 방식 런타임 서버만 노출할 수 있고,
  // 브라우저 직결 서버는 목록에 보이되 이유와 함께 선택할 수 없다.
  const { servers: shellServers } = useShell();
  const runtimeHttp = useMemo(
    () => shellServers.filter((s): s is StreamableHttpServer => s.transport === "streamable_http" && Boolean(s.runtime)),
    [shellServers],
  );
  const reachable = useMemo(() => [...registryReachable, ...runtimeHttp], [registryReachable, runtimeHttp]);
  const unavailable = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of runtimeHttp) if (s.runtime?.mode === "direct") out[s.name] = t("runtime.chatDirectUnavailable");
    return out;
  }, [runtimeHttp, t]);
  const reachableNames = useMemo(
    () => reachable.filter((s) => unavailable[s.name] === undefined).map((s) => s.name),
    [reachable, unavailable],
  );

  // Mount 시 설정과 노출 서버 선택을 읽고, focus 시 설정만 다시 읽는다 (설정 화면에서 바꾼 값 반영).
  // setTimeout(..., 0) macrotask 분리 — React 19 의 set-state-in-effect 경고 회피
  // (Inspector / HealthIndicator / Settings 페이지와 동일 패턴).
  useEffect(() => {
    const tid = setTimeout(() => {
      setSettings(loadSettings());
      // 이 탭에서 고른 승인 방식 (새로고침해도 수동이 자동으로 돌아가지 않게, lib/chat/approval-pref.ts)
      setApproval(loadApprovalPref());
      setSelected(
        resolveExposed({
          stored: loadExposed(),
          urlServer: initialServerFromUrl,
          reachable: reachableNames,
        }),
      );
    }, 0);
    const reload = () => setSettings(loadSettings());
    window.addEventListener("focus", reload);
    return () => {
      clearTimeout(tid);
      window.removeEventListener("focus", reload);
    };
  }, [initialServerFromUrl, reachableNames]);

  // ----- 노출 서버 ----- //

  const offline = useMemo(
    () => new Set(reachableNames.filter((name) => health[name]?.status === "offline")),
    [reachableNames, health],
  );
  const effective = useMemo(
    () => effectiveExposed(selected ?? [], offline),
    [selected, offline],
  );
  const toolCount = useMemo(
    () =>
      effective.reduce((sum, name) => {
        const h = health[name];
        return sum + (h?.status === "healthy" ? (h.toolCount ?? 0) : 0);
      }, 0),
    [effective, health],
  );

  const handleToggle = useCallback(
    (name: string, on: boolean) => {
      const next = toggleExposed(selected ?? [], reachableNames, name, on);
      setSelected(next);
      saveExposed(next);
    },
    [selected, reachableNames],
  );

  // ----- 실행 (SSE) ----- //

  // 실제로 쓰는 제공자, 모델, 최대 반복 (툴바 선택이 설정보다 우선)
  const provider: LLMProvider = choice?.provider ?? settings?.llmProvider ?? "anthropic";
  const model = choice?.provider === provider ? choice.model : settings ? pickModel(settings, provider) : "";
  const maxIterations = iterations ?? clampIterations(settings?.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
  const apiKey = settings ? pickApiKey(settings, provider) : "";
  const apiKeyMissing =
    settings !== null &&
    apiKey.length === 0 &&
    !serverKeys[provider] &&
    !mockLlm;
  const noServers = effective.length === 0;
  const sendBlocked = apiKeyMissing || noServers;
  const streaming = chat.status === "streaming";
  const awaitingTurn = (() => {
    const last = chat.turns[chat.turns.length - 1];
    return last?.role === "assistant" && last.stopReason === "awaiting_approval" ? last : null;
  })();
  // 실행 중이거나 승인을 기다리는 동안은 새 질문을 보낼 수 없다 (Stop 으로 끝낼 수 있다).
  const busy = streaming || awaitingTurn !== null;

  // 요청에 싣는 설정. 보내기와 승인 뒤 이어서 실행하는 요청이 같은 값을 쓴다.
  const buildOptions = useCallback(
    (): SendOptions | null =>
      settings
        ? {
            provider,
            // 비어 있으면 서버 env 키 사용 (api/chat route).
            ...(apiKey.length > 0 ? { apiKey } : {}),
            model,
            serverNames: effective,
            // 프록시 방식 런타임 서버는 정의 (URL 과 헤더) 를 이 요청에 실어 보낸다. 서버가 같은 문과 검사로 받는다.
            runtimeServers: effective.flatMap((name) => {
              const def = findRuntimeServer(name);
              return def && def.mode === "proxy" ? [{ name, url: def.url, headers: headersRecord(def) }] : [];
            }),
            systemPromptOverride: settings.systemPromptOverride ?? null,
            maxIterations,
            approval,
          }
        : null,
    [settings, provider, apiKey, model, effective, maxIterations, approval],
  );

  // ----- 대화 저장 (IndexedDB) ----- //

  const list = useConversationList();
  const runtimeNames = useMemo(() => new Set(runtimeHttp.map((s) => s.name)), [runtimeHttp]);
  const quotaToastRef = useRef(false);
  const handleRestore = useCallback(
    (record: StoredConversation) => {
      setChoice({ provider: record.provider, model: record.model });
      setIterations(record.maxIterations);
      // 수동은 조용히 자동으로 바뀌지 않는다: 저장된 방식과 지금 방식 중 더 엄격한 쪽
      setApproval((current) => {
        const next = stricterApproval(record.approval, current);
        saveApprovalPref(next);
        return next;
      });
      // 노출 서버: 그 대화가 쓰던 서버 중 지금도 접속할 수 있는 것. 하나도 없으면 지금 선택을 그대로 둔다.
      const names = reachableNames.filter((name) => record.servers.includes(name));
      if (names.length > 0) setSelected(names);
      setSelectedSpanId(null);
      setLinkedSpanId(null);
      setPane("thread");
      setStickSignal((n) => n + 1);
    },
    [reachableNames],
  );
  const handleApprovalChange = useCallback((mode: ApprovalMode) => {
    setApproval(mode);
    saveApprovalPref(mode);
  }, []);
  const handleSaveError = useCallback(
    (reason: "quota" | "error") => {
      // 저장할 때마다 같은 실패를 알리면 시끄러우므로 이 페이지에서는 한 번만 알린다.
      if (quotaToastRef.current) return;
      quotaToastRef.current = true;
      notify.error(t(reason === "quota" ? "conversations.saveQuota" : "conversations.saveError"));
    },
    [t],
  );
  const session = useConversationSession({
    store: list.store,
    refresh: list.refresh,
    chat,
    snapshot: {
      provider,
      model,
      maxIterations,
      approval,
      servers: effective,
      runtimeServers: effective.filter((name) => runtimeNames.has(name)),
    },
    ready: settings !== null && selected !== null,
    onRestore: handleRestore,
    onSaveError: handleSaveError,
  });

  // ?c=<id> 로 들어오면 저장소가 준비된 뒤 한 번 그 대화를 연다.
  const initialOpenRef = useRef(false);
  const sessionOpen = session.open;
  const listReady = list.status === "ready";
  const shellReady = settings !== null && selected !== null;
  useEffect(() => {
    if (initialOpenRef.current || !initialConversationId || !listReady || !shellReady) return;
    initialOpenRef.current = true;
    void sessionOpen(initialConversationId).then((result) => {
      if (result === "opened") return;
      notify.warning(t(result === "missing" ? "conversations.openMissing" : "conversations.openFailed"));
      const url = new URL(window.location.href);
      url.searchParams.delete("c");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    });
  }, [initialConversationId, listReady, shellReady, sessionOpen, t]);

  const handleOpenConversation = useCallback(
    async (id: string) => {
      const result = await session.open(id);
      if (result === "missing") notify.warning(t("conversations.openMissing"));
      else if (result === "unavailable") notify.error(t("conversations.openFailed"));
      else window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [session, t],
  );
  const handleNewChat = useCallback(async () => {
    await session.startNew();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [session]);

  const handleSend = useCallback(
    (text: string) => {
      const options = buildOptions();
      if (!options || sendBlocked || busy) return;
      setStickSignal((n) => n + 1);
      setSelectedSpanId(null);
      void chat.send(text, options);
    },
    [chat, buildOptions, sendBlocked, busy],
  );

  // 승인 카드의 결정. 결정 뒤에는 남은 승인 버튼이나 입력창으로 포커스를 옮긴다 (결정한 버튼은 사라진다).
  const afterDecision = useCallback(() => {
    window.setTimeout(() => {
      const next = document.querySelector<HTMLElement>('[data-approval-action="approve"]');
      (next ?? inputRef.current)?.focus();
    }, 50);
  }, []);
  const handleDecide = useCallback(
    (toolUseId: string, decision: "approve" | "deny", always: boolean) => {
      const options = buildOptions();
      if (!options) return;
      void chat.decide(toolUseId, decision, options, always);
      afterDecision();
    },
    [chat, buildOptions, afterDecision],
  );
  const handleDecideAll = useCallback(
    (decision: "approve" | "deny") => {
      const options = buildOptions();
      if (!options) return;
      void chat.decideAll(decision, options);
      afterDecision();
    },
    [chat, buildOptions, afterDecision],
  );

  // 툴바의 모델 선택: 이 대화에만 적용한다. OpenRouter 로 바꿀 때 모델 ID 는 설정의 값에서 시작한다.
  const handleModelChange = useCallback(
    (patch: { provider: LLMProvider; model?: string }) => {
      if (!settings) return;
      setChoice({ provider: patch.provider, model: patch.model ?? (choice?.provider === patch.provider ? choice.model : pickModel(settings, patch.provider)) });
    },
    [settings, choice],
  );

  const handleClear = useCallback(async () => {
    const ok = await confirm({
      title: t("chat.clearTitle"),
      description: t("chat.clearBody"),
      confirmLabel: t("chat.clearAction"),
      destructive: true,
    });
    if (!ok) return;
    // 저장된 사본도 함께 지운다 (저장한 적 없으면 화면만 비운다).
    await session.remove();
    setSelectedSpanId(null);
    setLinkedSpanId(null);
    notify.success(t("toast.chatCleared"));
    // 대화 상자가 포커스를 돌려주는 뒤에, 지우기 버튼(이제 비활성) 대신 입력창으로 옮긴다.
    window.setTimeout(() => inputRef.current?.focus(), 200);
  }, [session, confirm, t]);

  // ----- trace ----- //

  const clock = useClock(chat.streaming !== null || awaitingTurn !== null);
  const approvalLabel = t("chat.approvalSpan");
  const streamingTurn: AssistantTurn | null = useMemo(
    () => (chat.streaming ? streamingAsTurnView(chat.streaming) : null),
    [chat.streaming],
  );
  // 승인을 기다리는 턴은 대기 스팬이 시계를 따라 자라므로 아래에서 따로 만든다.
  const committedTraces = useMemo(() => {
    const map = new Map<string, TurnTrace>();
    for (const turn of chat.turns) {
      if (turn.role === "assistant" && turn.stopReason !== "awaiting_approval") map.set(turn.id, buildTurnTrace(turn, { approvalLabel }));
    }
    return map;
  }, [chat.turns, approvalLabel]);
  const awaiting = awaitingTurn?.awaiting;
  const awaitingNow = awaiting ? awaiting.pausedAtT + Math.max(0, clock - awaiting.clientAt) : 0;
  const awaitingTrace = useMemo(
    () => (awaitingTurn ? buildTurnTrace(awaitingTurn, { now: awaitingNow, approvalLabel }) : null),
    [awaitingTurn, awaitingNow, approvalLabel],
  );
  const clientT0 = chat.streaming?.clientT0 ?? null;
  const streamingTrace = useMemo(
    () =>
      streamingTurn
        ? buildTurnTrace(streamingTurn, {
            now: clientT0 === null ? 0 : Math.max(0, clock - clientT0),
            model: chat.streamingModel ?? undefined,
            approvalLabel,
          })
        : null,
    [streamingTurn, clientT0, clock, chat.streamingModel, approvalLabel],
  );
  const traces = useMemo(() => {
    const map = new Map(committedTraces);
    if (awaitingTurn && awaitingTrace) map.set(awaitingTurn.id, awaitingTrace);
    if (streamingTurn && streamingTrace) map.set(streamingTurn.id, streamingTrace);
    return map;
  }, [committedTraces, awaitingTurn, awaitingTrace, streamingTurn, streamingTrace]);

  const traceTurns = useMemo(() => {
    const out: TraceTurnView[] = [];
    let question = "";
    let number = 0;
    const visit = (turn: ChatTurn | AssistantTurn) => {
      if (turn.role === "user") {
        question = turn.content;
        return;
      }
      const trace = traces.get(turn.id);
      if (!trace) return;
      number += 1;
      out.push({
        id: turn.id,
        number,
        question,
        trace,
        maxIterations: turn.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      });
    };
    chat.turns.forEach(visit);
    if (streamingTurn) visit(streamingTurn);
    return out;
  }, [chat.turns, streamingTurn, traces]);

  // ----- 토큰 사용량 (제공자가 알려 준 값만) ----- //

  const usageTurns = useMemo<readonly ChatTurn[]>(() => (streamingTurn ? [...chat.turns, streamingTurn] : chat.turns), [chat.turns, streamingTurn]);
  const convUsage = useMemo(() => conversationUsage(usageTurns), [usageTurns]);
  const latest = useMemo(() => latestUsage(usageTurns), [usageTurns]);
  // 저장된 대화를 열었다면 그때 이미 들어 있던 사용량은 이 세션에서 쓴 것이 아니므로 뺀다.
  const sessionUsage = sessionTotal(chat.archivedUsage, subtractUsage(convUsage.usage, session.baseline));

  const handleSelectSpan = useCallback((id: string) => {
    setSelectedSpanId(id);
    // 스팬을 고르면 대화 열의 해당 도구 카드로 스크롤한다 (카드는 강조된다).
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-card-span="${CSS.escape(id)}"]`);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    });
  }, []);

  const handleShowInTrace = useCallback(
    (id: string) => {
      setSelectedSpanId(id);
      if (isMobile) setPane("trace");
    },
    [isMobile],
  );

  // ----- 상태바, 브레드크럼, 읽어 주는 상태 ----- //

  const modelName = settings ? model : undefined;
  const firstQuestion = chat.turns.find((turn) => turn.role === "user");
  // 첫 실행이 끝나기 전에는 대화가 저장되지 않아 목록에 없다. 그동안 목록이 "저장된 대화 없음"으로 보이지 않게 저장 전 행을 넘긴다.
  const conversationDraft = useMemo(
    () =>
      firstQuestion && (session.activeId === null || !list.items.some((m) => m.id === session.activeId))
        ? { title: autoTitle(chat.turns), running: streaming }
        : null,
    [firstQuestion, session.activeId, list.items, chat.turns, streaming],
  );
  const crumb =
    firstQuestion && firstQuestion.role === "user"
      ? firstQuestion.content.length > CRUMB_MAX
        ? `${firstQuestion.content.slice(0, CRUMB_MAX - 1)}…`
        : firstQuestion.content
      : null;
  const lastToolSpan = [...traceTurns]
    .reverse()
    .flatMap((turn) => [...turn.trace.spans].reverse())
    .find((s) => s.kind === "tool" && s.status !== "running" && s.status !== "cancelled");
  useShellMeta({
    model: modelName,
    crumb,
    lastCallMs: lastToolSpan ? Math.round(lastToolSpan.dur) : undefined,
  });

  const lastTurn = chat.turns[chat.turns.length - 1];
  let liveMessage = "";
  if (awaitingTurn) {
    const waiting = awaitingTurn.iterations.flatMap((it) => it.toolUses).find((tool) => tool.approval?.state === "pending");
    liveMessage = waiting ? t("chat.liveApproval", { tool: waiting.tool ?? waiting.name }) : t("chat.liveWorking");
  } else if (streaming) {
    const running = streamingTurn?.iterations
      .flatMap((it) => it.toolUses)
      .find((tool) => tool.result === null);
    liveMessage = running
      ? t("chat.liveCalling", { tool: running.tool ?? running.name })
      : t("chat.liveWorking");
  } else if (lastTurn?.role === "assistant") {
    liveMessage =
      lastTurn.stopReason === "aborted"
        ? t("chat.liveStopped")
        : lastTurn.stopReason === "error"
          ? t("chat.liveFailed")
          : t("chat.liveDone");
  }

  // ----- 가드 렌더 ----- //

  if (reachable.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <SidebarSlotEmpty />
        <h1 className="mb-3 text-2xl font-semibold">{t("chat.title")}</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t.rich("chat.noServers", {
            cmd1: (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                make run-mock-repo-mcp
              </code>
            ),
            cmd2: (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                make run-starter-mcp-http
              </code>
            ),
          })}
        </div>
      </div>
    );
  }

  if (settings === null || selected === null) {
    return <ChatSkeleton label={t("common.loading")} title={t("chat.title")} />;
  }

  const bannerError =
    chat.error !== null &&
    chat.status === "error" &&
    !(lastTurn?.role === "assistant" && lastTurn.stopReason === "error");
  const suggestions = suggestionKeys(effective);

  const emptyState = (
    <div className="grid justify-items-center gap-3 pt-10 text-center max-[901px]:pt-6">
      <MessagesSquareIcon aria-hidden className="size-6 text-fg-subtle" />
      <h2 className="text-sm font-semibold">{t("chat.emptyTitle")}</h2>
      <p className="max-w-[46ch] text-xs text-fg-muted">
        {noServers
          ? t("chat.emptyNone")
          : toolCount > 0
            ? t("chat.emptyBody", { n: toolCount, s: effective.length })
            : t("chat.emptyBodyServers", { s: effective.length })}
      </p>
      {suggestions.length > 0 ? (
        <ul
          aria-label={t("chat.suggestions")}
          className="flex flex-wrap justify-center gap-1.5"
        >
          {suggestions.map((key) => (
            <li key={key}>
              <button
                type="button"
                disabled={sendBlocked}
                onClick={() => handleSend(t(key))}
                className="inline-flex min-h-7 items-center rounded-full border border-line px-3 py-1 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-[901px]:min-h-9"
              >
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const threadColumn = (
    <div className="flex h-full min-h-0 flex-col">
      {apiKeyMissing ? (
        <div className="flex-none px-3 pt-3">
          <Alert className="border-warning-border bg-warning-bg py-2 text-xs">
            <AlertDescription className="text-foreground">
              <span className="font-medium text-warning-fg">
                {t("chat.apiKeyMissing", { provider: PROVIDER_LABELS[provider] })}
              </span>{" "}
              {t.rich("chat.apiKeyMissingHint", {
                link: (
                  <Link
                    href="/settings"
                    className="text-brand-text underline underline-offset-2"
                  >
                    {t("nav.settings")}
                  </Link>
                ),
              })}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Thread
        turns={chat.turns}
        streamingTurn={streamingTurn}
        streamingModel={chat.streamingModel}
        traces={traces}
        empty={emptyState}
        stickSignal={stickSignal}
        selectedSpanId={selectedSpanId}
        linkedSpanId={linkedSpanId}
        onLink={setLinkedSpanId}
        onShowInTrace={handleShowInTrace}
        onDecide={handleDecide}
        onDecideAll={handleDecideAll}
      />

      {bannerError ? (
        <div className="flex-none px-5 pb-2 max-[901px]:px-3">
          <Alert variant="destructive" className="mx-auto max-w-[820px] border-danger-border bg-danger-bg py-2 text-xs">
            <AlertDescription className="text-danger-fg">{chat.error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Composer
        inputRef={inputRef}
        disabled={sendBlocked}
        disabledHint={
          apiKeyMissing ? t("chat.apiKeyMissingPlaceholder") : undefined
        }
        busyHint={awaitingTurn ? t("chat.awaitingHint") : undefined}
        streaming={busy}
        onSend={handleSend}
        onStop={chat.abort}
        servers={effective}
      />
    </div>
  );

  return (
    <>
      <h1 className="sr-only">{t("chat.title")}</h1>
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      <SidebarSlot>
        <div className="flex min-h-0 flex-1 flex-col">
          <ConversationList
            status={list.status}
            items={list.items}
            store={list.store}
            activeId={session.activeId}
            activeAwaiting={awaitingTurn !== null}
            busy={busy}
            draft={conversationDraft}
            onOpen={(id) => void handleOpenConversation(id)}
            onNew={() => void handleNewChat()}
            onRename={session.rename}
            onDelete={async (id) => {
              await session.remove(id);
              if (id === session.activeId) {
                setSelectedSpanId(null);
                setLinkedSpanId(null);
              }
            }}
            onChanged={list.refresh}
          />
          <div className="flex max-h-[50%] min-h-0 flex-none flex-col border-t border-line">
            <ToolsExposed
              servers={reachable}
              unavailable={unavailable}
              selected={selected}
              onToggle={handleToggle}
              summary={{ servers: effective.length, tools: toolCount }}
              note={list.status === "unavailable" ? t("chat.sidebarNoteMemory") : t("chat.sidebarNote")}
            />
          </div>
        </div>
      </SidebarSlot>

      <ChatLayout
        pane={pane}
        onPane={setPane}
        toolbar={
          <ChatToolbar
            provider={provider}
            anthropicModel={choice?.provider === "anthropic" ? choice.model : settings.anthropicModel}
            openaiModel={choice?.provider === "openai" ? choice.model : settings.openaiModel}
            openrouterModel={choice?.provider === "openrouter" ? choice.model : settings.openrouterModel}
            onModelChange={handleModelChange}
            maxIterations={maxIterations}
            onMaxIterationsChange={setIterations}
            approval={approval}
            onApprovalChange={handleApprovalChange}
            conversationUsage={convUsage}
            sessionUsage={sessionUsage}
            latestUsage={latest}
            contextWindow={contextWindow(provider, model)}
            onClear={handleClear}
            clearDisabled={chat.turns.length === 0 && chat.streaming === null}
          />
        }
        thread={threadColumn}
        trace={
          <TracePanel
            turns={traceTurns}
            selectedSpanId={selectedSpanId}
            linkedSpanId={linkedSpanId}
            onSelectSpan={handleSelectSpan}
            onLink={setLinkedSpanId}
          />
        }
      />
      {confirmDialog}
    </>
  );
}
