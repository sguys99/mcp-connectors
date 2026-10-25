// Phase 5-4: Chat 페이지가 사용하는 React hook.
// runChatStream (순수 코어) + applyLLMEvent (reducer) 를 React state 와 연결.
//
// 책임:
//   - turns (확정된 ChatTurn[]), streaming (in-flight assistant turn 의 상태) 보관
//   - status: 'idle' | 'streaming' | 'awaiting' | 'error'
//   - send(text, options): user turn push → /api/chat 호출 → reducer 적용 → done 시 assistant turn 커밋
//   - 수동 승인 모드: 서버가 approval_required 로 턴을 끝내면 status 가 awaiting 이 되고 그 턴은 승인 카드를 가진 채 turns 에 남는다.
//     decide() 로 호출마다 승인/거부를 기록하고, 모든 호출의 결정이 나면 같은 턴을 스트리밍 상태로 되돌려 결정과 대화 기록을
//     /api/chat 에 다시 보낸다 (resume). 서버는 무상태이고, 승인 대기 시간은 trace 시계에 그대로 들어간다.
//   - abort(): 진행 중 요청 취소. 지금까지 받은 내용은 "aborted" 턴으로 남긴다 (Stop 은 결과를 버리지 않는다).
//     승인을 기다리는 중이면 실행하지 않은 호출을 취소하고 턴을 닫는다.
//   - reset(): 전체 초기화 (대화 지우기). 진행 중이면 멈추고, 늦게 도착하는 결과는 버린다. 토큰 사용량은 세션 합계에 넘긴다.
//   - 상태는 모두 JSON 으로 직렬화할 수 있는 값이다. 저장된 대화는 restore() 로 올린다 (P5-7 대화 저장).
//   - 도구 호출이 성공하면 시작하기 체크리스트의 "채팅 도구 호출"을 완료로 표시한다
//
// "use client" 모듈. server-only 값 import 금지 (type 만 import).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n/client";
import type { ChatMessage } from "@/lib/llm/adapter";
import { DEFAULT_MAX_ITERATIONS } from "@/lib/llm/constants";
import { addUsage, type TokenUsage } from "@/lib/llm/usage";
import { markGettingStarted } from "@/lib/onboarding/getting-started";

import { runChatStream, type ChatStreamRequest } from "./runChatStream";
import {
  abortAwaiting,
  abortStreaming,
  applyLLMEvent,
  collectDecisions,
  decideToolUse,
  initStreamingState,
  newTurnId,
  pendingApprovals,
  resumeStreamingState,
  serializeToChatMessages,
  type AssistantTurn,
  type ChatTurn,
  type StreamingState,
} from "./serialize";
import { conversationUsage } from "./usage";

export type ApprovalMode = "auto" | "manual";

export interface SendOptions {
  provider: "anthropic" | "openai" | "openrouter";
  // 생략하면 서버 env 의 provider 키를 쓴다.
  apiKey?: string;
  model: string;
  // 모델에 노출할 서버들 (한 개 이상)
  serverNames: string[];
  // 프록시 방식으로 추가한 런타임 서버의 정의 (이 요청에만 싣는다)
  runtimeServers?: { name: string; url: string; headers: Record<string, string> }[];
  systemPromptOverride?: string | null;
  maxIterations?: number;
  // 도구 호출 승인 방식. 생략하면 auto.
  approval?: ApprovalMode;
}

export type ChatStatus = "idle" | "streaming" | "awaiting" | "error";

export type Decision = "approve" | "deny";

export interface UseChatStream {
  turns: ChatTurn[];
  streaming: StreamingState | null;
  // 진행 중인 실행의 모델 이름 (스팬과 메시지 머리 표시용)
  streamingModel: string | null;
  status: ChatStatus;
  error: string | null;
  // 이 대화에서 "항상 허용"으로 고른 도구 이름 (모델에게 보이는 이름)
  allowedTools: readonly string[];
  // 지운 대화들의 토큰 사용량 합계 (세션 합계에 쓴다). 보고된 것이 없으면 null.
  archivedUsage: TokenUsage | null;
  send: (text: string, options: SendOptions) => Promise<void>;
  // 승인 대기 중인 호출 하나를 승인/거부한다. always 는 승인과 함께 이 대화에서 그 도구를 항상 허용한다.
  decide: (toolUseId: string, decision: Decision, options: SendOptions, always?: boolean) => Promise<void>;
  // 대기 중인 모든 호출을 한꺼번에 승인/거부한다.
  decideAll: (decision: Decision, options: SendOptions) => Promise<void>;
  abort: () => void;
  // archive: 세션 합계에 넘길 사용량. 생략하면 이 대화 전체, null 이면 넘기지 않는다 (저장된 대화를 다시 연 경우는 새로 쓴 만큼만 넘긴다).
  reset: (archive?: TokenUsage | null) => void;
  // 저장된 대화를 화면에 올린다 (P5-7). 진행 중인 실행은 버리고 현재 대화의 사용량은 archive 만큼 세션 합계에 넘긴다.
  restore: (turns: ChatTurn[], allowedTools: readonly string[], archive?: TokenUsage | null) => void;
}

