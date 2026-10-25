import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Chip, type ChipTone } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  id: string;
  title: string;
  icon: LucideIcon;
  // 이 섹션의 값이 어떻게 반영되는지와 지금 상태 (저장 시 적용, 저장 안 한 변경, 바로 적용).
  mode: { label: string; tone: ChipTone };
  children: ReactNode;
  className?: string;
}

// 설정 섹션 패널 (Dashboard 시작하기 패널과 같은 문법: 1px 선, 4px 라운드, mono 머리글).
// id 는 섹션 내비게이션의 앵커이고, 제목 id 는 `${id}-title` 이다.
export function SettingsSection({ id, title, icon: Icon, mode, children, className }: SettingsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-14 overflow-hidden rounded-md border border-line bg-surface min-[901px]:scroll-mt-6"
    >
      <div className="flex min-h-[38px] items-center gap-3 border-b border-line bg-background py-1 pr-3 pl-3 shadow-[inset_2px_0_0_var(--brand)]">
        <span aria-hidden className="grid size-5 flex-none place-items-center rounded-xs bg-brand-subtle text-brand-text">
          <Icon className="size-3.5" />
        </span>
        <h2
          id={`${id}-title`}
          className="min-w-0 flex-1 truncate font-mono text-2xs font-semibold tracking-[var(--tracking-caps)] uppercase lang-ko:tracking-[0.02em]"
        >
          {title}
        </h2>
        <Chip tone={mode.tone} data-section-state={mode.tone === "warn" ? "dirty" : undefined}>
          {mode.label}
        </Chip>
      </div>
      <div className={cn("grid gap-5 p-4", className)}>{children}</div>
    </section>
  );
}

// 한 줄 설정 행: 왼쪽에 제목과 설명, 오른쪽에 컨트롤. 좁으면 세로로 쌓인다.
export function SettingRow({
  label,
  labelId,
  help,
  children,
}: {
  label: string;
  labelId: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-[1_1_220px]">
        <div id={labelId} className="text-sm font-medium">
          {label}
        </div>
        {help ? <p className="mt-0.5 text-xs text-fg-muted">{help}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs border border-line bg-surface-sunken px-1 py-px font-mono text-[0.92em] break-words text-foreground">
      {children}
    </code>
  );
}
