// Chat 의 토큰 사용량 집계 (순수 함수). 제공자가 알려 준 값만 더하고 추정은 하지 않는다 (lib/llm/usage.ts).
//
//   반복(iteration)  AssistantIteration.usage       LLM 호출 한 번
//   턴(turn)         turnUsage                       한 질문에 대한 모든 반복
//   대화(conversation) conversationUsage            화면의 모든 턴. 대화 지우기로 0이 된다.
//   세션(session)    useChatStream 의 archived      이 페이지를 연 뒤 지운 대화까지 합친 값. 새로고침하면 0이다.
//
// 합계가 일부만 반영될 수 있다 (일부 반복이 보고되지 않음). 그럴 때는 reported < total 로 알려서 화면이 "일부"라고 표시한다.

import { addUsage, sumUsage, type TokenUsage, type UsageTotal } from "@/lib/llm/usage";

import type { AssistantIteration } from "./serialize";

interface HasIterations {
  role: string;
  iterations?: readonly AssistantIteration[];
}

export function turnUsage(turn: { iterations: readonly AssistantIteration[] }): UsageTotal {
  return sumUsage(turn.iterations.map((it) => it.usage));
}

export function conversationUsage(turns: readonly HasIterations[]): UsageTotal {
  return sumUsage(turns.flatMap((turn) => (turn.role === "assistant" && turn.iterations ? turn.iterations.map((it) => it.usage) : [])));
}

// 가장 최근에 보고된 LLM 호출의 사용량. 컨텍스트 미터(마지막 요청이 읽은 입력 + 쓴 출력)에 쓴다.
export function latestUsage(turns: readonly HasIterations[]): TokenUsage | null {
  for (let t = turns.length - 1; t >= 0; t -= 1) {
    const turn = turns[t]!;
    if (turn.role !== "assistant" || !turn.iterations) continue;
    for (let i = turn.iterations.length - 1; i >= 0; i -= 1) {
      const usage = turn.iterations[i]!.usage;
      if (usage) return usage;
    }
  }
  return null;
}

// 지운 대화의 합계(archived)에 현재 대화의 합계를 더한다 (세션 합계). 둘 다 보고된 것이 없으면 null.
export function sessionTotal(archived: TokenUsage | null, current: TokenUsage | null): TokenUsage | null {
  if (!archived) return current;
  return current ? addUsage(archived, current) : archived;
}

// a 에서 b 를 뺀다 (음수가 되지 않게 0 으로 자른다). 저장된 대화를 다시 연 뒤 새로 쓴 사용량을 구할 때 쓴다.
export function subtractUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a) return null;
  if (!b) return a;
  const diff = (x: number | undefined, y: number | undefined) => (x === undefined ? undefined : Math.max(0, x - (y ?? 0)));
  const cacheRead = diff(a.cacheRead, b.cacheRead);
  const cacheWrite = diff(a.cacheWrite, b.cacheWrite);
  const out: TokenUsage = {
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
  return out.input === 0 && out.output === 0 ? null : out;
}
