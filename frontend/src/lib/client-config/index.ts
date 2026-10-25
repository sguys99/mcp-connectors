// "클라이언트 설정 복사": 선택한 서버를 Claude Desktop, Cursor, VS Code, Claude Code 에 붙여 넣을 설정으로 만든다 (순수 함수).
//
// 비밀은 절대 담지 않는다. API Key 같은 헤더 값은 환경 변수 참조나 자리표시자로만 쓴다
// (브라우저는 서버의 MCP_API_KEY 를 갖고 있지도 않다. 런타임 서버의 헤더 값도 이름만 쓰고 값은 쓰지 않는다).
//
// 형식 출처 (2026-10 확인):
//   * Claude Desktop  claude_desktop_config.json 은 로컬 stdio 서버만 직접 실행한다. 원격 HTTP 서버는 mcp-remote 브리지로 붙인다.
//       https://github.com/geelen/mcp-remote  (--header "Name:${ENV}" 와 env 블록, http:// 주소는 --allow-http)
//       Windows 의 args 공백 문제 때문에 "Name:${ENV}" 처럼 콜론 뒤에 공백 없이 쓰고 값은 env 에 둔다.
//   * Cursor          .cursor/mcp.json, 최상위 mcpServers. 원격은 url + headers, 값 보간은 ${env:NAME}.
//       https://cursor.com/docs/context/mcp
//   * VS Code         .vscode/mcp.json, 최상위 servers (+ inputs). type 은 stdio | http | sse. 비밀은 ${input:id} (promptString, password).
//       https://code.visualstudio.com/docs/agents/reference/mcp-configuration
//   * Claude Code     `claude mcp add --transport http <name> <url> --header "Name: value"`, 프로젝트 파일 .mcp.json (type: http, headers 에 ${VAR} 보간).
//       https://code.claude.com/docs/en/mcp
// 공식 문서가 바뀌면 이 파일과 index.test.ts 의 스냅샷을 함께 고친다.

import { isSecretParamName } from "@/lib/inspector/redact";

export const CLIENT_IDS = ["claude-desktop", "cursor", "vscode", "claude-code"] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface HeaderRef {
  // HTTP 헤더 이름
  name: string;
  // 값을 담을 환경 변수 이름
  env: string;
  // 값 앞에 붙는 인증 스킴 (Bearer, Basic). 토큰 자체는 담지 않는다.
  prefix?: string;
}

export type ConfigServer =
  | { name: string; kind: "http"; url: string; headers: HeaderRef[] }
  | { name: string; kind: "stdio"; command: readonly string[] };

export interface ConfigBlock {
  // 화면 문구 키로 쓰는 식별자
  id: "desktop-file" | "cursor-file" | "vscode-file" | "cli" | "mcp-json";
  format: "json" | "shell";
  text: string;
}

export interface ClientConfig {
  client: ClientId;
  blocks: ConfigBlock[];
  // 붙여 넣기 전에 사용자가 채워야 하는 것들 (화면이 안내 문구를 고른다)
  needs: {
    envVars: string[];
    repoPath: boolean;
    allowHttp: boolean;
  };
}

const REPO_PLACEHOLDER = "/absolute/path/to/mcp-connectors";

// ---------- 서버 정보 -> 설정 입력 ---------- //

// 설정에 넣을 주소에서 비밀을 뺀다: 쿼리의 비밀 값(api_key=, token= ...)과 userinfo 비밀번호를 자리표시자로 바꾼다.
// 문자열 그대로 바꿔 나머지 주소(인코딩 포함)는 건드리지 않는다. 자리표시자는 셸과 JSON 에서 따옴표 없이 안전한 글자만 쓴다.
export function stripUrlSecrets(url: string): string {
  const hashAt = url.indexOf("#");
  const head = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const queryAt = head.indexOf("?");
  let base = queryAt >= 0 ? head.slice(0, queryAt) : head;
  let query = queryAt >= 0 ? head.slice(queryAt + 1) : null;
  base = base.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#@:]*):([^/?#@]*)@/i, (_m, scheme: string, user: string) => `${scheme}${user}:YOUR_PASSWORD@`);
  if (query !== null) {
    query = query
      .split("&")
      .map((part) => {
        const eq = part.indexOf("=");
        if (eq < 0) return part;
        let name = part.slice(0, eq);
        try {
          name = decodeURIComponent(name);
        } catch {
          /* 그대로 */
        }
        return isSecretParamName(name) ? `${part.slice(0, eq)}=YOUR_${envNameFor(name)}` : part;
      })
      .join("&");
  }
  return `${base}${query !== null ? `?${query}` : ""}${hash}`;
}

