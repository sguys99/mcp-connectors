import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// 작은 모노 칩 (메서드, 타입, 상태 표시). 시안의 .chip 에 해당한다.
// 의미 색은 역할 토큰 쌍(fg on bg)만 쓰고, 색만으로 뜻을 전하지 않도록 글자나 아이콘을 함께 넣는 것을 전제로 한다.
const TONES = {
  neutral: "border-line bg-surface-sunken text-fg-muted",
  brand: "border-brand-border bg-brand-subtle text-brand-text",
  ok: "border-success-border bg-success-bg text-success-fg",
  err: "border-danger-border bg-danger-bg text-danger-fg",
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  info: "border-info-border bg-info-bg text-info-fg",
} as const;

export type ChipTone = keyof typeof TONES;

export function Chip({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex h-[18px] max-w-full shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono text-2xs leading-none whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
