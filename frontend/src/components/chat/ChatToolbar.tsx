"use client";

// Chat 상단 툴바 (final.html 의 .chat-bar): 모델 선택, OpenRouter 모델 ID 입력, 최대 반복, 승인 모드(자동/수동), 토큰 미터, 대화 지우기.
//
// * 모델, 최대 반복, 승인 모드는 이 대화(페이지)에만 적용되는 값이다. 설정 화면의 값은 시작값일 뿐이고 여기서 바꿔도 설정에 저장되지 않는다.
//   값을 바꾸면 다음 메시지(승인 뒤 이어서 실행하는 요청 포함)부터 적용된다.
// * 모바일(900px 이하)에서는 모델 선택과 지우기가 한 줄, OpenRouter 입력이 두 번째 줄이다. 미터 막대는 숨기고 숫자만 보인다.

import { HandIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { TokenMeter } from "@/components/chat/TokenMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n/client";
import type { ApprovalMode } from "@/lib/chat/useChatStream";
import { clampIterations, MAX_ITERATIONS, MIN_ITERATIONS } from "@/lib/llm/constants";
import { choiceValue, modelOptions, parseChoice, PROVIDER_LABELS, type LLMProvider } from "@/lib/llm/models";
import type { TokenUsage, UsageTotal } from "@/lib/llm/usage";
import { cn } from "@/lib/utils";

interface ChatToolbarProps {
  provider: LLMProvider;
  anthropicModel: string;
  openaiModel: string;
  openrouterModel: string;
  // 제공자나 모델을 바꾼다 (이 대화에만 적용, 설정에는 저장하지 않는다)
  onModelChange: (patch: { provider: LLMProvider; model?: string }) => void;
  maxIterations: number;
  onMaxIterationsChange: (value: number) => void;
  approval: ApprovalMode;
  onApprovalChange: (mode: ApprovalMode) => void;
  // 토큰 미터: 대화 합계, 세션 합계, 마지막 요청, 컨텍스트 창 크기
  conversationUsage: UsageTotal;
  sessionUsage: TokenUsage | null;
  latestUsage: TokenUsage | null;
  contextWindow: number | null;
  onClear: () => void;
  clearDisabled: boolean;
}

export function ChatToolbar({
  provider,
  anthropicModel,
  openaiModel,
  openrouterModel,
  onModelChange,
  maxIterations,
  onMaxIterationsChange,
  approval,
  onApprovalChange,
  conversationUsage,
  sessionUsage,
  latestUsage,
  contextWindow,
  onClear,
  clearDisabled,
}: ChatToolbarProps) {
  const t = useT();
  const anthropic = modelOptions("anthropic", anthropicModel);
  const openai = modelOptions("openai", openaiModel);
  const current = choiceValue(provider, provider === "anthropic" ? anthropicModel : openaiModel);
  const items = [
    ...anthropic.map((m) => ({ value: choiceValue("anthropic", m), label: m })),
    ...openai.map((m) => ({ value: choiceValue("openai", m), label: m })),
    { value: "openrouter", label: PROVIDER_LABELS.openrouter },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-background px-3 py-1.5 max-[901px]:py-2">
      <div className="flex min-w-0 items-center gap-1.5 max-[901px]:order-0 max-[901px]:flex-[1_1_170px]">
        <span id="chat-model-label" className="font-mono text-2xs whitespace-nowrap text-fg-muted max-[901px]:sr-only">
          {t("chat.model")}
        </span>
        <Select
          value={current}
          items={items}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            const choice = parseChoice(value);
            if (!choice) return;
            onModelChange({ provider: choice.provider, ...(choice.model ? { model: choice.model } : {}) });
          }}
        >
          <SelectTrigger
            size="sm"
            aria-labelledby="chat-model-label"
            title={t("chat.modelPicker")}
            className="min-w-0 border-line-strong font-mono text-xs max-[901px]:h-8 max-[901px]:flex-1"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{PROVIDER_LABELS.anthropic}</SelectLabel>
              {anthropic.map((m) => (
                <SelectItem key={m} value={choiceValue("anthropic", m)}>
                  <span className="font-mono text-xs">{m}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{PROVIDER_LABELS.openai}</SelectLabel>
              {openai.map((m) => (
                <SelectItem key={m} value={choiceValue("openai", m)}>
                  <span className="font-mono text-xs">{m}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{PROVIDER_LABELS.openrouter}</SelectLabel>
              <SelectItem value="openrouter">
                <span className="font-mono text-xs">{PROVIDER_LABELS.openrouter}</span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {provider === "openrouter" ? (
        <OpenRouterModelInput key={openrouterModel} value={openrouterModel} onCommit={(model) => onModelChange({ provider: "openrouter", model })} />
      ) : null}

      {/* 데스크톱 순서: 모델 | 최대 반복 | 승인 ... 토큰 미터, 지우기. 모바일(시안): 첫 줄 모델과 승인, 둘째 줄 최대 반복과 토큰 미터와 지우기 */}
      <span aria-hidden className="h-[18px] w-px bg-line max-[901px]:hidden" />
      <MaxIterationsInput value={maxIterations} onCommit={onMaxIterationsChange} />
      <span aria-hidden className="h-[18px] w-px bg-line max-[901px]:hidden" />
      <ApprovalToggle value={approval} onChange={onApprovalChange} />

      {/* 미터 칸은 flex-basis 0 이라 줄바꿈 계산에 자리를 요구하지 않고 남는 폭만 채운다. 첫 실행 뒤 세션 합계와 막대가
          나타나도 지우기 버튼이 다음 줄로 밀리지 않는다 (폭이 모자라면 미터가 컨테이너 쿼리로 덜 중요한 칸부터 숨긴다). */}
      <div className="@container ml-auto flex min-w-[76px] flex-[1_1_0] items-center justify-end max-[901px]:order-3 max-[901px]:ml-0 max-[901px]:flex-1">
        <TokenMeter conversation={conversationUsage} session={sessionUsage} latest={latestUsage} windowSize={contextWindow} />
      </div>
      <ClearButton onClear={onClear} disabled={clearDisabled} />
    </div>
  );
}

function ClearButton({ onClear, disabled }: { onClear: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={disabled}
        aria-label={t("chat.clear")}
        className="shrink-0 gap-1.5 text-fg-muted max-[901px]:order-4 max-[901px]:size-8 max-[901px]:px-0"
      >
        <Trash2Icon aria-hidden />
        <span className="max-[901px]:sr-only">{t("chat.clear")}</span>
      </Button>
  );
}

// 최대 반복 입력. 입력 중에는 범위 안의 정수일 때만 바로 반영하고, 포커스를 잃거나 Enter 를 누르면 범위로 맞춘다
// (비우거나 숫자가 아니면 이전 값으로 되돌린다). 서버도 같은 범위를 검사한다.
function MaxIterationsInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  // 바깥에서 값이 바뀌면(설정을 고치고 돌아온 경우 등) 입력칸도 맞춘다.
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  const id = useId();

  function commit() {
    const parsed = draft.trim() === "" ? null : clampIterations(Number(draft));
    if (parsed === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <div className="flex items-center gap-1.5 max-[901px]:order-2 max-[901px]:flex-none">
      <label htmlFor={id} className="font-mono text-2xs whitespace-nowrap text-fg-muted" title={t("chat.maxIterationsTitle", { min: MIN_ITERATIONS, max: MAX_ITERATIONS })}>
        <span className="max-[560px]:hidden">{t("chat.maxIterations")}</span>
        <span className="hidden max-[560px]:inline">{t("chat.maxIterationsShort")}</span>
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN_ITERATIONS}
        max={MAX_ITERATIONS}
        step={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          // 스피너나 키보드 화살표로 범위 안의 정수가 되면 바로 반영한다.
          if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS && n !== value) onCommit(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
        }}
        title={t("chat.maxIterationsTitle", { min: MIN_ITERATIONS, max: MAX_ITERATIONS })}
        className="h-7 w-[60px] px-1 text-center font-mono text-xs max-[901px]:h-8"
      />
    </div>
  );
}

// 승인 방식 세그먼트 (라디오 그룹): 자동 / 수동. 화살표 키로 옮기며 고른다 (한 번에 하나만 Tab 정지).
function ApprovalToggle({ value, onChange }: { value: ApprovalMode; onChange: (mode: ApprovalMode) => void }) {
  const t = useT();
  const labelId = useId();
  const refs = useRef<Partial<Record<ApprovalMode, HTMLButtonElement | null>>>({});
  const options: { mode: ApprovalMode; label: string; title: string; Icon: typeof ZapIcon }[] = [
    { mode: "auto", label: t("chat.approvalAuto"), title: t("chat.approvalAutoTitle"), Icon: ZapIcon },
    { mode: "manual", label: t("chat.approvalManual"), title: t("chat.approvalManualTitle"), Icon: HandIcon },
  ];

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = options[(index + step + options.length) % options.length]!;
    onChange(next.mode);
    refs.current[next.mode]?.focus();
  }

  return (
    <div className="flex items-center gap-1.5 max-[901px]:order-1">
      <span id={labelId} className="font-mono text-2xs whitespace-nowrap text-fg-muted max-[560px]:sr-only">
        {t("chat.approval")}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-flex overflow-hidden rounded-md border border-line-strong">
        {options.map(({ mode, label, title, Icon }, index) => {
          const checked = value === mode;
          return (
            <button
              key={mode}
              ref={(el) => {
                refs.current[mode] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={title}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "inline-flex h-7 items-center gap-1 px-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset max-[901px]:h-8",
                checked ? "bg-brand-subtle font-medium text-brand-text" : "text-fg-muted hover:bg-surface-hover hover:text-foreground",
                mode === "manual" && "border-l border-line-strong",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 입력 중에는 저장하지 않고 Enter 나 포커스를 잃을 때 저장한다 (빈 값은 이전 값으로 되돌린다).
function OpenRouterModelInput({ value, onCommit }: { value: string; onCommit: (model: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);

  function commit() {
    const next = draft.trim();
    if (next.length === 0) setDraft(value);
    else if (next !== value) onCommit(next);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
      }}
      spellCheck={false}
      autoComplete="off"
      aria-label={t("chat.openrouterModel")}
      className="h-7 w-[220px] font-mono text-xs max-[901px]:order-last max-[901px]:h-8 max-[901px]:w-full"
    />
  );
}
