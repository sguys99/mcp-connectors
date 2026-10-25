"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { notify } from "@/lib/ui/notify";

// 클립보드에 복사하고 토스트로 알린다. 권한이 막히면 오류 토스트를 띄운다.
export function useCopy() {
  const t = useT();
  return async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      notify.success(t("toast.copied"));
      return true;
    } catch {
      notify.error(t("toast.copyFailed"));
      return false;
    }
  };
}

// 복사 직후 1.5초 동안 체크 아이콘으로 바꿔 보여 주는 아이콘 버튼.
export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={async () => {
        if (!(await copy(text))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon className="text-success-fg" /> : <CopyIcon />}
    </Button>
  );
}

// "$ 명령" 한 줄과 복사 버튼. 명령이 길면 코드 영역만 가로로 스크롤된다.
export function CommandLine({ command, label }: { command: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border border-line bg-surface-sunken py-1 pr-1 pl-2 font-mono text-xs mono-exact">
      <code
        tabIndex={0}
        className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-foreground outline-hidden [scrollbar-width:none] before:text-fg-muted before:content-['$_'] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
      >
        {command}
      </code>
      <CopyIconButton text={command} label={label} />
    </div>
  );
}
