// 테스트 전용 가짜 LLM (CHAT_MOCK_LLM=1 일 때만 켜진다. 기본은 꺼져 있고 운영에서 켜지 않는다).
//
// 실제 LLM 키 없이 Chat 의 전체 흐름(SSE 스트리밍, 도구 호출 카드, trace 워터폴, 중지, 반복 한도)을
// e2e 로 검증하기 위한 어댑터다. 도구 호출은 진짜 MCP 서버로 가고, 모델 응답만 규칙으로 만든다.
//
// 마지막 사용자 메시지에 지시문을 넣어 동작을 정한다. 지시문이 없으면 쓸 수 있는 도구에 맞춰 기본 계획을 쓴다.
//   [[tool:NAME {"a":1}]]   NAME 도구를 이 입력으로 부른다 (여러 개면 순서대로). 서버를 여러 개 노출하면 도구 이름에
//                           `server__` 접두가 붙는데, 접두 없이 써도 접미가 같은 도구를 찾아 준다.
//   [[sleep:MS]]            각 LLM 응답 전에 MS 밀리초 기다린다 (중지 버튼 시험, LLM 구간을 길게 보기)
//   [[loop]]                도구 호출을 maxIterations 까지 반복한다 (반복 한도 알림 시험)
//   [[error:TEXT]]          LLM 오류로 끝낸다
//   [[usage:off]]           토큰 사용량을 알려 주지 않는다 ("보고되지 않음" 시험)
//   [[usage:cache]]         사용량에 캐시 읽기 300, 쓰기 100 을 더한다
//
// 토큰 사용량은 반복(전체 턴 기준 0부터) k 마다 입력 1000*(k+1), 출력 50*(k+1) 로 고정이라 e2e 가 정확한 값을 확인할 수 있다.
// 수동 승인 모드에서는 도구를 부르려는 반복에서 approval_required 로 멈추고, 승인 뒤 요청은 이어서 다음 반복부터 돈다.
//
// 문서: frontend/README.md 의 "Chat e2e (mock LLM)" 절.

import "server-only";

import { SQL_EXAMPLES } from "@/lib/inspector/examples";

import { DEFAULT_MAX_ITERATIONS, type ChatMessage, type ChatTurnInput, type LLMAdapter, type LLMEvent } from "./adapter";
import type { TokenUsage } from "./usage";

// 켜는 조건: CHAT_MOCK_LLM=1(또는 true). NODE_ENV=production 에서는 추가로 CHAT_MOCK_LLM_ALLOW_PRODUCTION=1 이 있어야 한다.
// 운영 이미지에 실수로 값이 새어 들어가도 가짜 응답이 나가지 않게 하는 이중 잠금이며, docker-compose.yaml 은 두 값을 모두 전달하지 않는다.
// 프로덕션 빌드(`next start`)로 e2e 나 Lighthouse 를 돌릴 때만 두 값을 함께 준다.
const isOn = (v: string | undefined) => v === "1" || v === "true";

export function isMockLlmEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (!isOn(env.CHAT_MOCK_LLM?.trim().toLowerCase())) return false;
  if (env.NODE_ENV === "production") return isOn(env.CHAT_MOCK_LLM_ALLOW_PRODUCTION?.trim().toLowerCase());
  return true;
}

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

interface Plan {
  calls: PlannedCall[];
  sleepMs: number;
  loop: boolean;
  error: string | null;
  // 사용량: off 면 알리지 않고, cache 면 캐시 토큰도 담는다.
  usage: "on" | "off" | "cache";
}

const DIRECTIVE = /\[\[(tool|sleep|loop|error|usage)(?::([^\]]*))?\]\]/g;

function lastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  return "";
}

// 지시문의 도구 이름을 모델에 노출된 이름으로 바꾼다. 정확히 같은 이름이 우선이고, 없으면 `__이름` 으로 끝나는 도구가 하나일 때 그것을 쓴다.
export function resolveToolName(name: string, toolNames: readonly string[]): string {
  if (toolNames.includes(name)) return name;
  const suffixed = toolNames.filter((n) => n.endsWith(`__${name}`));
  return suffixed.length === 1 ? suffixed[0]! : name;
}

