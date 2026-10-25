import { buildSparkline } from "@/lib/dashboard/latency";
import type { Sample } from "@/lib/shell/health-history";
import { cn } from "@/lib/utils";

interface SparklineProps {
  samples: readonly Sample[];
  label: string;
  // 모든 행이 함께 쓰는 세로 눈금 최댓값(ms). lib/dashboard/latency.ts 의 sharedSparkScale.
  scaleMs: number;
  className?: string;
}

// 최근 점검 지연 스파크라인. 모든 행이 같은 0 ~ scaleMs 눈금이다 (도형은 lib/dashboard/latency.ts).
// 색은 --chart-1 (브랜드), 실패 구간은 danger 점선이라 색만으로 구분하지 않는다 (선 모양이 다르다).
// 선 두께는 화면 폭에 따라 SVG 가 줄어도 같게 보이도록 non-scaling-stroke 로 고정한다.
export function Sparkline({ samples, label, scaleMs, className }: SparklineProps) {
  const g = buildSparkline(samples, undefined, scaleMs);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width={g.width}
      height={g.height}
      className={cn("block h-auto flex-none overflow-visible", className)}
    >
      <path
        d={`M0,${g.gridMidY}H${g.width}M0,${g.gridBaseY}H${g.width}`}
        fill="none"
        stroke="var(--line)"
        strokeWidth={1}
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
      {g.area && <path d={g.area} fill="color-mix(in oklch, var(--chart-1) 14%, transparent)" stroke="none" />}
      {g.line && (
        <path
          d={g.line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {g.gap && (
        <path
          d={g.gap}
          fill="none"
          stroke="var(--danger-border)"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {g.dots.map((d) => (
        <circle key={`${d.x}`} cx={d.x} cy={d.y} r={1.5} fill="var(--chart-1)" />
      ))}
      {g.end &&
        (g.end.offline ? (
          <circle
            cx={g.end.x}
            cy={g.end.y}
            r={2.5}
            fill="var(--surface)"
            stroke="var(--danger-solid)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <circle
            cx={g.end.x}
            cy={g.end.y}
            r={2.75}
            fill="var(--chart-1)"
            stroke="var(--surface)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}
