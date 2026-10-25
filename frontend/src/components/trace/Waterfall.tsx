"use client";

// 워터폴: Inspector 의 Timing 탭과 Chat 의 trace 열이 함께 쓰는 시간 막대 그래프.
//
//   <Waterfall spans={spans} label="Request timing" selectedId={id} onSelect={setId} />
//
// * 스팬 모델과 눈금 계산은 lib/trace 의 순수 함수에 있다. 이 파일은 그리기와 키보드만 맡는다.
// * 색은 --span-* 토큰만 쓴다. 색에만 기대지 않도록 종류마다 아이콘이 다르고, 대기는 빗금 막대, 취소는 점선 막대,
//   실패와 취소는 오른쪽에 상태 아이콘이 붙는다.
// * 접근성: onSelect 가 있으면 listbox(행 = option, 방향키 이동, Enter/Space 선택), 없으면 읽기 전용 list 다.
//   행마다 "이름, 소요 시간, 상태" 가 한 문장으로 읽힌다. 시간축은 장식이라 숨긴다.
// * 모션: 막대 이동은 motion-safe 에서만 움직이고, 실행 중 표시의 흐르는 빛은 reduced-motion 에서 멈춘다.
// * 격자선은 SVG crispEdges 라서 어떤 배율에서도 1px 로 또렷하다. 숫자는 tabular-nums.

