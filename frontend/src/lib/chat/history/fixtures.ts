// 대화 저장 테스트가 함께 쓰는 예시 대화 (테스트 전용 모듈).

import type { AssistantTurn, ChatTurn } from "@/lib/chat/serialize";

import { buildStoredConversation, type StoredConversation } from "./schema";

export function userTurn(content: string, id = "u1", at = 1_700_000_000_000): ChatTurn {
  return { id, role: "user", content, at };
}

export function toolTurn(opts: { id?: string; result?: string; input?: Record<string, unknown>; isError?: boolean } = {}): AssistantTurn {
  return {
    id: opts.id ?? "a1",
    role: "assistant",
    stopReason: "end_turn",
    model: "claude-sonnet-4-6",
    startedAt: 1_700_000_001_000,
    endT: 900,
    iterations: [
      {
        text: "",
        startT: 0,
        llmEndT: 300,
        usage: { input: 120, output: 30 },
        toolUses: [
          {
            id: "t1",
            name: "mock-repo-mcp__list_repositories",
            server: "mock-repo-mcp",
            tool: "list_repositories",
            input: opts.input ?? { limit: 5 },
            result: { content: opts.result ?? '{"repos":["alpha-service"]}', isError: opts.isError ?? false },
            startT: 310,
            endT: 420,
          },
        ],
      },
      { text: "There is one repository: alpha-service.", toolUses: [], startT: 430, llmEndT: 880, usage: { input: 200, output: 40 } },
    ],
  };
}

export function sampleConversation(overrides: Partial<StoredConversation> = {}, turns: ChatTurn[] = [userTurn("List the repositories"), toolTurn()]): StoredConversation {
  return {
    ...buildStoredConversation({
      id: "conv-1",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_005_000,
      title: "List the repositories",
      titleAuto: true,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      maxIterations: 5,
      approval: "auto",
      servers: ["mock-repo-mcp"],
      runtimeServers: [],
      allowedTools: [],
      turns,
    }),
    ...overrides,
  };
}

export function awaitingTurn(): AssistantTurn {
  return {
    id: "a2",
    role: "assistant",
    stopReason: "awaiting_approval",
    awaiting: { token: "signed.token.value", pausedAtT: 500, clientAt: 123456 },
    iterations: [
      {
        text: "",
        startT: 0,
        llmEndT: 400,
        toolUses: [
          {
            id: "p1",
            name: "run_sql_query",
            input: { sql: "select 1" },
            result: null,
            approval: { state: "pending", waitStartT: 500, waitStartClient: 123456 },
          },
          {
            id: "p2",
            name: "run_sql_query",
            input: { sql: "select 2" },
            result: null,
            approval: { state: "approved", waitStartT: 500, decidedT: 700, auto: true },
          },
        ],
      },
    ],
  };
}
