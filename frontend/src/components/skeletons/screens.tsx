// 화면별 loading skeleton. app/<route>/loading.tsx 와, 데이터가 오기 전 화면 안 로딩 표시가 같이 쓴다.
// 모양은 Phase 4 이후 A 셸 안의 화면 골격(지표 띠 + 서버 표, 3분할 Inspector, 스레드 + 입력창, 설정 섹션)을 따른다.

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  SkeletonHeading,
  SkeletonLine,
  SkeletonPanel,
  SkeletonRegion,
} from "./primitives";

interface ScreenSkeletonProps {
  label: string;
  className?: string;
  // 화면 제목. 주면 스크린 리더용 h1 을 함께 그려 로딩 중에도 문서 구조가 유지된다.
  title?: string;
}

function SrTitle({ title }: { title?: string }) {
  return title ? <h1 className="sr-only">{title}</h1> : null;
}

export function DashboardSkeleton({
  label,
  className,
  title,
}: ScreenSkeletonProps) {
  return (
    <>
      <SrTitle title={title} />
      <SkeletonRegion
        label={label}
        className={cn(
          "grid max-w-[1320px] content-start gap-5 px-6 pt-5 pb-8 max-[901px]:gap-4 max-[901px]:px-3 max-[901px]:pt-4 max-[901px]:pb-6",
          className,
        )}
      >
        <SkeletonHeading />
        {/* 시작하기 패널: 머리글 줄 + 4단계 */}
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex h-[38px] items-center gap-3 border-b border-line bg-background px-3">
            <Skeleton className="size-5" />
            <Skeleton className="h-2.5 w-28" />
            <Skeleton className="h-1.5 w-[66px]" />
          </div>
          <div className="grid grid-cols-1 min-[901px]:grid-cols-2 min-[1281px]:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex gap-2.5 border-line py-3 pr-4 pl-3 max-[901px]:not-first:border-t min-[901px]:not-first:border-l"
              >
                <Skeleton className="size-[22px] flex-none" />
                <div className="grid flex-1 content-start gap-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-7 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* 지표 띠: 4칸 (1080px 이하 2x2) */}
        <div className="grid grid-cols-4 rounded-md border border-line bg-background max-[1081px]:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "grid gap-2 border-line px-4 py-3",
                i === 1 && "border-l",
                i === 2 && "min-[1081px]:border-l max-[1081px]:border-t",
                i === 3 && "border-l max-[1081px]:border-t",
              )}
            >
              <Skeleton className="h-2 w-20" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-2 w-32" />
            </div>
          ))}
        </div>
        {/* 서버 표 */}
        <div className="overflow-hidden rounded-md border border-line">
          <div className="flex h-8 items-center gap-6 bg-background px-4 max-[901px]:hidden">
            {["w-16", "w-14", "w-16", "w-8", "w-20"].map((w, i) => (
              <Skeleton key={i} className={cn("h-2", w)} />
            ))}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex h-[58px] items-center gap-6 border-t border-line px-4 max-[901px]:h-[112px]"
            >
              <Skeleton className="h-2.5 w-16" />
              <div className="grid gap-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2.5 w-44 max-[901px]:w-24" />
              </div>
              <Skeleton className="ml-auto hidden h-3 w-24 min-[901px]:block" />
              <Skeleton className="h-7 w-[120px] max-[901px]:ml-auto" />
            </div>
          ))}
        </div>
        {/* 최근 점검 로그 */}
        <div className="grid gap-2">
          <Skeleton className="h-3 w-32" />
          <div className="grid gap-2 rounded-md border border-line bg-surface-sunken p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-2.5 w-full max-w-[420px]" />
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </>
  );
}

