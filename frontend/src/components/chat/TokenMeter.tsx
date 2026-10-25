"use client";

// Chat 툴바의 토큰 미터 (final.html 의 .tok): 입력, 출력, 컨텍스트 미터, 세션 합계.
//
// 값은 모두 LLM 제공자가 응답에 담아 보낸 usage 실측값의 합이다. 추정이나 비용 환산은 하지 않는다.
//   * 일부 요청만 사용량을 알려 줬다면 합계 옆에 "일부" 칩을 붙인다.
//   * 하나도 알려 주지 않았다면 "토큰 미보고"로 표시한다 (0으로 보이지 않게).
//   * 미터는 마지막 요청의 입력 + 출력이 모델 컨텍스트 창에서 차지한 비율이다. 창 크기를 모르는 모델(OpenRouter 자유 입력 등)은 막대를 그리지 않는다.
// 좁은 화면(900px 이하)에서는 미터 막대를 숨기고 숫자만 보인다. 툴바 안의 남는 폭(@container)이 좁으면
// 세션 합계(260px 미만), 컨텍스트 막대(180px 미만), 입력과 출력(110px 미만) 순서로 숨기고 마지막에는 대화 합계 하나
// ("29k tok")만 남겨 글자가 잘리지 않게 한다.

import { Chip } from "@/components/ui/chip";
import { formatCompact, formatCount } from "@/lib/chat/format";
import { useT } from "@/lib/i18n/client";
import type { TokenUsage, UsageTotal } from "@/lib/llm/usage";

interface TokenMeterProps {
  conversation: UsageTotal;
  // 이 페이지를 연 뒤 지운 대화까지 합친 값
  session: TokenUsage | null;
  // 가장 최근에 보고된 LLM 호출의 사용량
  latest: TokenUsage | null;
  // 모델 컨텍스트 창 크기. 모르면 null
  windowSize: number | null;
}

export function TokenMeter({ conversation, session, latest, windowSize }: TokenMeterProps) {
  const t = useT();
  const usage = conversation.usage;
  const partial = usage !== null && conversation.reported < conversation.total;
  const notReported = usage === null && conversation.total > 0;

  const used = latest ? latest.input + latest.output : 0;
  const percent = windowSize && latest ? Math.min(100, Math.max(2, (used / windowSize) * 100)) : null;
  const contextText =
    latest && windowSize
      ? t("chat.tokContext", { used: formatCount(used), window: formatCount(windowSize) })
      : latest
        ? t("chat.tokContextNoWindow", { used: formatCount(used) })
        : "";
  const cacheText =
    usage && ((usage.cacheRead ?? 0) > 0 || (usage.cacheWrite ?? 0) > 0)
      ? t("chat.tokCache", { read: formatCount(usage.cacheRead ?? 0), write: formatCount(usage.cacheWrite ?? 0) })
      : undefined;

  return (
    <div
      role="group"
      aria-label={t("chat.tokensLabel")}
      data-testid="token-meter"
      className="flex items-center gap-2 font-mono text-2xs whitespace-nowrap text-fg-muted tabular-nums max-[901px]:w-full max-[901px]:justify-end max-[901px]:gap-1.5"
    >
      {notReported ? (
        <span title={t("chat.tokNoneTitle")}>{t("chat.tokNone")}</span>
      ) : (
        <>
          <span title={cacheText} className="@max-[110px]:hidden">
            {t("chat.tokIn")} <b className="font-normal text-foreground" data-testid="tokens-in">{formatCount(usage?.input ?? 0)}</b>
          </span>
          <span title={cacheText} className="@max-[110px]:hidden">
            {t("chat.tokOut")} <b className="font-normal text-foreground" data-testid="tokens-out">{formatCount(usage?.output ?? 0)}</b>
          </span>
          <span className="hidden @max-[110px]:inline">
            <b className="font-normal text-foreground">{formatCompact((usage?.input ?? 0) + (usage?.output ?? 0))}</b> {t("chat.tokShort")}
          </span>
          {percent !== null ? (
            <span
              role="img"
              aria-label={contextText}
              title={contextText}
              className="h-1 w-14 flex-none overflow-hidden rounded-[2px] bg-surface-hover max-[901px]:hidden @max-[180px]:hidden"
            >
              <i className="block h-full bg-chart-1" style={{ width: `${percent.toFixed(1)}%` }} />
            </span>
          ) : null}
          {partial ? (
            <Chip tone="warn" title={t("chat.tokPartialTitle", { reported: conversation.reported, total: conversation.total })}>
              {t("chat.tokPartial")}
            </Chip>
          ) : null}
        </>
      )}
      {session ? (
        <span title={t("chat.tokSessionTitle")} className="max-[480px]:hidden @max-[260px]:hidden">
          {t("chat.tokSession")} <b className="font-normal text-foreground" data-testid="tokens-session">{formatCompact(session.input + session.output)}</b>
        </span>
      ) : null}
    </div>
  );
}
