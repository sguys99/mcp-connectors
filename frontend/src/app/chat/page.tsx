// Chat 페이지 진입점 (서버 컴포넌트).
// 레지스트리 (configs/mcp_servers.yaml) 의 HTTP 서버 목록과, 서버 env 에 LLM 키가 있는지 여부만
// ChatShell 에 넘긴다. 키 값 자체는 내려가지 않는다. mockLlm 은 e2e 용 가짜 LLM(CHAT_MOCK_LLM=1)이 켜졌는지 여부다.

import { isMockLlmEnabled } from "@/lib/llm/mock";
import { serverKeyAvailability } from "@/lib/llm/serverKeys";
import { getBrowserReachableServers } from "@/lib/mcp/registry";

import ChatShell from "./ChatShell";

interface ChatPageProps {
  searchParams: Promise<{ server?: string | string[]; c?: string | string[] }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const queryServer =
    typeof params.server === "string" ? params.server : null;
  // 저장된 대화 id (?c=). 형태가 이상한 값은 버린다.
  const queryConversation = typeof params.c === "string" && /^[\w.-]{1,200}$/.test(params.c) ? params.c : null;
  const reachable = await getBrowserReachableServers();

  return (
    <ChatShell
      initialServerFromUrl={queryServer}
      initialConversationId={queryConversation}
      reachable={reachable}
      serverKeys={serverKeyAvailability()}
      mockLlm={isMockLlmEnabled()}
    />
  );
}
