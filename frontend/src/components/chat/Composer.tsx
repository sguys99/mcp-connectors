"use client";

// 하단에 고정된 입력창 (final.html 의 .composer). 텍스트 영역 아래에 노출 서버 칩, 단축키 힌트, 보내기/중지 버튼이 있다.
//
// * Enter 전송, Shift+Enter 줄바꿈, ⌘↵ 도 전송 (IME 조합 중 Enter 는 확정 키라서 무시). 한글 입력도 안전하다.
// * 실행 중에는 보내기 버튼이 중지 버튼으로 바뀌고 Esc 로도 멈춘다. 입력창은 계속 쓸 수 있어서 다음 질문을 미리 적어 둘 수 있다.
// * 전송, 중지 뒤에는 포커스를 입력창으로 돌려 놓는다 (키보드만으로 이어서 쓸 수 있게).

import { SendIcon, SquareIcon } from "lucide-react";
import { useState, type KeyboardEvent, type RefObject } from "react";

import { useShortcut } from "@/components/shell/shortcuts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Kbd } from "@/components/ui/kbd";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 160;

interface ComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  // 보낼 수 없는 상태 (API 키 없음, 노출된 서버 없음). 입력창이 막히고 disabledHint 가 placeholder 로 보인다.
  disabled: boolean;
  disabledHint?: string;
  // 승인을 기다리는 중에 입력창에 보일 안내 (보낼 수는 없고 Esc 로 멈출 수 있다)
  busyHint?: string;
  // 실행 중이거나 승인을 기다리는 중 (보내기가 중지 버튼으로 바뀐다)
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  // 요청에 실제로 담기는 서버들 (칩으로 보여 준다)
  servers: readonly string[];
}

export function Composer({ inputRef, disabled, disabledHint, busyHint, streaming, onSend, onStop, servers }: ComposerProps) {
  const t = useT();
  const [text, setText] = useState("");
  const canSend = !disabled && !streaming && text.trim().length > 0;

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }

  function send() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    const el = inputRef.current;
    if (el) {
      el.style.height = "";
      el.focus();
    }
  }

  function stop() {
    onStop();
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME composition (한글 조합 중) 에는 Enter 가 확정 키이므로 send 하지 않는다.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  // 입력창 밖에 포커스가 있어도 ⌘↵ 로 보내고 Esc 로 멈춘다 (입력창 안에서는 위 onKeyDown 이 먼저 처리한다).
  useShortcut("mod+enter", send, { enabled: canSend, allowInInput: true });
  useShortcut("escape", stop, { enabled: streaming, allowInInput: true });

  return (
    <div className="flex-none border-t border-line bg-surface px-5 pt-3 pb-4 max-[901px]:px-3 max-[901px]:pt-2 max-[901px]:pb-3">
      <div className="mx-auto max-w-[820px] rounded-lg border border-line-strong bg-surface-sunken transition-colors focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring">
        <label htmlFor="chat-input" className="sr-only">
          {t("chat.message")}
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={disabled ? (disabledHint ?? t("chat.chooseServer")) : (busyHint ?? t("chat.placeholder"))}
          onChange={(e) => {
            setText(e.target.value);
            resize(e.target);
          }}
          onKeyDown={onKeyDown}
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-base outline-none placeholder:text-fg-muted disabled:cursor-not-allowed"
        />
        {/* 단축키 힌트는 입력창 폭(@container)이 좁으면 숨겨 서버 칩이 읽을 수 있는 폭을 지킨다 (Trace 패널을 연 1100px 등) */}
        <div className="@container flex items-center gap-2 pt-1.5 pr-2 pb-2 pl-3">
          <ul aria-label={t("chat.exposedServers")} className="flex min-w-0 flex-1 gap-1 overflow-hidden">
            {servers.map((name) => (
              <li key={name} className="min-w-0 shrink">
                <Chip className="max-w-full">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success-solid" />
                  <span className="truncate">{name}</span>
                </Chip>
              </li>
            ))}
          </ul>

          {/* 실행 중과 대기 중의 힌트, 버튼은 같은 칸에 겹쳐 두고 쓰지 않는 쪽은 invisible 로 자리만 차지한다.
              칸의 폭이 두 상태 중 넓은 쪽으로 고정되어 실행을 시작하고 끝낼 때 서버 칩의 폭이 바뀌지 않는다. */}
          <p aria-hidden className="grid text-2xs whitespace-nowrap text-fg-muted max-[1081px]:hidden @max-[600px]:hidden [&>span]:[grid-area:1/1]">
            <span className={cn("flex items-center justify-end gap-1", !streaming && "invisible")}>
              <Kbd>Esc</Kbd> {t("chat.hintStop")}
            </span>
            <span className={cn("flex items-center justify-end gap-1", streaming && "invisible")}>
              <Kbd>Enter</Kbd> {t("chat.hintSend")}
              <span className="ml-1">
                <Kbd>Shift+Enter</Kbd> {t("chat.hintNewline")}
              </span>
            </span>
          </p>

          <div className="grid shrink-0 [&>*]:[grid-area:1/1]">
            {streaming ? (
              <Button
                type="button"
                variant="destructive"
                onClick={stop}
                aria-label={t("chat.stopAria")}
                aria-keyshortcuts="Escape"
                className="gap-1.5"
              >
                <SquareIcon aria-hidden className="size-3.5 fill-current" />
                {t("chat.stop")}
              </Button>
            ) : (
              <Button type="button" onClick={send} disabled={!canSend} aria-keyshortcuts="Control+Enter Meta+Enter" className="gap-1.5">
                <SendIcon aria-hidden />
                {t("chat.send")}
              </Button>
            )}
            {/* 다른 상태 버튼의 폭만 차지하는 자리표시 (보이지 않고 읽히지 않는다) */}
            <span aria-hidden className={cn(buttonVariants(), "invisible gap-1.5")}>
              {streaming ? <SendIcon /> : <SquareIcon className="size-3.5" />}
              {streaming ? t("chat.send") : t("chat.stop")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
