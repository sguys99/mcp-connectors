"use client";

import { useT } from "@/lib/i18n/client";
import type { HealthStatus } from "@/lib/shell/health";
import { cn } from "@/lib/utils";

const LABEL_KEY = {
  idle: "shell.statusChecking",
  checking: "shell.statusChecking",
  healthy: "shell.statusOnline",
  offline: "shell.statusOffline",
  na: "shell.statusStdio",
} as const;

// 서버 상태 점. online 은 맥박, offline 은 붉은 테두리 광, checking 은 깜빡임, stdio 는 속 빈 원.
// 색만으로 구분하지 않도록 role="img" 와 aria-label 로 상태 이름을 함께 준다.
export function StatusDot({ status, className }: { status: HealthStatus; className?: string }) {
  const t = useT();
  return (
    <span
      role="img"
      aria-label={t(LABEL_KEY[status])}
      className={cn(
        "relative inline-block size-2 shrink-0 rounded-full",
        status === "healthy" && "bg-success-solid",
        status === "offline" && "bg-danger-solid shadow-[0_0_0_3px_color-mix(in_oklch,var(--danger-solid)_22%,transparent)]",
        (status === "checking" || status === "idle") && "mcpc-blink animate-[mcpc-blink_1s_steps(2,start)_infinite] bg-warning-solid",
        status === "na" && "border-[1.5px] border-fg-subtle bg-transparent",
        className,
      )}
    >
      {status === "healthy" && (
        <span
          aria-hidden
          className="mcpc-ping absolute inset-0 animate-[mcpc-ping_2.4s_var(--ease-standard)_infinite] rounded-full bg-success-solid"
        />
      )}
    </span>
  );
}