export function envNameFor(headerName: string): string {
  const env = headerName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(env) ? `H_${env}` : env || "HEADER_VALUE";
}

export function refFromHeader(name: string, value: string): HeaderRef {
  const scheme = /^(Bearer|Basic)\s+\S/i.exec(value.trim())?.[1];
  const prefix = scheme ? scheme[0]!.toUpperCase() + scheme.slice(1).toLowerCase() : undefined;
  const env = name.toLowerCase() === "authorization" ? "AUTHORIZATION_TOKEN" : envNameFor(name);
  return { name, env, ...(prefix ? { prefix } : {}) };
}

// 등록 서버 -> 설정 입력. includeApiKey 면 서버가 MCP_API_KEY 를 켠 경우를 위해 X-MCP-API-Key 헤더 참조를 넣는다.
export function fromRegistryServer(
  server: { name: string; transport: "streamable_http"; externalUrl?: string } | { name: string; transport: "stdio"; command?: readonly string[] },
  includeApiKey: boolean,
): ConfigServer | null {
  if (server.transport === "stdio") {
    return server.command && server.command.length > 0 ? { name: server.name, kind: "stdio", command: server.command } : null;
  }
  if (!server.externalUrl) return null;
  return {
    name: server.name,
    kind: "http",
    url: server.externalUrl,
    headers: includeApiKey ? [{ name: "X-MCP-API-Key", env: "MCP_API_KEY" }] : [],
  };
}

// 런타임 서버 -> 설정 입력. 헤더는 이름만 쓰고 값은 버린다 (Bearer 같은 스킴 단어만 남긴다).
// 주소의 쿼리 비밀과 userinfo 비밀번호도 자리표시자로 바꾼다 (stripUrlSecrets).
export function fromRuntime(def: { name: string; url: string; headers: readonly { name: string; value: string }[] }): ConfigServer {
  return {
    name: def.name,
    kind: "http",
    url: stripUrlSecrets(def.url),
    headers: def.headers.filter((h) => h.name.trim() !== "").map((h) => refFromHeader(h.name.trim(), h.value)),
  };
}

