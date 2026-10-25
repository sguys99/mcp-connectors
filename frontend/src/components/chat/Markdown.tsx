"use client";

// 어시스턴트 답변의 Markdown. 타이포그래피 플러그인(prose) 대신 요소별로 토큰 클래스를 직접 입혀서
// 라이트와 다크, 한국어에서도 앱의 다른 화면과 같은 색과 간격을 쓴다 (final.html 의 .md).

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

// 넓은 표는 이 상자 안에서만 가로로 스크롤한다. 키보드로도 스크롤할 수 있게 포커스를 받고(axe scrollable-region-focusable),
// 이름 있는 region 이라 스크린 리더가 "표, 옆으로 스크롤" 을 알린다. 가려진 쪽 가장자리에는 그림자가 생겨
// (mcpc-scroll-shadow, 스크롤바가 숨는 macOS 에서도) 더 볼 내용이 있다는 것을 보여 준다.
function MdTable({ children }: { children?: React.ReactNode }) {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t("chat.tableRegion")}
      tabIndex={0}
      data-md-table
      className="mcpc-scroll-shadow max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-line"
    >
      <table className="w-full min-w-[320px] text-sm">{children}</table>
    </div>
  );
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="max-w-[70ch] [overflow-wrap:anywhere]">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-text underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="grid list-disc gap-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="grid list-decimal gap-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="[overflow-wrap:anywhere]">{children}</li>,
  // 대화 영역의 제목 수준은 사이드바와 Trace 의 h2 아래라서 모두 h3 로 맞춘다 (수준을 건너뛰지 않도록). 크기만 다르다.
  h1: ({ children }) => <h3 className="mt-1 text-base font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-1 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-1 text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => <h3 className="mt-1 text-sm font-semibold">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="grid gap-1 border-l-2 border-line-strong pl-3 text-fg-muted">{children}</blockquote>
  ),
  hr: () => <hr className="border-line" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  // 블록 코드는 pre 가 감싸고, 인라인 코드만 칩처럼 보인다.
  code: ({ className, children }) => {
    const block = (className ?? "").includes("language-");
    return block ? (
      <code className={cn("font-mono text-xs", className)}>{children}</code>
    ) : (
      <code className="rounded-xs border border-line bg-surface-sunken px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      tabIndex={0}
      className="max-h-80 overflow-auto rounded-sm border border-line bg-surface-sunken p-2 font-mono text-xs leading-5 whitespace-pre text-foreground [font-variant-ligatures:none]"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => <MdTable>{children}</MdTable>,
  th: ({ children }) => (
    <th className="border-b border-line bg-background px-3 py-1.5 text-left align-bottom font-mono text-2xs font-medium whitespace-nowrap text-fg-muted">
      {children}
    </th>
  ),
  // 본문 칸은 단어 단위로 줄바꿈해 대부분의 표가 대화 폭 안에 들어오게 한다. 긴 칸만 48ch 에서 접고,
  // 짧은 칸(식별자, 숫자)은 단어를 쪼개지 않아 표가 넓으면 가로 스크롤로 넘긴다.
  td: ({ children }) => (
    <td className="max-w-[48ch] border-b border-line px-3 py-1.5 text-left align-top [overflow-wrap:break-word] [tr:last-child_&]:border-b-0">
      {children}
    </td>
  ),
};

// 서버가 준 문서처럼 신뢰할 수 없는 Markdown 용. 원격 이미지를 불러오지 않고 대체 텍스트만 보여 준다 (추적, 유출 방지).
// 제목은 문서 구조(h1, h2)를 건드리지 않도록 굵은 글씨의 일반 블록으로 그린다 (제목 수준 건너뜀 방지).
const heading = ({ children }: { children?: React.ReactNode }) => <p className="mt-1 text-sm font-semibold">{children}</p>;
const NO_IMAGE_COMPONENTS: Components = {
  ...COMPONENTS,
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  img: ({ alt }) => <span className="font-mono text-xs text-fg-muted">[image{alt ? `: ${alt}` : ""}]</span>,
};

export function ChatMarkdown({ text, className, untrusted = false }: { text: string; className?: string; untrusted?: boolean }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 text-base", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={untrusted ? NO_IMAGE_COMPONENTS : COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
