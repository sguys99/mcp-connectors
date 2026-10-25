"use client";

// 전역 에러 바운더리. 레이아웃 아래(셸 <main> 안)에서 잡힌 오류를 보여 준다.
//   * 제목으로 포커스를 옮겨 스크린 리더가 바로 읽게 하고, 컨테이너는 role="alert".
//   * 스택은 노출하지 않는다. 운영에서는 digest(서버 로그 대조용 ID)만, 개발에서는 message 도 보여 준다.

import Link from "next/link";
import { useEffect, useRef } from "react";

import { StatusScreen } from "@/components/status/StatusScreen";
import { Button, buttonVariants } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface ErrorPageProps {
  error: unknown;
  retry: () => void;
}

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  const t = useT();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Error 가 아닌 값이 던져질 수도 있어 좁혀서 읽는다.
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  const devMessage =
    process.env.NODE_ENV !== "production" && error instanceof Error ? error.message : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <StatusScreen
      alert
      code="ERROR"
      title={t("status.errorTitle")}
      description={t("status.errorDescription")}
      headingRef={headingRef}
      actions={
        <>
          <Button onClick={() => retry()}>{t("status.retry")}</Button>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("status.home")}
          </Link>
        </>
      }
    >
      {digest || devMessage ? (
        <dl className="grid gap-1 border-t border-line pt-3 text-xs text-fg-muted">
          {digest ? (
            <div className="flex gap-2">
              <dt>{t("status.errorId")}</dt>
              <dd className="font-mono break-all text-foreground">{digest}</dd>
            </div>
          ) : null}
          {devMessage ? (
            <div className="grid gap-1">
              <dt>{t("status.errorDetail")}</dt>
              <dd className="font-mono break-words text-foreground">{devMessage}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </StatusScreen>
  );
}
