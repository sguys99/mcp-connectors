"use client";

// 왼쪽 목록 패널: 탭(Tools / Resources / Prompts와 개수), 필터 입력(/ 단축키), 일치 강조, 결과 없음, 오프라인 캐시 안내.
// 서버가 선언하지 않은 기능은 빈 상태로 안내한다. 목록은 listbox 로, 방향키로 항목을 옮기고 Enter/Space 로 고른다 (roving tabindex).
// 도구, 리소스, 프롬프트는 모두 PaneItem 으로 맞춰 같은 목록 컴포넌트가 그린다.

import { AlertTriangleIcon, BracesIcon, FileIcon, ImageIcon, InfoIcon, MessageSquareIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { ToolListSkeleton } from "@/components/skeletons/screens";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale, useT } from "@/lib/i18n/client";
import type { PaneItem, PrimitiveKind } from "@/lib/inspector/primitives";
import { cn } from "@/lib/utils";

interface PrimitivePaneProps {
  tab: PrimitiveKind;
  onTab: (tab: PrimitiveKind) => void;
  // 탭에 붙는 개수 (아직 모르면 null)
  counts: Record<PrimitiveKind, number | null>;
  // 현재 탭의 기능을 서버가 선언했는지. false 면 목록 대신 안내를 보여 준다.
  declared: boolean;
  items: PaneItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  // 서버가 꺼져 있어 마지막 목록을 보여 주는 중이면 저장 시각(ms)
  cachedAt: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  filterRef: RefObject<HTMLInputElement | null>;
}

const TAB_KEYS = {
  tools: { tab: "inspector.tabTools", pane: "inspector.paneTools", filter: "inspector.filterTools" },
  resources: { tab: "inspector.tabResources", pane: "inspector.paneResources", filter: "inspector.filterResources" },
  prompts: { tab: "inspector.tabPrompts", pane: "inspector.panePrompts", filter: "inspector.filterPrompts" },
} as const;

const EMPTY_KEYS = {
  tools: { title: "inspector.noTools", hint: "inspector.noToolsHint" },
  resources: { title: "inspector.noResources", hint: "inspector.noResourcesHint" },
  prompts: { title: "inspector.noPrompts", hint: "inspector.noPromptsHint" },
} as const;

const ITEM_ICON = { image: ImageIcon, file: FileIcon, template: BracesIcon, message: MessageSquareIcon } as const;

