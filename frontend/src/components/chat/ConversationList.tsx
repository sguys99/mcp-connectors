"use client";

// Chat 사이드바의 대화 목록 (final.html 의 .conv-item): 새 대화, 검색, 열기, 이름 바꾸기, 내보내기, 삭제, 전체 내보내기와 가져오기.
// 저장소(IndexedDB)를 쓸 수 없으면 목록 대신 안내만 보인다 (채팅은 그대로 동작한다).
// <SidebarSlot> 안에서 쓴다 (데스크톱은 사이드바 열, 모바일은 드로어).

import { DownloadIcon, MessagesSquareIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, TriangleAlertIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCompact } from "@/lib/chat/format";
import { matchesQuery, type ConversationMeta } from "@/lib/chat/history/schema";
import type { ConversationStore } from "@/lib/chat/history/store";
import { relativeTime } from "@/lib/chat/history/time";
import type { ListStatus } from "@/lib/chat/history/useConversationList";
import { useT } from "@/lib/i18n/client";
import { notify } from "@/lib/ui/notify";
import { cn } from "@/lib/utils";

import { ExportDialog, ImportDialog, RenameDialog } from "./ConversationDialogs";

interface ConversationListProps {
  status: ListStatus;
  items: readonly ConversationMeta[];
  store: ConversationStore | null;
  activeId: string | null;
  // 지금 대화가 승인 대기 중인지 (목록의 칩이 "승인 대기"인지 "승인 만료"인지 가른다)
  activeAwaiting: boolean;
  // 실행 중이거나 승인을 기다리는 중이면 다른 대화로 바꿀 수 없다
  busy: boolean;
  // 아직 저장 전인 지금 대화 (첫 실행이 끝나야 저장된다). 있으면 목록 맨 위에 "실행 중" 또는 "저장 전" 행으로 보인다.
  draft?: { title: string; running: boolean } | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}

type DialogState =
  | { kind: "rename"; meta: ConversationMeta }
  | { kind: "export"; meta: ConversationMeta }
  | { kind: "exportAll" }
  | { kind: "import" }
  | null;

