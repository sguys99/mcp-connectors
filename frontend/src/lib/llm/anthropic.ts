// Anthropic 어댑터 (Phase 5-2-3).
// @anthropic-ai/sdk 의 messages.stream() 을 사용해 tool-use 루프를 실행한다.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import type { ToolMeta } from "@/lib/mcp/types";

import {
  DEFAULT_MAX_ITERATIONS,
  toMessage,
  type ChatMessage,
  type ChatToolUse,
  type ChatTurnInput,
  type LLMAdapter,
  type LLMEvent,
} from "./adapter";
import { normalizeAnthropicUsage } from "./usage";

const MAX_TOKENS = 4096;

export function toAnthropicTools(tools: ToolMeta[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // MCP inputSchema 는 JSON Schema Draft-07 object. Anthropic Tool.input_schema 는
    // 최소 `{ type: "object" }` 를 요구한다. 캐스팅으로 패스스루.
    input_schema: t.inputSchema as Tool["input_schema"],
  }));
}

// 통합 히스토리 → Anthropic messages 변환.
// - user text → { role:"user", content:[{type:"text", text}] }
// - assistant text+toolUses 같은 turn → { role:"assistant", content:[text, ...tool_use] }
// - tool_result 들은 직전 user 메시지에 묶음 (연속 tool_result 한 user 메시지 묶음)
export function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [];
  let pendingToolResults: ContentBlockParam[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    out.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const m of messages) {
    if (m.role === "tool_result") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: m.toolUseId,
        content: m.content,
        is_error: m.isError,
      });
      continue;
    }
    flushToolResults();
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.content }] });
    } else {
      const blocks: ContentBlockParam[] = [];
      if (m.content.length > 0) blocks.push({ type: "text", text: m.content });
      for (const tu of m.toolUses ?? []) {
        blocks.push({
          type: "tool_use",
          id: tu.id,
          name: tu.name,
          input: tu.input,
        });
      }
      out.push({ role: "assistant", content: blocks });
    }
  }
  flushToolResults();
  return out;
}

export function createAnthropicAdapter(
  apiKey: string,
  model: string,
): LLMAdapter {
  const client = new Anthropic({ apiKey });

  return {
    async *chatWithTools(input: ChatTurnInput): AsyncIterable<LLMEvent> {
      const history: ChatMessage[] = [...input.messages];
      const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
      // 승인 뒤에 이어 실행하면 앞선 반복을 뺀 만큼만 돈다.
      const offset = input.iterationOffset ?? 0;

      for (let i = offset; i < maxIterations; i += 1) {
        yield { type: "iteration", index: i };

        let finalText = "";
        const finalToolUses: ChatToolUse[] = [];
        let stopReason: string | null | undefined;
        let usage: ReturnType<typeof normalizeAnthropicUsage> = null;

        try {
          const stream = client.messages.stream(
            {
              model,
              system: input.system,
              max_tokens: MAX_TOKENS,
              tools: toAnthropicTools(input.tools),
              messages: toAnthropicMessages(history),
            },
            { signal: input.signal },
          );

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              yield { type: "text_delta", text: event.delta.text };
            }
          }

          const final = await stream.finalMessage();
          stopReason = final.stop_reason;
          usage = normalizeAnthropicUsage(final.usage);
          for (const block of final.content) {
            if (block.type === "text") finalText += block.text;
            if (block.type === "tool_use") {
              const tu = block as ToolUseBlock;
              finalToolUses.push({
                id: tu.id,
                name: tu.name,
                input: (tu.input ?? {}) as Record<string, unknown>,
              });
            }
          }
        } catch (err) {
          yield { type: "done", stopReason: "error", error: toMessage(err) };
          return;
        }

        // 사용량은 응답이 끝난 직후에 알린다 (tool_use 나 done 보다 먼저). 제공자가 주지 않으면 이벤트를 내지 않는다.
        if (usage) yield { type: "usage", usage };

        history.push({
          role: "assistant",
          content: finalText,
          toolUses: finalToolUses.length > 0 ? finalToolUses : undefined,
        });

        if (stopReason !== "tool_use" || finalToolUses.length === 0) {
          yield { type: "done", stopReason: "end_turn" };
          return;
        }

        // 수동 승인: 도구를 실행하지 않고 호출 목록만 알린 뒤 멈춘다 (실행은 승인 결정과 함께 온 다음 요청이 한다).
        if (input.requireApproval?.(finalToolUses)) {
          yield { type: "approval_required", calls: finalToolUses, iterationsUsed: i + 1 };
          yield { type: "done", stopReason: "awaiting_approval" };
          return;
        }

        // Dispatch each tool sequentially; deterministic yield order.
        for (const tu of finalToolUses) {
          yield { type: "tool_use", id: tu.id, name: tu.name, input: tu.input };
          let result: { content: string; isError: boolean };
          try {
            result = await input.onToolCall(tu.name, tu.input);
          } catch (err) {
            result = { content: toMessage(err), isError: true };
          }
          yield {
            type: "tool_result",
            toolUseId: tu.id,
            content: result.content,
            isError: result.isError,
          };
          history.push({
            role: "tool_result",
            toolUseId: tu.id,
            content: result.content,
            isError: result.isError,
          });
        }
      }

      yield { type: "done", stopReason: "max_iterations" };
    },
  };
}
