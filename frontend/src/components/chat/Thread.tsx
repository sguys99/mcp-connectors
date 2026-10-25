"use client";

// 대화 스레드: 스크롤되는 메시지 목록. 하단 Composer 는 이 컴포넌트 밖(ChatShell)에 고정돼 있다.
//
// * 새 내용이 생기면(스트리밍, 도구 결과, 카드 펼침) 맨 아래로 따라간다. 사용자가 위로 스크롤하면 멈추고
//   "최신으로 이동" 버튼을 보여 준다. 새 질문을 보내면 다시 맨 아래에 붙는다.
// * 접근성: role="log" 이지만 스트리밍 글자마다 읽지 않도록 aria-live 는 끄고, 진행 상태는 ChatShell 의
//   별도 status 영역이 알린다. 스크롤 영역이라 키보드로 포커스를 받을 수 있다.

import { ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { AssistantTurn, ChatTurn } from "@/lib/chat/serialize";
import type { TurnTrace } from "@/lib/chat/trace";
import { useT } from "@/lib/i18n/client";

import { MessageCard, type LinkProps } from "./MessageCard";

// 맨 아래에서 이만큼(px) 안쪽이면 "맨 아래"로 본다.
const BOTTOM_SLACK = 48;

interface ThreadProps extends LinkProps {
  turns: readonly ChatTurn[];
  streamingTurn: AssistantTurn | null;
  streamingModel: string | null;
  traces: ReadonlyMap<string, TurnTrace>;
  // 대화가 비었을 때 보일 안내와 질문 제안
  empty: ReactNode;
  // 새 질문을 보낼 때마다 바뀌는 값. 바뀌면 맨 아래로 붙는다.
  stickSignal: number;
}

export function Thread({ turns, streamingTurn, streamingModel, traces, empty, stickSignal, ...link }: ThreadProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  // 직전에 본 scrollHeight. 내용이 줄어서(승인 패널이 접히는 등) 브라우저가 scrollTop 을 줄인 것을 사용자의 위로 스크롤과 구분한다.
  const lastHeightRef = useRef(0);
  // 사용자가 위로 스크롤하려는 입력(휠, 터치, 위쪽 키, 안쪽 포커스 이동)을 했는지. 위치 변화만으로는 구분할 수 없다:
  // 내용이 한 프레임 안에서 줄었다가 다시 늘면(스트리밍 카드가 최종 카드로 바뀔 때 등) 브라우저가 scrollTop 을 줄여 두고,
  // 스크롤 이벤트는 높이가 돌아온 뒤에 도착해 "높이는 그대로인데 위로 올라간" 것처럼 보인다.
  const upIntentRef = useRef(false);
  // 포인터를 누르고 있는 동안(스크롤바 끌기, 글자 선택 끌기)의 스크롤도 사용자 스크롤이다.
  const pointerHeldRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // 내용 높이가 바뀔 때마다(글자가 늘거나 카드가 펼쳐질 때) 붙어 있으면 따라간다.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
      const el = scrollRef.current;
      if (el) {
        lastHeightRef.current = el.scrollHeight;
        lastTopRef.current = el.scrollTop;
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    stickRef.current = true;
    scrollToBottom();
  }, [stickSignal, scrollToBottom]);

  useEffect(() => {
    const release = () => {
      pointerHeldRef.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  // 붙어 있다가 떨어지는 것은 "사용자가 위로 스크롤했을 때"뿐이다. 내용이 한꺼번에 길어져서 맨 아래에서 멀어진 것이나
  // 레이아웃 때문에 브라우저가 scrollTop 을 줄인 것은 사용자의 스크롤이 아니므로 (스크롤 이벤트가 늦게 도착해도) 붙어 있는 상태를
  // 유지하고, 다음 ResizeObserver 호출이나 이어지는 스크롤이 다시 맨 아래로 내린다.
  function markUpIntent() {
    upIntentRef.current = true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || (event.key === " " && event.shiftKey)) {
      markUpIntent();
    }
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    const shrunk = el.scrollHeight < lastHeightRef.current;
    const scrolledUp = !shrunk && el.scrollTop < lastTopRef.current - 1;
    lastTopRef.current = el.scrollTop;
    lastHeightRef.current = el.scrollHeight;
    if (near) {
      stickRef.current = true;
      upIntentRef.current = false;
    } else if (scrolledUp && (upIntentRef.current || pointerHeldRef.current)) {
      stickRef.current = false;
    } else if (stickRef.current) {
      // 사용자 입력 없이 맨 아래에서 밀려났다. 붙어 있는 상태이므로 바로 되돌린다.
      scrollToBottom();
    }
    setAtBottom(stickRef.current);
  }

  const isEmpty = turns.length === 0 && streamingTurn === null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 도구 카드(h3)가 제목 수준을 건너뛰지 않도록 대화 영역의 h2 를 둔다 (모바일에는 사이드바 h2 가 없다) */}
      <h2 className="sr-only">{t("chat.threadLabel")}</h2>
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label={t("chat.threadLabel")}
        tabIndex={0}
        onScroll={onScroll}
        onWheel={(event) => {
          if (event.deltaY < 0) markUpIntent();
        }}
        onTouchMove={markUpIntent}
        onKeyDown={onKeyDown}
        // Tab 이나 스크린 리더로 앞쪽 버튼에 포커스가 가면 브라우저가 그 위치로 스크롤한다. 이것도 사용자의 이동이다.
        onFocus={(event) => {
          if (event.target !== event.currentTarget) markUpIntent();
        }}
        onPointerDown={() => {
          pointerHeldRef.current = true;
        }}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
      >
        <div ref={innerRef} className="mx-auto grid max-w-[820px] grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-5 pb-6 max-[901px]:gap-4 max-[901px]:px-3 max-[901px]:py-4">
          {isEmpty ? (
            empty
          ) : (
            <>
              {/* 승인 대기 중인 턴이 이어서 실행되며 turns 에서 streamingTurn 으로 옮겨 가도 같은 요소로 남도록 한 목록에 같은 key 로 그린다
                  (다시 만들어지면 높이가 줄었다 늘면서 스크롤 따라가기가 풀린다). */}
              {(streamingTurn ? [...turns, streamingTurn] : turns).map((turn) =>
                streamingTurn && turn.id === streamingTurn.id ? (
                  <MessageCard
                    key={turn.id}
                    turn={streamingTurn}
                    streaming
                    trace={traces.get(turn.id)}
                    model={streamingModel ?? undefined}
                    {...link}
                  />
                ) : (
                  <MessageCard key={turn.id} turn={turn} trace={traces.get(turn.id)} {...link} />
                ),
              )}
            </>
          )}
        </div>
      </div>

      {!atBottom && !isEmpty ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            stickRef.current = true;
            scrollToBottom();
          }}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 gap-1 bg-surface shadow-md"
        >
          <ArrowDownIcon aria-hidden />
          {t("chat.jumpLatest")}
        </Button>
      ) : null}
    </div>
  );
}
