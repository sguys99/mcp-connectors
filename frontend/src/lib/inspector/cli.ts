// stdio 서버는 브라우저가 프록시로 부를 수 없어서, 터미널에서 쓸 명령을 안내한다.
// 여기 있는 make 대상은 Makefile 에 실제로 있는 것만 적는다 (cli.test.ts 가 Makefile 과 맞는지 검사한다).

import type { PublicServer } from "@/lib/mcp/types";

// 서버 이름 -> Makefile 의 CLI 대상. 그 밖의 stdio 서버는 mcp_cli.py 를 직접 부르는 명령을 보여 준다.
export const MAKE_CLI_TARGETS: Readonly<Record<string, { listTools: string; call?: string }>> = {
  "starter-mcp": { listTools: "cli-list-tools-starter", call: "cli-call-starter" },
};

export interface CliCommands {
  list: string;
  call: string;
}

export function cliCommands(serverName: string): CliCommands {
  const target = MAKE_CLI_TARGETS[serverName];
  const list = target ? `make ${target.listTools}` : `uv run python scripts/mcp_cli.py list-tools --server ${serverName}`;
  // starter-mcp 는 PRD 인수 기준의 echo 호출이 Makefile 에 있어서 그것을 쓴다.
  const call =
    serverName === "starter-mcp"
      ? `python scripts/mcp_cli.py call --server ${serverName} --tool echo --params '{"text":"hi"}'`
      : `python scripts/mcp_cli.py call --server ${serverName} --tool <tool> --params '{}'`;
  return { list, call };
}

// "<name>-http" 쌍둥이 서버 (레지스트리에 있고 브라우저에서 부를 수 있는 것만).
export function httpTwinOf(serverName: string, servers: readonly Pick<PublicServer, "name" | "transport">[]): string | null {
  const twin = `${serverName}-http`;
  return servers.some((s) => s.name === twin && s.transport === "streamable_http") ? twin : null;
}
