// 로딩 skeleton 공용 조각. 모든 화면 skeleton 과 컴포넌트 안 로딩 표시가 이걸 쓴다.
// 스타일: A 시안 언어(1px 선, 4px 라운드). 색은 skeleton.tsx 의 surface-hover 를 따른다.

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SkeletonRegionProps {
  // 스크린 리더에 읽힐 문구 (보통 t("common.loading")).
  label: string;
  className?: string;
  children: ReactNode;
}

// 로딩 영역 래퍼. 시각 요소는 숨기고 label 한 줄만 읽히게 한다.
export function SkeletonRegion({ label, className, children }: SkeletonRegionProps) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

// 한 줄 막대. w 는 Tailwind 폭 클래스.
export function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={cn("h-2.5 w-full", className)} />;
}

// 화면 상단 제목 줄(모노 제목 + 보조 줄).
export function SkeletonHeading({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-2.5 w-72 max-w-full" />
    </div>
  );
}

// 1px 선 패널. 헤더 막대(모노 제목 자리)를 포함할 수 있다.
export function SkeletonPanel({
  header = true,
  className,
  children,
}: {
  header?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col border border-line rounded-md bg-surface", className)}>
      {header ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          <Skeleton className="h-2.5 w-20" />
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 content-start gap-2 p-3">{children}</div>
    </div>
  );
}
