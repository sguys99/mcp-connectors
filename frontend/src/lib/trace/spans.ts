// Trace 스팬 모델. Inspector 의 Timing 탭과 Chat 의 trace 열이 같은 워터폴 컴포넌트(components/trace/Waterfall)로 그린다.
//
// 시간 단위는 모두 ms 이고, start 는 trace 시작(0)을 기준으로 한 상대값이다.
// 이 파일은 React 와 DOM 에 의존하지 않는 순수 모듈이다.

export type SpanKind = "llm" | "tool" | "guard" | "proxy" | "db" | "error" | "wait";

// ok 정상 종료, error 실패, running 진행 중(dur 는 지금까지의 시간), waiting 사용자 승인 같은 대기, cancelled 취소됨
export type SpanStatus = "ok" | "error" | "running" | "waiting" | "cancelled";

export interface TraceSpan {
  id: string;
  kind: SpanKind;
  // 행에 보이는 짧은 이름 (예: "proxy", "run_sql_query")
  label: string;
  // 이름 옆 보조 문구 (예: "POST /api/mcp/starter-mcp-http")
  sub?: string;
  start: number;
  dur: number;
  status: SpanStatus;
  // 부모 스팬 id. 들여쓰기와 연결선에 쓴다.
  parent?: string;
}

export const SPAN_KINDS: readonly SpanKind[] = ["llm", "tool", "guard", "proxy", "db", "error", "wait"];

export interface FlatSpan extends TraceSpan {
  depth: number;
}

// 부모가 먼저 오고 자식이 start 순으로 이어지는 깊이 우선 순서로 펼친다.
// 부모가 없거나 목록에 없는 스팬은 루트로 본다. 순환 참조는 끊어서 무한 루프를 막는다.
export function flattenSpans(spans: readonly TraceSpan[]): FlatSpan[] {
  const ids = new Set(spans.map((s) => s.id));
  const children = new Map<string | undefined, TraceSpan[]>();
  for (const span of spans) {
    const key = span.parent && ids.has(span.parent) && span.parent !== span.id ? span.parent : undefined;
    const list = children.get(key) ?? [];
    list.push(span);
    children.set(key, list);
  }
  for (const list of children.values()) {
    // 같은 start 면 입력 순서를 지킨다 (Array.sort 는 안정 정렬).
    list.sort((a, b) => a.start - b.start);
  }

  const out: FlatSpan[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | undefined, depth: number) => {
    for (const span of children.get(parent) ?? []) {
      if (seen.has(span.id)) continue;
      seen.add(span.id);
      out.push({ ...span, depth });
      visit(span.id, depth + 1);
    }
  };
  visit(undefined, 0);

  // 순환 때문에 닿지 못한 스팬도 버리지 않고 루트로 붙인다.
  for (const span of spans) {
    if (!seen.has(span.id)) {
      seen.add(span.id);
      out.push({ ...span, depth: 0 });
      visit(span.id, 1);
    }
  }
  return out;
}

// 모든 스팬이 끝나는 가장 늦은 시각. 비어 있으면 0.
export function traceExtent(spans: readonly TraceSpan[]): number {
  let end = 0;
  for (const span of spans) end = Math.max(end, span.start + Math.max(0, span.dur));
  return end;
}
