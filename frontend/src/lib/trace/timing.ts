// Server-Timing 응답 헤더 해석과 Inspector 호출 한 건의 스팬 만들기.
//
// 프록시(app/api/mcp/[server]/route.ts)는 응답마다 아래 항목을 붙인다.
//   proxy;dur=0.8                 프록시가 쓴 시간 (레지스트리 조회, 요청 본문 읽기, 응답 준비)
//   upstream;dur=12.4;desc="..."  업스트림 서버를 기다린 시간 (desc 가 어디까지 기다렸는지 알려 줌)
//   headers;dur=1.1               업스트림 응답 헤더가 도착할 때까지의 시간
//
// 막대의 "길이"는 모두 측정값이고 "위치"는 순서대로 이어 붙인 배치다.
// 요청이 프록시에 닿기 전의 네트워크 구간은 측정할 수 없어서 따로 그리지 않고, 남는 시간은 마지막 구간에 모은다.

import type { TraceSpan } from "./spans";

export interface ServerTimingMetric {
  name: string;
  dur?: number;
  desc?: string;
}

// "a;dur=1.5;desc="x y", b;dur=2" -> [{name:"a",dur:1.5,desc:"x y"}, ...]
export function parseServerTiming(header: string | null | undefined): ServerTimingMetric[] {
  if (!header) return [];
  const metrics: ServerTimingMetric[] = [];
  for (const entry of splitOutsideQuotes(header, ",")) {
    const [rawName, ...params] = splitOutsideQuotes(entry, ";");
    const name = rawName?.trim();
    if (!name) continue;
    const metric: ServerTimingMetric = { name };
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq < 0) continue;
      const key = param.slice(0, eq).trim().toLowerCase();
      let value = param.slice(eq + 1).trim();
      if (key === "dur") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) metric.dur = n;
      } else if (key === "desc") {
        if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
          value = value.slice(1, -1).replace(/\\(.)/g, "$1");
        }
        metric.desc = value;
      }
    }
    metrics.push(metric);
  }
  return metrics;
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "\\" && inQuotes) {
      current += ch + (text[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === separator && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export interface ProxyTiming {
  proxyMs: number;
  upstreamMs: number;
  // 업스트림이 응답 헤더를 보낸 시점까지 (SSE 면 첫 본문 바이트보다 이르다)
  headersMs?: number;
}

// proxy 와 upstream 이 모두 있어야 프록시를 거친 측정으로 본다. 직접 연결이면 null.
export function pickProxyTiming(metrics: readonly ServerTimingMetric[]): ProxyTiming | null {
  const find = (name: string) => metrics.find((m) => m.name === name)?.dur;
  const proxyMs = find("proxy");
  const upstreamMs = find("upstream");
  if (proxyMs === undefined || upstreamMs === undefined) return null;
  return { proxyMs, upstreamMs, headersMs: find("headers") };
}

export type CallOutcome = "ok" | "tool-error" | "rpc-error" | "cancelled" | "transport";

export interface CallSpanLabels {
  browser: string;
  proxy: string;
  upstream: string;
  network: string;
}

export interface CallSpanInput {
  // 브라우저가 잰 fetch 시작부터 응답 완료까지의 총 시간
  totalMs: number;
  outcome: CallOutcome;
  timing: ProxyTiming | null;
  path: string;
  labels: CallSpanLabels;
}

// 호출 한 건의 스팬. browser(전체) 아래에 proxy, upstream, 남는 시간을 순서대로 놓는다.
export function buildCallSpans({ totalMs, outcome, timing, path, labels }: CallSpanInput): TraceSpan[] {
  const total = Math.max(totalMs, 0);
  const failed = outcome === "transport" || outcome === "rpc-error";
  const rootStatus = outcome === "cancelled" ? "cancelled" : failed ? "error" : "ok";
  const spans: TraceSpan[] = [
    {
      id: "browser",
      kind: outcome === "transport" ? "error" : "proxy",
      label: labels.browser,
      sub: `POST ${path}`,
      start: 0,
      dur: total,
      status: rootStatus,
    },
  ];
  if (!timing) return spans;

  // 측정값이 총 시간을 넘으면(시계 해상도, 스트림 도중 취소) 총 시간 안으로 줄인다.
  const proxy = Math.min(timing.proxyMs, total);
  const upstream = Math.min(timing.upstreamMs, Math.max(total - proxy, 0));
  spans.push({
    id: "proxy",
    kind: "proxy",
    label: labels.proxy,
    sub: "route.ts",
    start: 0,
    dur: proxy,
    status: "ok",
    parent: "browser",
  });
  spans.push({
    id: "upstream",
    kind: "proxy",
    label: labels.upstream,
    start: proxy,
    dur: upstream,
    status: "ok",
    parent: "browser",
  });
  const rest = total - proxy - upstream;
  if (rest > 0.05) {
    spans.push({
      id: "network",
      kind: "wait",
      label: labels.network,
      start: proxy + upstream,
      dur: rest,
      status: "ok",
      parent: "browser",
    });
  }
  return spans;
}