export function ConversationList({ status, items, store, activeId, activeAwaiting, busy, draft = null, onOpen, onNew, onRename, onDelete, onChanged }: ConversationListProps) {
  const t = useT();
  const headingId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [now, setNow] = useState(() => Date.now());

  // 상대 시간이 낡지 않도록 30초마다 다시 계산한다.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const trimmed = query.trim();
  const visible = useMemo(() => (trimmed ? items.filter((m) => matchesQuery(m, trimmed)) : items), [items, trimmed]);
  const unavailable = status === "unavailable";
  // 저장 전 대화 행은 검색어가 없을 때만 보인다 (검색은 저장된 대화만 찾는다).
  const showDraft = draft !== null && trimmed === "";

  const handleDelete = async (meta: ConversationMeta) => {
    const ok = await confirm({
      title: t("conversations.deleteTitle"),
      description: t("conversations.deleteBody", { title: meta.title || t("conversations.untitled") }),
      confirmLabel: t("conversations.deleteAction"),
      destructive: true,
    });
    if (!ok) return;
    await onDelete(meta.id);
    notify.success(t("conversations.deleted"));
  };

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col" data-conversation-list>
      <div className="flex h-9 flex-none items-center gap-1 pr-1.5 pl-3">
        <MessagesSquareIcon aria-hidden className="size-3 text-fg-muted" />
        <h2 id={headingId} className="flex-1 font-mono text-2xs font-medium tracking-[var(--tracking-caps)] text-fg-muted uppercase lang-ko:tracking-[0.02em]">
          {t("conversations.title")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 max-[901px]:size-9"
          aria-label={t("conversations.newChat")}
          title={t("conversations.newChat")}
          disabled={busy}
          onClick={onNew}
          data-action="new-chat"
        >
          <PlusIcon aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 max-[901px]:size-9"
                aria-label={t("conversations.moreActions")}
                title={t("conversations.moreActions")}
                data-action="conversation-more"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem disabled={unavailable || items.length === 0} onClick={() => setDialog({ kind: "exportAll" })} data-menu-action="export-all">
              <DownloadIcon aria-hidden />
              {t("conversations.exportAll")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={unavailable} onClick={() => setDialog({ kind: "import" })} data-menu-action="import">
              <UploadIcon aria-hidden />
              {t("conversations.import")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {unavailable ? (
        <div role="note" className="mx-3 mt-1 grid gap-1 rounded-md border border-warning-border bg-warning-bg p-3 text-xs text-foreground" data-conversations-unavailable>
          <b className="flex items-center gap-1.5 font-medium text-warning-fg">
            <TriangleAlertIcon aria-hidden className="size-3.5" />
            {t("conversations.unavailableTitle")}
          </b>
          <span>{t("conversations.unavailable")}</span>
        </div>
      ) : (
        <>
          {items.length > 0 || trimmed ? (
            <div className="flex-none px-3 pb-2">
              <div className="relative flex items-center">
                <SearchIcon aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-fg-muted" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                  placeholder={t("conversations.searchPlaceholder")}
                  aria-label={t("conversations.searchLabel")}
                  className="h-7 pl-7 text-xs max-[901px]:h-9"
                />
              </div>
            </div>
          ) : null}

          <p className="sr-only" role="status" aria-live="polite">
            {status === "ready" ? t("conversations.count", { n: visible.length }) : ""}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === "loading" ? (
              <p className="px-3 py-2 text-xs text-fg-muted">{t("conversations.loading")}</p>
            ) : items.length === 0 && !showDraft ? (
              <p className="mx-3 mt-1 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted" data-conversations-empty>
                {t("conversations.empty")}
              </p>
            ) : visible.length === 0 && !showDraft ? (
              <p className="mx-3 mt-1 rounded-md border border-dashed border-line-strong p-3 text-xs text-fg-muted" data-conversations-nomatch>
                {t("conversations.noMatch", { q: trimmed })}
              </p>
            ) : (
              <ul aria-label={t("conversations.list")}>
                {showDraft && draft ? <DraftRow draft={draft} /> : null}
                {visible.map((meta) => (
                  <ConversationRow
                    key={meta.id}
                    meta={meta}
                    now={now}
                    active={meta.id === activeId}
                    awaiting={meta.id === activeId && activeAwaiting}
                    switchBlocked={busy && meta.id !== activeId}
                    onOpen={onOpen}
                    onRename={() => setDialog({ kind: "rename", meta })}
                    onExport={() => setDialog({ kind: "export", meta })}
                    onDelete={() => void handleDelete(meta)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {dialog?.kind === "rename" ? (
        <RenameDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          initial={dialog.meta.title}
          onSubmit={async (title) => {
            const ok = await onRename(dialog.meta.id, title);
            if (ok) notify.success(t("conversations.renamed"));
            return ok;
          }}
        />
      ) : null}
      {dialog?.kind === "export" || dialog?.kind === "exportAll" ? (
        <ExportDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          store={store}
          target={dialog.kind === "export" ? { id: dialog.meta.id, title: dialog.meta.title } : { count: items.length }}
        />
      ) : null}
      {dialog?.kind === "import" ? (
        <ImportDialog open onOpenChange={(open) => !open && setDialog(null)} store={store} existingIds={items.map((m) => m.id)} onImported={onChanged} />
      ) : null}
      {confirmDialog}
    </section>
  );
}

// 아직 저장되지 않은 지금 대화. 열 대상이 없어 버튼이 아닌 행이며, 실행이 끝나 저장되면 일반 행으로 바뀐다.
function DraftRow({ draft }: { draft: { title: string; running: boolean } }) {
  const t = useT();
  return (
    <li
      aria-current="true"
      data-conversation-draft
      className="grid min-w-0 gap-0.5 bg-sel-row py-[7px] pr-3 pl-3 shadow-[inset_2px_0_0_var(--brand)] max-[901px]:py-2.5"
    >
      <span className="truncate text-xs font-medium text-foreground">{draft.title || t("conversations.untitled")}</span>
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-2xs whitespace-nowrap text-fg-muted">
        <Chip tone={draft.running ? "brand" : "neutral"} className="h-4 flex-none">
          {draft.running ? t("conversations.draftRunning") : t("conversations.draftUnsaved")}
        </Chip>
        <span className="min-w-0 truncate">{t("conversations.draftHint")}</span>
      </span>
    </li>
  );
}

function ConversationRow({
  meta,
  now,
  active,
  awaiting,
  switchBlocked,
  onOpen,
  onRename,
  onExport,
  onDelete,
}: {
  meta: ConversationMeta;
  now: number;
  active: boolean;
  awaiting: boolean;
  switchBlocked: boolean;
  onOpen: (id: string) => void;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const title = meta.title || t("conversations.untitled");
  const menuLabel = t("conversations.rowMenu", { title });
  return (
    <li className="flex items-stretch" data-conversation-id={meta.id}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        disabled={switchBlocked}
        title={switchBlocked ? t("conversations.busyHint") : undefined}
        onClick={() => onOpen(meta.id)}
        className={cn(
          "grid min-w-0 flex-1 gap-0.5 py-[7px] pr-1 pl-3 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent max-[901px]:py-2.5",
          active && "bg-sel-row shadow-[inset_2px_0_0_var(--brand)]",
        )}
      >
        <span className="truncate text-xs font-medium text-foreground" data-conversation-title>
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-2xs whitespace-nowrap text-fg-muted">
          <span className="flex-none">{relativeTime(meta.updatedAt, now, t.locale)}</span>
          <span className="sr-only">{t("conversations.messages", { n: meta.messageCount })}</span>
          <span className="min-w-0 flex-[0_1_auto] truncate">{meta.model}</span>
          {meta.pending ? (
            <Chip tone="warn" className="h-4 flex-none">
              {awaiting ? t("conversations.pendingLive") : t("conversations.pendingExpired")}
            </Chip>
          ) : meta.truncated ? (
            <Chip className="h-4 flex-none">{t("conversations.trimmed")}</Chip>
          ) : meta.tokens > 0 ? (
            <span className="flex-none tabular-nums">{t("conversations.tokens", { n: formatCompact(meta.tokens) })}</span>
          ) : null}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="icon" aria-label={menuLabel} title={menuLabel} className="mr-1 size-[30px] flex-none self-center max-[901px]:size-10" data-conversation-menu />}
        >
          <MoreHorizontalIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onRename} data-menu-action="rename">
            <PencilIcon aria-hidden />
            {t("conversations.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExport} data-menu-action="export">
            <DownloadIcon aria-hidden />
            {t("conversations.exportOne")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete} data-menu-action="delete">
            <Trash2Icon aria-hidden />
            {t("conversations.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