export function PrimitivePane({
  tab,
  onTab,
  counts,
  declared,
  items,
  loading,
  error,
  onRetry,
  cachedAt,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  filterRef,
}: PrimitivePaneProps) {
  const t = useT();
  const locale = useLocale();
  const query = filter.trim();
  const visible = useMemo(() => {
    if (!items) return [];
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((item) => `${item.title} ${item.sub}`.toLowerCase().includes(q));
  }, [items, query]);

  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeName, setActiveName] = useState<string | null>(null);
  const tabbable =
    (activeName && visible.some((x) => x.id === activeName) ? activeName : null) ??
    (selectedId && visible.some((x) => x.id === selectedId) ? selectedId : null) ??
    visible[0]?.id ??
    null;

  function focusOption(name: string | undefined) {
    if (!name) return;
    setActiveName(name);
    optionRefs.current.get(name)?.focus();
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    // ⌘↵(실행) 같은 전역 단축키는 목록이 가로채지 않는다. preventDefault 하면 전역 핸들러가 건너뛴다.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        return focusOption(visible[Math.min(index + 1, visible.length - 1)]?.id);
      case "ArrowUp":
        event.preventDefault();
        // 첫 항목에서 위로 가면 필터 입력으로 돌아간다.
        if (index === 0) return filterRef.current?.focus();
        return focusOption(visible[index - 1]?.id);
      case "Home":
        event.preventDefault();
        return focusOption(visible[0]?.id);
      case "End":
        event.preventDefault();
        return focusOption(visible[visible.length - 1]?.id);
      case "Enter":
      case " ":
        event.preventDefault();
        return onSelect(visible[index]!.id);
    }
  }

  const keys = TAB_KEYS[tab];

  return (
    <section aria-label={t(keys.pane)} data-shortcut-scope="tool-list" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 flex-none items-stretch border-b border-line px-3">
        <Tabs value={tab} onValueChange={(v) => onTab(v as PrimitiveKind)} className="h-full min-w-0">
          {/* 좁은 목록(최소 200px, 한국어)에서도 세 탭이 다 보이도록 간격을 줄인다 (시안 QA 3-5) */}
          <TabsList variant="line" aria-label={t("inspector.primitivesLabel")} className="h-full gap-2 p-0">
            {(["tools", "resources", "prompts"] as const).map((kind) => (
              <TabsTrigger key={kind} value={kind} data-primitive={kind} className="min-w-6 flex-none gap-1 px-0.5 font-mono text-2xs">
                {t(TAB_KEYS[kind].tab)}
                <span className="rounded-sm bg-surface-hover px-[3px] text-fg-muted tabular-nums">{counts[kind] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-none border-b border-line px-3 py-2">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            ref={filterRef}
            type="search"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && visible.length > 0) {
                e.preventDefault();
                focusOption(tabbable ?? visible[0]?.id);
              } else if (e.key === "Escape" && filter) {
                // 입력이 비어 있지 않으면 지우기만 하고, 전역 Esc(실행 취소)로 번지지 않게 한다.
                e.preventDefault();
                e.stopPropagation();
                onFilterChange("");
              }
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder={t(keys.filter)}
            aria-label={t(keys.filter)}
            className="text-xs"
          />
          <InputGroupAddon align="inline-end" className="max-[901px]:hidden">
            <Kbd aria-hidden>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </div>

      {cachedAt !== null ? (
        <div className="flex-none px-3 pt-2">
          <Alert className="border-warning-border bg-warning-bg text-warning-fg">
            <AlertTriangleIcon aria-hidden />
            <AlertTitle>{t("inspector.cachedNote", { time: formatHourMinute(cachedAt, locale) })}</AlertTitle>
            <AlertDescription className="text-warning-fg">{t("inspector.cachedHint")}</AlertDescription>
            <div className="col-start-2 mt-1">
              <Button type="button" variant="outline" size="xs" onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!declared && !loading && !error ? (
          <Empty className="py-8" data-empty="not-declared">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InfoIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t("inspector.capNone")}</EmptyTitle>
              <EmptyDescription>{t("inspector.capNoneHint", { cap: tab })}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : loading ? (
          <ToolListSkeleton label={t(tab === "tools" ? "inspector.loadingTools" : "inspector.loadingList")} className="px-3 pt-2" />
        ) : error && !items ? (
          <div className="px-3 pt-2">
            <Alert className="border-danger-border bg-danger-bg text-danger-fg">
              <AlertTriangleIcon aria-hidden />
              <AlertTitle>{t(tab === "tools" ? "inspector.loadFailed" : "inspector.listFailed")}</AlertTitle>
              <AlertDescription className="line-clamp-4 text-danger-fg break-words" title={error}>
                {error}
              </AlertDescription>
              <div className="col-start-2 mt-1">
                <Button type="button" variant="outline" size="xs" onClick={onRetry}>
                  {t("common.retry")}
                </Button>
              </div>
            </Alert>
          </div>
        ) : !items || items.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t(EMPTY_KEYS[tab].title)}</EmptyTitle>
              <EmptyDescription>{t(EMPTY_KEYS[tab].hint)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle className="break-all">{t("inspector.noMatch", { q: query })}</EmptyTitle>
              <EmptyDescription>{t("inspector.noMatchHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div role="listbox" aria-label={t(keys.pane)} className="py-1">
            {visible.map((item, index) => {
              const selected = item.id === selectedId;
              const Icon = item.icon ? ITEM_ICON[item.icon] : null;
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    if (el) optionRefs.current.set(item.id, el);
                    else optionRefs.current.delete(item.id);
                  }}
                  role="option"
                  aria-selected={selected}
                  tabIndex={tabbable === item.id ? 0 : -1}
                  data-tool={tab === "tools" ? item.id : undefined}
                  data-item={item.id}
                  onClick={() => onSelect(item.id)}
                  onFocus={() => setActiveName(item.id)}
                  onKeyDown={(e) => onOptionKeyDown(e, index)}
                  className={cn(
                    "grid cursor-pointer gap-px px-3 py-[7px] outline-hidden transition-colors",
                    "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring",
                    selected && "bg-sel-row shadow-[inset_2px_0_0_var(--brand)]",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {Icon ? <Icon aria-hidden className="size-3.5 flex-none text-fg-muted" /> : null}
                    <b className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                      <Highlight text={item.title} query={query} />
                    </b>
                    {item.chips?.map((chip) => (
                      <Chip key={chip.label} tone={chip.tone}>
                        {chip.label}
                      </Chip>
                    ))}
                  </span>
                  {item.sub ? (
                    <span className={cn("line-clamp-2 text-2xs leading-4 text-fg-muted", item.mono && "font-mono [overflow-wrap:anywhere]")}>
                      <Highlight text={item.sub} query={query} />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// "14:06" 형태의 시각 (캐시 저장 시각 안내용). 브라우저 시간대를 따른다.
function formatHourMinute(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

// 검색어와 일치하는 부분을 모두 <mark> 로 감싼다 (대소문자 무시).
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (let at = lower.indexOf(q, from); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(<Fragment key={key++}>{text.slice(from, at)}</Fragment>);
    parts.push(
      <mark key={key++} className="rounded-[2px] bg-[color-mix(in_oklch,var(--brand)_24%,transparent)] text-inherit">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
  }
  if (from < text.length) parts.push(<Fragment key={key++}>{text.slice(from)}</Fragment>);
  return <>{parts}</>;
}
