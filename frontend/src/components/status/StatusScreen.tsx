// not-found 와 error 가 같이 쓰는 상태 화면 틀. 모노 코드 + 제목 + 설명 + 동작 줄.
// 서버/클라이언트 어느 쪽에서도 쓸 수 있게 훅 없이 props 만 받는다.

import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

interface StatusScreenProps {
  // 왼쪽 위 모노 코드 (예: "404", "ERROR").
  code: string;
  title: string;
  description: string;
  // 제목에 포커스를 옮길 때 쓰는 ref (에러 화면).
  headingRef?: Ref<HTMLHeadingElement>;
  // 오류 안내처럼 즉시 읽혀야 하면 true (role="alert").
  alert?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function StatusScreen({
  code,
  title,
  description,
  headingRef,
  alert = false,
  actions,
  children,
  className,
}: StatusScreenProps) {
  return (
    <div className={cn("flex min-h-full items-center justify-center p-6", className)}>
      <section
        role={alert ? "alert" : undefined}
        aria-labelledby="status-title"
        className="grid w-full max-w-md gap-4 rounded-md border border-line bg-surface-raised p-6"
      >
        <p className="font-mono text-xs tracking-wide text-fg-muted">{code}</p>
        <div className="grid gap-2">
          <h1
            id="status-title"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-base font-semibold outline-none"
          >
            {title}
          </h1>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        {children}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </section>
    </div>
  );
}
