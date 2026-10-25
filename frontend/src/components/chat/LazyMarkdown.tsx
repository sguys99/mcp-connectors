"use client";

// ChatMarkdown 을 처음 필요할 때 불러온다. react-markdown + remark-gfm + micromark 계열이 gzip 약 60KB 라서
// 답변이나 Markdown 응답이 화면에 나오기 전(Chat 첫 화면, Inspector 첫 화면)에는 번들에 싣지 않는다.
// 불러오는 동안은 같은 글자를 그대로 보여 줘서 화면이 비어 보이거나 크게 흔들리지 않게 한다.

import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";

const Impl = lazy(() => import("./Markdown").then((m) => ({ default: m.ChatMarkdown })));

export function ChatMarkdown({ text, className, untrusted = false }: { text: string; className?: string; untrusted?: boolean }) {
  return (
    <Suspense fallback={<div className={cn("min-w-0 text-base whitespace-pre-wrap [overflow-wrap:anywhere]", className)}>{text}</div>}>
      <Impl text={text} className={className} untrusted={untrusted} />
    </Suspense>
  );
}