import {
  AlertCircleIcon,
  BanIcon,
  CheckIcon,
  ClockIcon,
  DatabaseIcon,
  HourglassIcon,
  RouteIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/translate";
import { buildAxis, formatDuration, formatTick, spanFraction } from "@/lib/trace/scale";
import { flattenSpans, SPAN_KINDS, traceExtent, type FlatSpan, type SpanKind, type SpanStatus, type TraceSpan } from "@/lib/trace/spans";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<SpanKind, LucideIcon> = {
  llm: SparklesIcon,
  tool: WrenchIcon,
  guard: ShieldCheckIcon,
  proxy: RouteIcon,
  db: DatabaseIcon,
  error: AlertCircleIcon,
  wait: HourglassIcon,
};

export const KIND_LABEL: Record<SpanKind, TKey> = {
  llm: "trace.kindLlm",
  tool: "trace.kindTool",
  guard: "trace.kindGuard",
  proxy: "trace.kindProxy",
  db: "trace.kindDb",
  error: "trace.kindError",
  wait: "trace.kindWait",
};

// 종류별 색 토큰. 클래스 문자열을 통째로 적어 두어야 Tailwind 가 만들어 준다.
const KIND_COLOR: Record<SpanKind, string> = {
  llm: "[--c:var(--span-llm)]",
  tool: "[--c:var(--span-tool)]",
  guard: "[--c:var(--span-guard)]",
  proxy: "[--c:var(--span-proxy)]",
  db: "[--c:var(--span-proxy)]",
  error: "[--c:var(--span-err)]",
  wait: "[--c:var(--span-wait)]",
};

const STATUS_LABEL: Record<SpanStatus, TKey> = {
  ok: "trace.statusOk",
  error: "trace.statusError",
  running: "trace.statusRunning",
  waiting: "trace.statusWaiting",
  cancelled: "trace.statusCancelled",
};

const STATUS_ICON: Record<SpanStatus, LucideIcon> = {
  ok: CheckIcon,
  error: AlertCircleIcon,
  running: ClockIcon,
  waiting: HourglassIcon,
  cancelled: BanIcon,
};

const STATUS_COLOR: Record<SpanStatus, string> = {
  ok: "text-success-fg",
  error: "text-danger-fg",
  running: "text-warning-fg",
  waiting: "text-warning-fg",
  cancelled: "text-fg-muted",
};

// 대기와 취소는 빗금 + 점선 막대로 그려서 색을 못 보는 사람도 구분할 수 있다.
const HATCH_BAR =
  "border-dashed bg-[repeating-linear-gradient(-45deg,color-mix(in_oklab,var(--c)_38%,var(--surface))_0_4px,var(--surface)_4px_8px)]";

// 가로 폭이 이보다 좁으면(모바일, 좁은 열) 이름 줄 아래에 막대 줄을 쌓는다.
const STACK_BELOW = 360;
const ROW_PAD_X = 12;

export interface WaterfallProps {
  spans: readonly TraceSpan[];
  // 스크린 리더가 읽는 이름 (예: "Request timing")
  label: string;
  selectedId?: string | null;
  // 주면 행을 선택할 수 있는 listbox 가 된다.
  onSelect?: (id: string) => void;
  // 바깥(예: 도구 카드)이 가리키는 스팬을 연하게 강조한다.
  linkedId?: string | null;
  onHover?: (id: string | null) => void;
  // 시간축의 최소 길이(ms). 아주 짧은 호출도 눈금이 의미 있게 나온다.
  minTotal?: number;
  // 이름 열의 폭(px)
  labelWidth?: number;
  // true 면 스팬에 있는 종류만, 배열이면 그 종류만, false 면 범례를 숨긴다.
  legend?: boolean | readonly SpanKind[];
  className?: string;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Waterfall({
  spans,
  label,
  selectedId = null,
  onSelect,
  linkedId = null,
  onHover,
  minTotal = 4,
  labelWidth = 168,
  legend = true,
  className,
}: WaterfallProps) {
  const t = useT();
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const stacked = width > 0 && width < STACK_BELOW;
  const labelW = stacked ? 0 : labelWidth;
  const trackW = Math.max((width || 360) - labelW - ROW_PAD_X, 80);

  const flat = useMemo(() => flattenSpans(spans), [spans]);
  const total = Math.max(minTotal, traceExtent(spans));
  const maxTicks = Math.max(2, Math.min(7, Math.floor(trackW / 64)));
  const axis = useMemo(() => buildAxis(total, maxTicks), [total, maxTicks]);

  const selectable = typeof onSelect === "function";
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // 방향키로 옮기는 "지금 포커스를 받는 행". 선택된 행이 있으면 그것이 먼저다.
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabbableId =
    (activeId && flat.some((s) => s.id === activeId) ? activeId : null) ??
    (selectedId && flat.some((s) => s.id === selectedId) ? selectedId : null) ??
    flat[0]?.id ??
    null;

  // 바깥에서 선택이 바뀌면(카드를 눌러서) 그 행이 보이게 스크롤한다.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const move = (to: number) => {
      const target = flat[Math.max(0, Math.min(flat.length - 1, to))];
      if (!target) return;
      event.preventDefault();
      setActiveId(target.id);
      rowRefs.current.get(target.id)?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return move(index + 1);
      case "ArrowUp":
        return move(index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(flat.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        return onSelect?.(flat[index]!.id);
    }
  }

  const legendKinds: SpanKind[] =
    legend === false
      ? []
      : Array.isArray(legend)
        ? [...legend]
        : kindsPresent(spans);

  return (
    <div className={cn("min-w-0", className)}>
      <div ref={hostRef} className="min-w-0 font-mono text-2xs tabular-nums" style={{ "--wf-label-w": `${labelW}px` } as React.CSSProperties}>
        {/* 시간축 (장식). 소요 시간은 각 행의 이름에서 읽힌다. */}
        <div
          aria-hidden="true"
          className="sticky top-0 z-[2] grid h-[22px] items-end border-b border-line bg-surface-sunken"
          style={{ gridTemplateColumns: `${labelW}px minmax(0,1fr)` }}
        >
          <div className="pb-1 pl-3 text-[10px] tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-normal">
            {stacked ? null : t("trace.axis")}
          </div>
          <div className="relative h-full" style={{ marginInline: stacked ? `${ROW_PAD_X}px ${ROW_PAD_X}px` : `0 ${ROW_PAD_X}px` }}>
            {axis.ticks.map((tick, i) => {
              const pct = (tick / axis.domain) * 100;
              const edge = i === 0 ? "first" : i === axis.ticks.length - 1 ? "last" : "mid";
              return (
                <span
                  key={tick}
                  className={cn(
                    "absolute bottom-1 text-[10px] leading-3 whitespace-nowrap text-fg-muted",
                    edge === "mid" && "-translate-x-1/2",
                    edge === "last" && "-translate-x-full",
                  )}
                  style={{ left: `${pct}%` }}
                >
                  {formatTick(tick, axis.step)}
                </span>
              );
            })}
          </div>
        </div>

        <div
          role={selectable ? "listbox" : "list"}
          aria-label={label}
          className="relative"
        >
          {/* 격자선: 막대보다 아래에 깔리고 클릭을 막지 않는다 */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 h-full overflow-visible"
            style={{ left: stacked ? ROW_PAD_X : labelW, width: `calc(100% - ${(stacked ? ROW_PAD_X : labelW) + ROW_PAD_X}px)` }}
          >
            {axis.ticks.map((tick, i) => (
              <line
                key={tick}
                x1={`${(tick / axis.domain) * 100}%`}
                x2={`${(tick / axis.domain) * 100}%`}
                y1="0"
                y2="100%"
                shapeRendering="crispEdges"
                stroke="var(--line)"
                strokeOpacity={i === 0 ? 1 : 0.7}
                strokeWidth="1"
              />
            ))}
          </svg>

          {flat.map((span, index) => (
            <WaterfallRow
              key={span.id}
              span={span}
              index={index}
              domain={axis.domain}
              trackW={trackW}
              stacked={stacked}
              selectable={selectable}
              selected={selectedId === span.id}
              linked={linkedId === span.id}
              tabbable={selectable && tabbableId === span.id}
              registerRef={(el) => {
                if (el) rowRefs.current.set(span.id, el);
                else rowRefs.current.delete(span.id);
              }}
              onSelect={() => {
                setActiveId(span.id);
                onSelect?.(span.id);
              }}
              onFocus={() => setActiveId(span.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              onHover={onHover}
            />
          ))}
        </div>
      </div>

      <WaterfallLegend kinds={legendKinds} />
    </div>
  );
}

// 범례: 종류별 아이콘 + 이름. Waterfall 이 기본으로 그리고, 상자 밖에 따로 놓고 싶으면 legend={false} 로 끄고 직접 쓴다.
export function WaterfallLegend({ kinds, className }: { kinds: readonly SpanKind[]; className?: string }) {
  const t = useT();
  if (kinds.length === 0) return null;
  return (
    <ul aria-label={t("trace.legend")} className={cn("mt-2 flex flex-wrap gap-x-3 gap-y-1 px-3 font-mono text-2xs text-fg-muted", className)}>
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind];
        return (
          <li key={kind} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("grid size-4 place-items-center rounded-xs bg-[var(--c)] text-surface", KIND_COLOR[kind])}>
              <Icon className="size-[11px]" strokeWidth={2} />
            </span>
            {t(KIND_LABEL[kind])}
          </li>
        );
      })}
    </ul>
  );
}