// Inspector 도구 목록 항목들 (화면 안 로딩 표시로도 쓴다). 이름 줄 + 두 줄 설명 모양.
export function ToolListSkeleton({
  label,
  rows = 5,
  className,
}: ScreenSkeletonProps & { rows?: number }) {
  return (
    <SkeletonRegion label={label} className={cn("grid gap-1", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-1.5 py-[7px]">
          <Skeleton className={cn("h-2.5", i % 2 === 0 ? "w-28" : "w-20")} />
          <Skeleton className="h-2 w-full max-w-56" />
          <Skeleton className="h-2 w-2/3 max-w-40" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

// 응답/뷰어 자리: 블록 머리 줄 + JSON 줄 모양 (내용 블록 한 개).
export function ResponseSkeleton({ label, className }: ScreenSkeletonProps) {
  return (
    <SkeletonRegion
      label={label}
      className={cn("overflow-hidden rounded-md border border-line", className)}
    >
      <div className="flex h-7 items-center gap-2 border-b border-line bg-background px-3">
        <Skeleton className="h-2 w-16" />
        <Skeleton className="h-3.5 w-9" />
        <Skeleton className="ml-auto h-2 w-10" />
      </div>
      <div className="grid gap-2 p-3">
        <SkeletonLine className="w-1/3" />
        <SkeletonLine className="ml-4 w-2/3" />
        <SkeletonLine className="ml-4 w-1/2" />
        <SkeletonLine className="ml-4 w-3/5" />
        <SkeletonLine className="w-1/6" />
      </div>
    </SkeletonRegion>
  );
}

// Inspector 화면 골격: 도구 목록(--c1) | 요청 | 응답 3분할. 900px 이하는 세그먼트 탭 + 요청 패널 하나.
export function InspectorSkeleton({
  label,
  className,
  title,
}: ScreenSkeletonProps) {
  return (
    <>
      <SrTitle title={title} />
      <SkeletonRegion
        label={label}
        className={cn(
          "grid h-full min-h-0 grid-cols-[var(--c1)_minmax(0,var(--rq))_minmax(0,var(--rs))] gap-px bg-line",
          "max-[901px]:grid-cols-[minmax(0,1fr)] max-[901px]:grid-rows-[auto_minmax(0,1fr)]",
          className,
        )}
      >
        {/* 모바일 세그먼트 탭 */}
        <div className="hidden bg-background px-3 py-2 max-[901px]:block">
          <Skeleton className="h-9 w-full" />
        </div>
        {/* 도구 목록: 머리 탭 + 필터 + 항목 */}
        <div className="flex min-h-0 flex-col bg-surface max-[901px]:hidden">
          <div className="flex h-9 items-center gap-2 border-b border-line px-3">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-3.5 w-5" />
          </div>
          <div className="border-b border-line px-3 py-2">
            <Skeleton className="h-8 w-full" />
          </div>
          <ToolListSkeleton label={label} className="px-3 pt-1" rows={6} />
        </div>
        {/* 요청: 머리 + 필드 + 실행 바 */}
        <div className="flex min-h-0 flex-col bg-surface">
          <div className="grid gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-[18px] w-16" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-7 w-24" />
            </div>
            <Skeleton className="h-2.5 w-3/4" />
          </div>
          <div className="grid flex-1 content-start gap-4 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="grid gap-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className={i === 0 ? "h-28 w-full" : "h-8 w-full"} />
              </div>
            ))}
          </div>
          <div className="flex h-12 items-center gap-2 border-t border-line bg-background px-4">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        {/* 응답: 탭 + 상태 줄 + 블록 */}
        <div className="flex min-h-0 flex-col bg-surface max-[901px]:hidden">
          <div className="flex h-9 items-center gap-3 border-b border-line px-3">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-2.5 w-14" />
          </div>
          <div className="grid gap-3 p-4">
            <ResponseSkeleton label={label} />
          </div>
        </div>
      </SkeletonRegion>
    </>
  );
}

export function ChatSkeleton({ label, className, title }: ScreenSkeletonProps) {
  return (
    <>
      <SrTitle title={title} />
      <SkeletonRegion
        label={label}
        className={cn("grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]", className)}
      >
        {/* 툴바: 모델 선택과 지우기 */}
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="ml-auto h-6 w-20" />
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--trace-w)] max-[901px]:grid-cols-[minmax(0,1fr)]">
          {/* 대화 열: 메시지와 하단 Composer */}
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="grid min-h-0 flex-1 content-start gap-5 overflow-hidden p-5 max-[901px]:p-3">
              <div className="grid max-w-md gap-2">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="grid max-w-xl gap-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
            <div className="shrink-0 border-t border-line p-3">
              <Skeleton className="h-[88px] w-full" />
            </div>
          </div>
          {/* Trace 열 */}
          <div className="grid content-start gap-2 border-l border-line bg-surface-sunken p-3 max-[901px]:hidden">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-40" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </>
  );
}

export function SettingsSkeleton({
  label,
  className,
  title,
}: ScreenSkeletonProps) {
  return (
    <>
      <SrTitle title={title} />
      <SkeletonRegion
        label={label}
        className={cn("mx-auto grid w-full max-w-[920px] content-start gap-4 p-4 min-[901px]:p-6", className)}
      >
        <SkeletonHeading />
        <div className="grid gap-4 min-[901px]:grid-cols-[160px_minmax(0,1fr)] min-[901px]:gap-8">
          {/* 섹션 목록: 데스크톱은 세로 목록, 모바일은 가로 칩 줄 */}
          <div className="flex gap-2 min-[901px]:flex-col">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-6 w-20 flex-none min-[901px]:w-full" />
            ))}
          </div>
          <div className="grid min-w-0 content-start gap-4">
            {[3, 3, 2, 2].map((rows, i) => (
              <SkeletonPanel key={i} className="gap-0">
                {Array.from({ length: rows }, (_, j) => (
                  <div key={j} className="grid gap-2 py-1">
                    <Skeleton className="h-2.5 w-28" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </SkeletonPanel>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </>
  );
}