interface RunParams {
  request: ChatStreamRequest;
  initial: StreamingState;
  options: SendOptions;
  // 승인 뒤 이어서 실행하는 요청인지 (실패해도 앞선 내용을 턴으로 남긴다)
  resumed: boolean;
}

export function useChatStream(): UseChatStream {
  const t = useT();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [streamingModel, setStreamingModel] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [archivedUsage, setArchivedUsage] = useState<TokenUsage | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // reset() 마다 올라가는 번호. 지운 뒤에 늦게 도착하는 실행의 결과를 버리는 데 쓴다.
  const epochRef = useRef(0);
  // 최신값을 useCallback closure 와 무관하게 참조한다. 이벤트 핸들러 안에서 연달아 바꿀 때는 ref 도 함께 갱신한다.
  const turnsRef = useRef<ChatTurn[]>([]);
  const allowedRef = useRef<string[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    allowedRef.current = allowedTools;
  }, [allowedTools]);

  const commitTurns = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  // 요청 한 번을 실행한다: SSE 를 읽어 reducer 에 반영하고 끝나면 턴을 확정한다.
  const run = useCallback(
    async ({ request, initial, options, resumed }: RunParams): Promise<void> => {
      const epoch = epochRef.current;
      let state = initial;
      setStreaming(state);
      setStreamingModel(options.model);
      setStatus("streaming");
      setError(null);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let doneReceived = false;
      const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const finish = (turn: AssistantTurn) => commitTurns([...turnsRef.current, { ...turn, model: options.model, maxIterations }]);

      const outcome = await runChatStream(request, ctrl.signal, (ev) => {
        if (epoch !== epochRef.current) return;
        if (ev.type === "tool_result" && !ev.isError) markGettingStarted("chatToolCall");
        const result = applyLLMEvent(state, ev, performance.now());
        if (result.kind === "streaming") {
          state = result.next;
          setStreaming(state);
        } else {
          // done event — 최종 assistant turn 커밋.
          doneReceived = true;
          finish(result.turn);
          setStreaming(null);
          if (result.turn.stopReason === "error") {
            setStatus("error");
            setError(result.turn.error ?? t("errors.unknownLlm"));
          } else {
            setStatus(result.turn.stopReason === "awaiting_approval" ? "awaiting" : "idle");
          }
        }
      });

      abortRef.current = null;
      // 대화를 지운 뒤라면 이 실행의 결과는 화면에 올리지 않는다.
      if (epoch !== epochRef.current) return;

      // 실패한 이어서 실행: 승인 전까지 쌓인 내용을 오류 턴으로 남겨 화면에서 사라지지 않게 한다.
      const keepAsError = (message: string) => {
        finish({ ...abortStreaming(state, performance.now()), stopReason: "error", error: message });
        setStreaming(null);
        setStatus("error");
        setError(message);
      };

      // 5. outcome 후처리 — done 이 이미 발화했으면 state 가 이미 정리됨.
      switch (outcome.kind) {
        case "ok":
          if (!doneReceived) {
            if (resumed) keepAsError(t("errors.streamEnded"));
            else {
              setStreaming(null);
              setStatus("error");
              setError(t("errors.streamEnded"));
            }
          }
          break;
        case "http_error": {
          const message = t("errors.httpStatus", { message: outcome.message, status: outcome.status });
          if (resumed) keepAsError(message);
          else {
            setStreaming(null);
            setStatus("error");
            setError(message);
          }
          break;
        }
        case "abort": {
          // Stop: 받은 내용은 그대로 두고 "중지됨" 턴으로 확정한다. 아직 아무것도 못 받았으면 남길 것이 없다.
          const turn = abortStreaming(state, performance.now());
          const hasContent = turn.iterations.some((it) => it.text.length > 0 || it.toolUses.length > 0 || it.startT !== undefined);
          if (hasContent) finish(turn);
          setStreaming(null);
          setStatus("idle");
          setError(null);
          break;
        }
        case "exception":
          if (resumed) keepAsError(outcome.message);
          else {
            setStreaming(null);
            setStatus("error");
            setError(outcome.message);
          }
          break;
      }
    },
    [commitTurns, t],
  );

  const buildRequest = useCallback(
    (options: SendOptions, messages: ChatMessage[], resume?: ChatStreamRequest["resume"]): ChatStreamRequest => ({
      provider: options.provider,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      model: options.model,
      serverNames: options.serverNames,
      ...(options.runtimeServers && options.runtimeServers.length > 0 ? { runtimeServers: options.runtimeServers } : {}),
      messages,
      ...(options.systemPromptOverride ? { systemPromptOverride: options.systemPromptOverride } : {}),
      ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
      ...(options.approval === "manual"
        ? { approval: "manual" as const, ...(allowedRef.current.length > 0 ? { allowTools: allowedRef.current } : {}) }
        : {}),
      ...(resume ? { resume } : {}),
    }),
    [],
  );

  const send = useCallback(
    async (text: string, options: SendOptions): Promise<void> => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      // 1. user turn 즉시 push (UI 반영).
      const userTurn: ChatTurn = { id: newTurnId(), role: "user", content: trimmed, at: Date.now() };
      const turnsAfterUser = [...turnsRef.current, userTurn];
      commitTurns(turnsAfterUser);

      // 2~4. 직렬화한 대화로 요청을 만들어 실행한다.
      await run({
        request: buildRequest(options, serializeToChatMessages(turnsAfterUser)),
        initial: initStreamingState(),
        options,
        resumed: false,
      });
    },
    [buildRequest, commitTurns, run],
  );

  // 결정을 기록하고, 모든 호출이 결정되었으면 같은 턴을 이어서 실행한다.
  const applyDecisions = useCallback(
    async (apply: (turn: AssistantTurn, now: number) => AssistantTurn, options: SendOptions): Promise<void> => {
      const last = turnsRef.current[turnsRef.current.length - 1];
      if (!last || last.role !== "assistant" || last.stopReason !== "awaiting_approval" || !last.awaiting) return;
      const now = performance.now();
      const decided = apply(last, now);
      const all = [...turnsRef.current.slice(0, -1), decided];
      commitTurns(all);

      const decisions = collectDecisions(decided);
      if (!decisions) return;

      // 모두 결정됨: 이 턴을 스트리밍 상태로 되돌리고 대화 기록과 결정을 다시 보낸다.
      const token = decided.awaiting!.token;
      const messages = serializeToChatMessages(all, decided.id);
      const initial = resumeStreamingState(decided, now);
      commitTurns(all.slice(0, -1));
      await run({ request: buildRequest(options, messages, { token, decisions }), initial, options, resumed: true });
    },
    [buildRequest, commitTurns, run],
  );

  const decide = useCallback(
    (toolUseId: string, decision: Decision, options: SendOptions, always = false): Promise<void> => {
      if (always && decision === "approve") {
        const last = turnsRef.current[turnsRef.current.length - 1];
        const name = last?.role === "assistant" ? pendingApprovals(last).find((tool) => tool.id === toolUseId)?.name : undefined;
        if (name && !allowedRef.current.includes(name)) {
          allowedRef.current = [...allowedRef.current, name];
          setAllowedTools(allowedRef.current);
        }
      }
      return applyDecisions((turn, now) => {
        let next = decideToolUse(turn, toolUseId, decision, now, always);
        if (always && decision === "approve") {
          // 같은 도구의 다른 대기 호출도 함께 승인한다.
          const name = pendingApprovals(turn).find((tool) => tool.id === toolUseId)?.name;
          for (const other of pendingApprovals(next)) if (other.name === name) next = decideToolUse(next, other.id, "approve", now, true);
        }
        return next;
      }, options);
    },
    [applyDecisions],
  );

  const decideAll = useCallback(
    (decision: Decision, options: SendOptions): Promise<void> =>
      applyDecisions((turn, now) => pendingApprovals(turn).reduce((acc, tool) => decideToolUse(acc, tool.id, decision, now), turn), options),
    [applyDecisions],
  );

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      return;
    }
    // 승인을 기다리는 중이면 실행하지 않은 호출을 취소하고 턴을 닫는다.
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (last?.role === "assistant" && last.stopReason === "awaiting_approval") {
      commitTurns([...turnsRef.current.slice(0, -1), abortAwaiting(last, performance.now())]);
      setStatus("idle");
      setError(null);
    }
  }, [commitTurns]);

  // 대화를 바꾸거나 지울 때 공통: 진행 중인 실행을 버리고 사용량을 세션 합계에 넘긴 뒤 새 대화 내용을 올린다.
  const replaceConversation = useCallback(
    (nextTurns: ChatTurn[], nextAllowed: readonly string[], archive: TokenUsage | null | undefined) => {
      epochRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const usage = archive === undefined ? conversationUsage(turnsRef.current).usage : archive;
      if (usage) setArchivedUsage((prev) => (prev ? addUsage(prev, usage) : usage));
      commitTurns(nextTurns);
      allowedRef.current = [...nextAllowed];
      setAllowedTools(allowedRef.current);
      setStreaming(null);
      setStreamingModel(null);
      setStatus("idle");
      setError(null);
    },
    [commitTurns],
  );

  const reset = useCallback((archive?: TokenUsage | null) => replaceConversation([], [], archive), [replaceConversation]);
  const restore = useCallback(
    (nextTurns: ChatTurn[], nextAllowed: readonly string[], archive?: TokenUsage | null) => replaceConversation(nextTurns, nextAllowed, archive),
    [replaceConversation],
  );

  return { turns, streaming, streamingModel, status, error, allowedTools, archivedUsage, send, decide, decideAll, abort, reset, restore };
}