// 스팬 목록에 실제로 나온 종류만 (SPAN_KINDS 순서). 범례에 쓴다.
export function kindsPresent(spans: readonly TraceSpan[]): SpanKind[] {
  return SPAN_KINDS.filter((kind) => spans.some((s) => s.kind === kind));
}

interface RowProps {
  span: FlatSpan;
  index: number;
  domain: number;
  trackW: number;
  stacked: boolean;
  selectable: boolean;
  selected: boolean;
  linked: boolean;
  tabbable: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onHover?: (id: string | null) => void;
}

function WaterfallRow({
  span,
  domain,
  trackW,
  stacked,
  selectable,
  selected,
  linked,
  tabbable,
  registerRef,
  onSelect,
  onFocus,
  onKeyDown,
  onHover,
}: RowProps) {
  const t = useT();
  const Icon = KIND_ICON[span.kind];
  const StatusIcon = STATUS_ICON[span.status];
  const frac = spanFraction(span.start, span.dur, domain);
  const barLeft = frac.left * trackW;
  const barWidth = Math.max(frac.width * trackW, 3);

  const durText = span.status === "running" ? `${formatDuration(span.dur)} ${t("trace.running")}` : formatDuration(span.dur);
  const statusText = t(STATUS_LABEL[span.status]);
  // 모노 10px 글자 폭을 어림해서 라벨 위치(막대 안, 오른쪽, 왼쪽, 알약)를 정한다.
  const textW = durText.length * 6.1 + 2;
  const hatched = span.kind === "wait" || span.status === "waiting" || span.status === "cancelled";
  let labelLeft: number;
  let labelMode: "inside" | "outside" | "pill" = "outside";
  if (!hatched && barWidth >= textW + 14) {
    labelLeft = barLeft + 7;
    labelMode = "inside";
  } else if (barLeft + barWidth + 6 + textW <= trackW) {
    labelLeft = barLeft + barWidth + 6;
  } else if (barLeft - 6 - textW >= 0) {
    labelLeft = barLeft - 6 - textW;
  } else {
    labelLeft = Math.max(barLeft + 6, Math.min(trackW - textW - 2, barLeft + 6));
    labelMode = "pill";
  }

  const kindName = t(KIND_LABEL[span.kind]);
  const accessibleName = `${kindName}, ${span.label}${span.sub ? ` ${span.sub}` : ""}, ${durText}, ${statusText}`;
  const colorClass = span.status === "error" ? "[--c:var(--span-err)]" : KIND_COLOR[span.kind];

  return (
    <div
      ref={registerRef}
      role={selectable ? "option" : "listitem"}
      aria-selected={selectable ? selected : undefined}
      aria-label={accessibleName}
      tabIndex={selectable ? (tabbable ? 0 : -1) : undefined}
      data-span={span.id}
      data-kind={span.kind}
      data-status={span.status}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      onFocus={selectable ? onFocus : undefined}
      onMouseEnter={onHover ? () => onHover(span.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      className={cn(
        "relative grid min-h-7 items-center border-b border-line/50 outline-hidden",
        colorClass,
        selectable && "cursor-pointer hover:bg-surface-hover/80",
        linked && "bg-surface-hover/80 shadow-[inset_2px_0_0_var(--focus-ring)]",
        selected && "bg-sel-row shadow-[inset_2px_0_0_var(--brand)] motion-safe:[animation:mcpc-wf-flash_1.1s_var(--ease-standard)]",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring",
      )}
      style={{ gridTemplateColumns: stacked ? "minmax(0,1fr)" : "var(--wf-label-w) minmax(0,1fr)" }}
    >
      <div
        className="flex min-w-0 items-center gap-[5px] pr-2"
        style={{ paddingLeft: `${12 + span.depth * (stacked ? 10 : 12)}px`, paddingTop: stacked ? 3 : 0 }}
      >
        {span.depth > 0 ? (
          <span aria-hidden="true" className="relative -ml-[3px] h-7 w-2 flex-none before:absolute before:-top-0.5 before:left-0 before:h-1/2 before:w-[7px] before:rounded-bl-[3px] before:border-b before:border-l before:border-line-strong before:content-['']" />
        ) : null}
        <span aria-hidden="true" className="grid size-4 flex-none place-items-center rounded-xs bg-[var(--c)] text-surface">
          <Icon className="size-[11px]" strokeWidth={2} />
        </span>
        <span
          title={`${span.label}${span.sub ? ` ${span.sub}` : ""}`}
          className={cn("min-w-0 truncate font-medium text-foreground", span.depth === 0 && "font-semibold")}
        >
          {span.label}
          {span.sub ? <small className="ml-[5px] text-[10px] font-normal text-fg-muted">{span.sub}</small> : null}
        </span>
        <span aria-hidden="true" className={cn("ml-auto inline-flex flex-none", STATUS_COLOR[span.status])}>
          <StatusIcon className="size-3" />
        </span>
      </div>

      <div className="relative" style={{ height: stacked ? 22 : 28, marginInline: stacked ? `${ROW_PAD_X}px` : `0 ${ROW_PAD_X}px` }}>
        <div
          aria-hidden="true"
          className={cn(
            "absolute h-3.5 min-w-[3px] rounded-[2px] border border-[var(--c)]",
            stacked ? "top-[3px]" : "top-[7px]",
            "bg-[color-mix(in_oklab,var(--c)_26%,var(--surface))]",
            "before:absolute before:inset-y-[-1px] before:left-[-1px] before:w-[3px] before:rounded-l-[2px] before:bg-[var(--c)] before:content-['']",
            "motion-safe:transition-[left,width] motion-safe:duration-300",
            hatched && HATCH_BAR,
            span.status === "running" &&
              "bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--c)_34%,transparent),transparent)] bg-[length:200%_100%] motion-safe:animate-[mcpc-wf-run_1s_linear_infinite]",
            selected && "shadow-[0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)]",
          )}
          style={{ left: barLeft, width: barWidth }}
        />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute text-[10px] leading-[14px] whitespace-nowrap",
            stacked ? "top-[3px]" : "top-[7px]",
            labelMode === "inside" ? "text-foreground" : "text-fg-muted",
            labelMode === "pill" && "rounded-[2px] bg-surface px-1 leading-3 text-foreground",
            span.status === "waiting" && "text-warning-fg",
          )}
          style={{ left: labelLeft }}
        >
          {durText}
        </span>
      </div>
    </div>
  );
}
