// Inspector 페이지 (PRD §3.5 / F-4). 서버 컴포넌트가 레지스트리를 읽고 InspectorView 에 넘긴다.
// 서버는 셸 탐색기가 ?server= 로 고른다. 값이 stdio 서버면 호출 대신 CLI 안내(StdioNotice)를 보여 준다.

import { getT } from "@/lib/i18n/server";
import { httpTwinOf } from "@/lib/inspector/cli";
import { getBrowserReachableServers, getPublicServers } from "@/lib/mcp/registry";
import type { StreamableHttpServer } from "@/lib/mcp/types";

import { InspectorView } from "./InspectorView";

interface InspectorPageProps {
  searchParams: Promise<{ server?: string | string[] }>;
}

export default async function InspectorPage({ searchParams }: InspectorPageProps) {
  const params = await searchParams;
  const queryServer = typeof params.server === "string" ? params.server : undefined;

  const [reachable, all] = await Promise.all([getBrowserReachableServers(), getPublicServers()]);
  const t = await getT();

  const stdio = queryServer ? all.find((s) => s.name === queryServer && s.transport === "stdio") : undefined;

  // 레지스트리에 없는 이름은 이 탭 세션의 런타임 서버일 수 있다 (sessionStorage 는 브라우저만 알아서 InspectorView 가 찾는다).
  const maybeRuntime = Boolean(queryServer) && !stdio && !reachable.some((s) => s.name === queryServer);

  if (reachable.length === 0 && !stdio && !maybeRuntime) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-3 text-2xl font-semibold">{t("inspector.title")}</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t.rich("inspector.noServers", {
            cmd: (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                make run-mock-repo-mcp
              </code>
            ),
          })}
        </div>
      </div>
    );
  }

  if (stdio) {
    return (
      <InspectorView
        key={stdio.name}
        initialServer={stdio.name}
        reachable={reachable}
        stdio={{
          name: stdio.name,
          description: stdio.description,
          descriptionKo: stdio.descriptionKo,
          twin: httpTwinOf(stdio.name, all),
        }}
      />
    );
  }

  if (maybeRuntime && queryServer) {
    return <InspectorView key={queryServer} initialServer={queryServer} reachable={reachable} />;
  }

  const initial = resolveInitialServer(queryServer, reachable);
  // key: 탐색기에서 다른 서버를 누르면(?server= 변경) 도구 목록과 응답을 새로 시작한다.
  return <InspectorView key={initial.name} initialServer={initial.name} reachable={reachable} />;
}

function resolveInitialServer(
  queryName: string | undefined,
  reachable: readonly StreamableHttpServer[],
): StreamableHttpServer {
  if (queryName) {
    const match = reachable.find((s) => s.name === queryName);
    if (match) return match;
  }
  // reachable.length > 0 보장됨 (호출처 가드).
  return reachable[0]!;
}
