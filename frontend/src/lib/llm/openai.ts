// OpenAI 어댑터 (Phase 5-2-4) + OpenAI-호환 엔드포인트 공용 헬퍼.
// OpenRouter (5-2-5) 가 baseURL/headers 만 바꿔 이 헬퍼를 재사용한다.

import "server-only";

import OpenAI from "openai";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import type { ToolMeta } from "@/lib/mcp/types";

import {
  DEFAULT_MAX_ITERATIONS,
  toMessage,
  type ChatMessage,
  type ChatTurnInput,
  type LLMAdapter,
  type LLMEvent,
} from "./adapter";
import { normalizeOpenAIUsage } from "./usage";

interface OpenAICompatOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export function toOpenAITools(tools: ToolMeta[]): ChatCompletionFunctionTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const toolCalls = (m.toolUses ?? []).map((tu) => ({
        id: tu.id,
        type: "function" as const,
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      }));
      out.push({
        role: "assistant",
        // content 가 null 이어야 tool_calls 가 LLM 에 전달됨.
        content: m.content.length > 0 ? m.content : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // tool_result. OpenAI 는 별도 is_error 필드 없음 — content 가 LLM 본문.
      out.push({
        role: "tool",
        tool_call_id: m.toolUseId,
        content: m.content,
      });
    }
  }
  return out;
}

// 누적 중인 streaming tool_call. arguments 는 여러 chunk 로 쪼개져 옴.
interface AccumulatingToolCall {
  id: string;
  name: string;
  arguments: string;
}

// 내부 헬퍼 — openai.ts / openrouter.ts 공용. **export 하지 않음.**
function createOpenAICompatAdapter(opts: OpenAICompatOptions): LLMAdapter {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
  });
  const model = opts.model;

  return {
    async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
      const history: ChatMessage[] = [...input.messages];
      const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      // 승인 뒤에 이어 실행하면 앞선 반복을 뺀 만큼만 돈다.
      const offset = input.iterationOffset ?? 0;

      for (let i = offset; i < maxIterations; i += 1) {
        yield { type: "iteration", index: i };

        let assistantText = "";
        const accToolCalls = new Map<number, AccumulatingToolCall>();
        let finishReason: string | null | undefined;
        let usage: ReturnType<typeof normalizeOpenAIUsage> = null;

        try {
          const stream = await client.chat.completions.create(
            {
              model,
              messages: toOpenAIMessages(input.system, history),
              tools: toOpenAITools(input.tools),
              stream: true,
              // 스트리밍에서는 이 옵션을 켜야 마지막 chunk (choices 가 빈 배열) 에 usage 가 실려 온다.
              stream_options: { include_usage: true },
            },
            { signal: input.signal },
          );

          for await (const chunk of stream) {
            // usage 는 choices 가 빈 마지막 chunk 에 온다. choice 검사보다 먼저 읽는다.
            if (chunk.usage) usage = normalizeOpenAIUsage(chunk.usage);
            const choice = chunk.choices[0];
            if (!choice) continue;
            const delta = choice.delta;
            if (delta?.content) {
              assistantText += delta.content;
              yield { type: "text_delta", text: delta.content };
            }
            for (const tcd of delta?.tool_calls ?? []) {
              const idx = tcd.index;
              const existing = accToolCalls.get(idx) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tcd.id) existing.id = tcd.id;
              if (tcd.function?.name) existing.name = tcd.function.name;
              if (tcd.function?.arguments) {
                existing.arguments += tcd.function.arguments;
              }
              accToolCalls.set(idx, existing);
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }
        } catch (err) {
          yield { type: "done", stopReason: "error", error: toMessage(err) };
          return;
        }

        // 사용량은 응답이 끝난 직후에 알린다 (tool_use 나 done 보다 먼저). 스트림이 주지 않으면 이벤트를 내지 않는다.
        if (usage) yield { type: "usage", usage };

        // tool_calls 가 비었거나 finish_reason 이 tool_calls 가 아니면 종료.
        const toolCalls = [...accToolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, v]) => v);

        if (finishReason !== "tool_calls" || toolCalls.length === 0) {
          history.push({ role: "assistant", content: assistantText });
          yield { type: "done", stopReason: "end_turn" };
          return;
        }

        // arguments JSON.parse — 손상 시 onToolCall 호출 없이 isError:true.
        const parsed: Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
          parseError: string | null;
        }> = toolCalls.map((tc) => {
          try {
            const obj =
              tc.arguments.trim().length === 0
                ? {}
                : (JSON.parse(tc.arguments) as Record<string, unknown>);
            return { id: tc.id, name: tc.name, input: obj, parseError: null };
          } catch (err) {
            return {
              id: tc.id,
              name: tc.name,
              input: {},
              parseError: `Invalid JSON in tool arguments: ${toMessage(err)}`,
            };
          }
        });

        // assistant turn (text + tool_use) 를 히스토리에 push.
        history.push({
          role: "assistant",
          content: assistantText,
          toolUses: parsed.map((p) => ({
            id: p.id,
            name: p.name,
            input: p.input,
          })),
        });

        // 수동 승인: 도구를 실행하지 않고 호출 목록만 알린 뒤 멈춘다. 깨진 arguments 는 실행 단계에서 isError 로 처리하므로
        // 승인 대상에서는 빈 입력으로 보인다.
        const asUses = parsed.map((p) => ({ id: p.id, name: p.name, input: p.input }));
        if (input.requireApproval?.(asUses)) {
          yield { type: "approval_required", calls: asUses, iterationsUsed: i + 1 };
          yield { type: "done", stopReason: "awaiting_approval" };
          return;
        }

        // 입력 순서대로 yield + dispatch.
        for (const p of parsed) {
          yield { type: "tool_use", id: p.id, name: p.name, input: p.input };
          let result: { content: string; isError: boolean };
          if (p.parseError) {
            result = { content: p.parseError, isError: true };
          } else {
            try {
              result = await input.onToolCall(p.name, p.input);
            } catch (err) {
              result = { content: toMessage(err), isError: true };
            }
          }
          yield {
            type: "tool_result",
            toolUseId: p.id,
            content: result.content,
            isError: result.isError,
          };
          history.push({
            role: "tool_result",
            toolUseId: p.id,
            content: result.content,
            isError: result.isError,
          });
        }

      }

      yield { type: "done", stopReason: "max_iterations" };
    },
  };
}

export function createOpenAIAdapter(
  apiKey: string,
  model: string,
): LLMAdapter {
  return createOpenAICompatAdapter({ apiKey, model });
}

// 5-2-5 openrouter.ts 가 import — 내부 헬퍼이므로 외부 코드는 호출 금지.
export { createOpenAICompatAdapter };