export function parseMockPlan(text: string, toolNames: readonly string[]): Plan {
  const plan: Plan = { calls: [], sleepMs: 0, loop: false, error: null, usage: "on" };
  for (const match of text.matchAll(DIRECTIVE)) {
    const [, kind, arg = ""] = match;
    if (kind === "sleep") plan.sleepMs = Math.min(30_000, Math.max(0, Number.parseInt(arg, 10) || 0));
    else if (kind === "loop") plan.loop = true;
    else if (kind === "error") plan.error = arg.trim() || "mock error";
    else if (kind === "usage") plan.usage = arg.trim() === "off" ? "off" : arg.trim() === "cache" ? "cache" : "on";
    else if (kind === "tool") {
      const space = arg.indexOf(" ");
      const name = (space === -1 ? arg : arg.slice(0, space)).trim();
      let input: Record<string, unknown> = {};
      if (space !== -1) {
        try {
          const parsed: unknown = JSON.parse(arg.slice(space + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
        } catch {
          // 깨진 JSON 은 빈 입력으로 둔다. 서버가 입력 오류를 돌려주는 경로를 시험할 수도 있다.
        }
      }
      plan.calls.push({ name: resolveToolName(name, toolNames), input });
    }
  }
  if (plan.calls.length > 0 || plan.error || /\[\[(?!usage)/.test(text)) return plan;

  // 지시문이 없을 때의 기본 계획: 노출된 도구에 맞는 호출 하나.
  const find = (suffix: string) => toolNames.find((n) => n === suffix || n.endsWith(`__${suffix}`));
  const sql = find("run_sql_query");
  const repos = find("list_repositories");
  const echo = find("echo");
  if (sql) {
    const top = SQL_EXAMPLES.find((e) => e.id === "top");
    plan.calls.push({ name: sql, input: { sql: top?.sql ?? "SELECT 1" } });
  } else if (repos) plan.calls.push({ name: repos, input: {} });
  else if (echo) plan.calls.push({ name: echo, input: { text } });
  return plan;
}

// abort 되면 던지는 sleep.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function* streamText(text: string, signal?: AbortSignal): AsyncGenerator<LLMEvent> {
  for (let i = 0; i < text.length; i += 14) {
    await sleep(12, signal);
    yield { type: "text_delta", text: text.slice(i, i + 14) };
  }
}

// 마지막 사용자 메시지 뒤에 이미 쌓인 도구 결과 (승인 뒤에 이어서 실행할 때 요약에 쓴다).
function priorResults(messages: readonly ChatMessage[]): { name: string; content: string; isError: boolean }[] {
  let from = 0;
  messages.forEach((m, i) => {
    if (m.role === "user") from = i + 1;
  });
  const names = new Map<string, string>();
  const out: { name: string; content: string; isError: boolean }[] = [];
  for (const m of messages.slice(from)) {
    if (m.role === "assistant") for (const tu of m.toolUses ?? []) names.set(tu.id, tu.name);
    else if (m.role === "tool_result") out.push({ name: names.get(m.toolUseId) ?? m.toolUseId, content: m.content, isError: m.isError });
  }
  return out;
}

function usageFor(plan: Plan, iteration: number): TokenUsage | null {
  if (plan.usage === "off") return null;
  return {
    input: 1000 * (iteration + 1) + (plan.usage === "cache" ? 400 : 0),
    output: 50 * (iteration + 1),
    ...(plan.usage === "cache" ? { cacheRead: 300, cacheWrite: 100 } : {}),
  };
}

function summarize(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}...` : flat;
}

export function createMockAdapter(): LLMAdapter {
  return {
    async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
      const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      const plan = parseMockPlan(
        lastUserText(input.messages),
        input.tools.map((t) => t.name),
      );
      const results = priorResults(input.messages);
      const offset = input.iterationOffset ?? 0;

      try {
        for (let i = offset; i < maxIterations; i += 1) {
          yield { type: "iteration", index: i };
          await sleep(plan.sleepMs || 30, input.signal);

          if (plan.error) {
            yield { type: "done", stopReason: "error", error: plan.error };
            return;
          }

          const calls = i === 0 || plan.loop ? plan.calls : [];
          if (calls.length === 0) {
            const answer =
              results.length === 0
                ? "This is the mock model. No tool was needed for this message."
                : `Mock summary of ${results.length} tool call${results.length === 1 ? "" : "s"}.\n\n` +
                  results.map((r) => `- \`${r.name}\`${r.isError ? " (isError)" : ""}: ${summarize(r.content)}`).join("\n");
            yield* streamText(answer, input.signal);
            const usage = usageFor(plan, i);
            if (usage) yield { type: "usage", usage };
            yield { type: "done", stopReason: "end_turn" };
            return;
          }

          yield* streamText(i === 0 ? "Let me check that with the tools.\n\n" : "One more call.\n\n", input.signal);
          const usage = usageFor(plan, i);
          if (usage) yield { type: "usage", usage };
          const uses = calls.map((call, n) => ({ id: `mock-${i}-${n}`, name: call.name, input: call.input }));
          if (input.requireApproval?.(uses)) {
            yield { type: "approval_required", calls: uses, iterationsUsed: i + 1 };
            yield { type: "done", stopReason: "awaiting_approval" };
            return;
          }
          for (const [n, call] of calls.entries()) {
            const id = `mock-${i}-${n}`;
            yield { type: "tool_use", id, name: call.name, input: call.input };
            let result: { content: string; isError: boolean };
            try {
              result = await input.onToolCall(call.name, call.input);
            } catch (err) {
              result = { content: err instanceof Error ? err.message : String(err), isError: true };
            }
            results.push({ name: call.name, ...result });
            yield { type: "tool_result", toolUseId: id, content: result.content, isError: result.isError };
          }
        }
        yield { type: "done", stopReason: "max_iterations" };
      } catch (err) {
        yield { type: "done", stopReason: "error", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
