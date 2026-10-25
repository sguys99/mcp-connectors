"use client";

// 루트 레이아웃 자체가 실패했을 때의 마지막 방어선. 레이아웃과 globals.css 가 없는 상태라
// 자체 <html>/<body> 와 인라인 스타일만 쓰고, 쿠키 사전도 쓸 수 없어 영어 고정이다.
// 색은 OS 색상 모드(prefers-color-scheme)를 따른다.

import { useEffect, useRef } from "react";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | MCP Connectors</title>
        <style>{`
          :root { color-scheme: light dark; --bg: #f8fbfb; --fg: #1a2224; --muted: #515d60; --line: #d3dcde; --brand: #006b75; --on-brand: #fff; }
          @media (prefers-color-scheme: dark) { :root { --bg: #11181a; --fg: #e6eced; --muted: #9ba7aa; --line: #2d3a3d; --brand: #5cc5cf; --on-brand: #04181b; } }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
          main { width: min(28rem, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 4px; padding: 24px; display: grid; gap: 12px; }
          h1 { margin: 0; font: 600 16px/1.3 ui-monospace, monospace; outline: none; }
          p { margin: 0; color: var(--muted); }
          code { font-family: ui-monospace, monospace; color: var(--fg); word-break: break-all; }
          button { justify-self: start; font: inherit; font-weight: 500; padding: 6px 12px; border: 0; border-radius: 4px; background: var(--brand); color: var(--on-brand); cursor: pointer; }
          button:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
        `}</style>
      </head>
      <body>
        <main role="alert" aria-labelledby="ge-title">
          <h1 id="ge-title" ref={headingRef} tabIndex={-1}>
            Something went wrong
          </h1>
          <p>The app could not load. Try again; if it keeps failing, restart the frontend server.</p>
          {digest ? (
            <p>
              Error ID: <code>{digest}</code>
            </p>
          ) : null}
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
