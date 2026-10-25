// 오프라인 서버 안내: 복구 명령과 오류 분류. 순수 함수.

// docker-compose.yaml 에 실제로 있는 서비스 이름. 레지스트리 이름에서 "-http" 를 뗀 값과 맞춘다.
// 새 서비스를 compose 에 넣으면 여기도 고친다 (offline.test.ts 가 compose 파일과 맞는지 검사한다).
export const COMPOSE_SERVICES: readonly string[] = ["starter-mcp", "mock-repo-mcp", "nl2sql-mcp"];

export interface RecoveryCommands {
  // compose 에 서비스가 있을 때만 값이 있다.
  compose: string | null;
  make: string;
}

// Makefile 의 `run-<registry name>` 규칙을 따른다 (run-starter-mcp-http, run-mock-repo-mcp, run-nl2sql-mcp-http).
export function recoveryCommands(serverName: string): RecoveryCommands {
  const service = serverName.replace(/-http$/, "");
  return {
    compose: COMPOSE_SERVICES.includes(service) ? `docker compose up -d ${service}` : null,
    make: `make run-${serverName}`,
  };
}

export type ProbeErrorKind = "unreachable" | "timeout" | "auth" | "other";

export interface ProbeError {
  kind: ProbeErrorKind;
  // 사람이 읽을 한 줄. 프록시가 JSON-RPC 오류로 감싼 메시지가 있으면 그 안쪽을 꺼낸다.
  detail: string;
}

const DETAIL_MAX = 240;

function innerMessage(raw: string): string {
  const m = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return raw;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1]!;
  }
}

export function classifyProbeError(raw: string): ProbeError {
  const detail = innerMessage(raw).replace(/\s+/g, " ").trim();
  const clipped = detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX - 1)}…` : detail;
  const text = `${raw} ${detail}`;
  let kind: ProbeErrorKind = "other";
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(text)) kind = "auth";
  else if (/time(d)? ?out/i.test(text)) kind = "timeout";
  else if (/unreachable|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|connection refused/i.test(text)) {
    kind = "unreachable";
  }
  return { kind, detail: clipped };
}