// ---------- 공통 ---------- //

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// stdio 명령: uv 로 시작하면 어느 디렉터리에서 실행돼도 되도록 --directory 를 넣는다 (레지스트리 명령은 src/mcp-servers 에서 실행된다).
function stdioParts(command: readonly string[]): { command: string; args: string[] } {
  const [exe = "", ...rest] = command;
  if (exe === "uv") return { command: "uv", args: ["--directory", `${REPO_PLACEHOLDER}/src/mcp-servers`, ...rest] };
  return { command: exe, args: rest };
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
export function shellQuote(value: string): string {
  if (value !== "" && SHELL_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function needsAllowHttp(url: string): boolean {
  return url.startsWith("http://");
}

function collectEnv(server: ConfigServer): string[] {
  return server.kind === "http" ? [...new Set(server.headers.map((h) => h.env))] : [];
}

// ${ENV} 참조를 헤더 값 문자열로 (스킴이 있으면 앞에 붙인다)
function refValue(h: HeaderRef, ref: string): string {
  return h.prefix ? `${h.prefix} ${ref}` : ref;
}

// ---------- 클라이언트별 ---------- //

function claudeDesktop(server: ConfigServer): ClientConfig {
  if (server.kind === "stdio") {
    return {
      client: "claude-desktop",
      blocks: [{ id: "desktop-file", format: "json", text: json({ mcpServers: { [server.name]: stdioParts(server.command) } }) }],
      needs: { envVars: [], repoPath: server.command[0] === "uv", allowHttp: false },
    };
  }
  const args = ["-y", "mcp-remote", server.url];
  if (needsAllowHttp(server.url)) args.push("--allow-http");
  const env: Record<string, string> = {};
  for (const h of server.headers) {
    // 콜론 뒤에 공백을 두지 않고, 값(스킴 포함)은 env 에 둔다 (Windows 에서 args 의 공백이 깨지는 문제 회피)
    args.push("--header", `${h.name}:\${${h.env}}`);
    env[h.env] = h.prefix ? `${h.prefix} <your ${h.env}>` : `<your ${h.env}>`;
  }
  const entry = { command: "npx", args, ...(Object.keys(env).length > 0 ? { env } : {}) };
  return {
    client: "claude-desktop",
    blocks: [{ id: "desktop-file", format: "json", text: json({ mcpServers: { [server.name]: entry } }) }],
    needs: { envVars: collectEnv(server), repoPath: false, allowHttp: needsAllowHttp(server.url) },
  };
}

function cursor(server: ConfigServer): ClientConfig {
  if (server.kind === "stdio") {
    return {
      client: "cursor",
      blocks: [{ id: "cursor-file", format: "json", text: json({ mcpServers: { [server.name]: { type: "stdio", ...stdioParts(server.command) } } }) }],
      needs: { envVars: [], repoPath: server.command[0] === "uv", allowHttp: false },
    };
  }
  const headers = Object.fromEntries(server.headers.map((h) => [h.name, refValue(h, `\${env:${h.env}}`)]));
  const entry = { url: server.url, ...(server.headers.length > 0 ? { headers } : {}) };
  return {
    client: "cursor",
    blocks: [{ id: "cursor-file", format: "json", text: json({ mcpServers: { [server.name]: entry } }) }],
    needs: { envVars: collectEnv(server), repoPath: false, allowHttp: false },
  };
}

function vscodeInputId(env: string): string {
  return env.toLowerCase().replace(/_/g, "-");
}

function vscode(server: ConfigServer): ClientConfig {
  if (server.kind === "stdio") {
    return {
      client: "vscode",
      blocks: [{ id: "vscode-file", format: "json", text: json({ servers: { [server.name]: { type: "stdio", ...stdioParts(server.command) } } }) }],
      needs: { envVars: [], repoPath: server.command[0] === "uv", allowHttp: false },
    };
  }
  const headers = Object.fromEntries(server.headers.map((h) => [h.name, refValue(h, `\${input:${vscodeInputId(h.env)}}`)]));
  const inputs = server.headers.map((h) => ({
    type: "promptString",
    id: vscodeInputId(h.env),
    description: h.prefix ? `${h.name} (token only, ${h.prefix} is added)` : h.name,
    password: true,
  }));
  const entry = { type: "http", url: server.url, ...(server.headers.length > 0 ? { headers } : {}) };
  const file = server.headers.length > 0 ? { inputs, servers: { [server.name]: entry } } : { servers: { [server.name]: entry } };
  return {
    client: "vscode",
    blocks: [{ id: "vscode-file", format: "json", text: json(file) }],
    needs: { envVars: [], repoPath: false, allowHttp: false },
  };
}

function claudeCode(server: ConfigServer): ClientConfig {
  if (server.kind === "stdio") {
    const { command, args } = stdioParts(server.command);
    const cli = ["claude mcp add --transport stdio", shellQuote(server.name), "--", shellQuote(command), ...args.map(shellQuote)].join(" ");
    return {
      client: "claude-code",
      blocks: [
        { id: "cli", format: "shell", text: cli },
        { id: "mcp-json", format: "json", text: json({ mcpServers: { [server.name]: { type: "stdio", command, args, env: {} } } }) },
      ],
      needs: { envVars: [], repoPath: server.command[0] === "uv", allowHttp: false },
    };
  }
  // 작은따옴표로 감싸 ${ENV} 가 셸에서 풀리지 않고 Claude Code 가 실행 시점에 풀게 한다
  const headerFlags = server.headers.map((h) => `--header ${shellQuote(`${h.name}: ${refValue(h, `\${${h.env}}`)}`)}`);
  const cli = ["claude mcp add --transport http", shellQuote(server.name), shellQuote(server.url), ...headerFlags].join(" ");
  const headers = Object.fromEntries(server.headers.map((h) => [h.name, refValue(h, `\${${h.env}}`)]));
  const entry = { type: "http", url: server.url, ...(server.headers.length > 0 ? { headers } : {}) };
  return {
    client: "claude-code",
    blocks: [
      { id: "cli", format: "shell", text: cli },
      { id: "mcp-json", format: "json", text: json({ mcpServers: { [server.name]: entry } }) },
    ],
    needs: { envVars: collectEnv(server), repoPath: false, allowHttp: false },
  };
}

export function buildClientConfig(client: ClientId, server: ConfigServer): ClientConfig {
  switch (client) {
    case "claude-desktop":
      return claudeDesktop(server);
    case "cursor":
      return cursor(server);
    case "vscode":
      return vscode(server);
    case "claude-code":
      return claudeCode(server);
  }
}
