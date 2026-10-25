"use client";

// 대화 목록의 대화상자 셋: 이름 바꾸기, 내보내기(Markdown/JSON), 가져오기(JSON).
// 가져오기는 파일을 읽어 검증만 하고(미리 보기), 사용자가 확인하면 저장한다. 파일의 어떤 내용도 실행하지 않는다.

import { DownloadIcon, FileUpIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CONVERSATIONS,
  assignImportIds,
  conversationToMarkdown,
  exportFileName,
  exportJson,
  parseImport,
  EXPORT_VERSION,
  type ImportFailure,
  type ImportPreview,
  type MarkdownLabels,
} from "@/lib/chat/history/export";
import { MAX_TITLE_CHARS } from "@/lib/chat/history/schema";
import type { ConversationStore } from "@/lib/chat/history/store";
import { formatBytes } from "@/lib/chat/history/time";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n";
import { downloadText } from "@/lib/ui/download";
import { notify } from "@/lib/ui/notify";

export function markdownLabels(t: Translator): MarkdownLabels {
  return {
    exported: t("conversations.mdExported"),
    model: t("conversations.mdModel"),
    servers: t("conversations.mdServers"),
    runtimeServers: t("conversations.mdRuntimeServers"),
    approval: t("conversations.mdApproval"),
    approvalAuto: t("conversations.mdApprovalAuto"),
    approvalManual: t("conversations.mdApprovalManual"),
    tokens: t("conversations.mdTokens"),
    tokensInOut: (input, output) => t("conversations.mdTokensInOut", { in: input, out: output }),
    tokensNone: t("conversations.mdTokensNone"),
    user: t("conversations.mdUser"),
    assistant: t("conversations.mdAssistant"),
    toolCall: t("conversations.mdToolCall"),
    arguments: t("conversations.mdArguments"),
    result: t("conversations.mdResult"),
    error: t("conversations.mdError"),
    status: {
      done: t("conversations.mdStatusDone"),
      error: t("conversations.mdStatusError"),
      denied: t("conversations.mdStatusDenied"),
      cancelled: t("conversations.mdStatusCancelled"),
    },
    stopped: t("conversations.mdStopped"),
    stoppedMax: t("conversations.mdStoppedMax"),
    expired: t("conversations.mdExpired"),
    untitled: t("conversations.untitled"),
    truncated: t("conversations.mdTruncated"),
  };
}

// ----- 이름 바꾸기 ----- //

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: string;
  onSubmit: (title: string) => Promise<boolean>;
}

export function RenameDialog({ open, onOpenChange, initial, onSubmit }: RenameDialogProps) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = value.replace(/\s+/g, " ").trim();

  const submit = async () => {
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    const ok = await onSubmit(trimmed.slice(0, MAX_TITLE_CHARS));
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-rename-dialog>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("conversations.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>{t("conversations.renameLabel")}</Label>
            <Input id={id} value={value} maxLength={MAX_TITLE_CHARS} autoComplete="off" autoFocus onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={trimmed.length === 0 || busy}>
              {t("conversations.renameAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----- 내보내기 ----- //

type ExportTarget = { id: string; title: string } | { count: number };

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: ConversationStore | null;
  target: ExportTarget;
}

export function ExportDialog({ open, onOpenChange, store, target }: ExportDialogProps) {
  const t = useT();
  const single = "id" in target;
  const [format, setFormat] = useState<"md" | "json">(single ? "md" : "json");
  const [busy, setBusy] = useState(false);
  const label = single ? target.title || t("conversations.untitled") : "mcp-connectors-conversations";
  const fileName = exportFileName(label, format);

  const download = async () => {
    if (!store || busy) return;
    setBusy(true);
    try {
      if (single) {
        const record = await store.get(target.id);
        if (!record) throw new Error("missing");
        if (format === "md") downloadText(fileName, conversationToMarkdown(record, markdownLabels(t)), "text/markdown");
        else downloadText(fileName, exportJson([record]), "application/json");
      } else {
        const { records } = await store.getAll();
        if (records.length === 0) throw new Error("empty");
        downloadText(fileName, exportJson(records), "application/json");
      }
      notify.success(t("conversations.exported", { name: fileName }));
      onOpenChange(false);
    } catch {
      notify.error(t("conversations.exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-export-dialog>
        <DialogHeader>
          <DialogTitle>{single ? t("conversations.exportTitle") : t("conversations.exportAllTitle")}</DialogTitle>
          <DialogDescription>
            {single ? t("conversations.exportDescOne", { title: label }) : t("conversations.exportDescAll", { n: target.count })}
          </DialogDescription>
        </DialogHeader>

        {single ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium">{t("conversations.formatLabel")}</legend>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v === "json" ? "json" : "md")} aria-label={t("conversations.formatLabel")}>
              <FormatOption value="md" title={t("conversations.formatMarkdown")} help={t("conversations.formatMarkdownHelp")} />
              <FormatOption value="json" title={t("conversations.formatJson")} help={t("conversations.formatJsonHelp")} />
            </RadioGroup>
          </fieldset>
        ) : null}

        <p className="text-xs text-fg-muted">
          {t("conversations.fileName")}: <code className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-foreground" data-export-filename>{fileName}</code>
        </p>
        <p className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-fg-muted">{t("conversations.redactNote")}</p>

        <DialogFooter showCloseButton>
          <Button type="button" onClick={() => void download()} disabled={!store || busy} data-action="conversation-download">
            <DownloadIcon aria-hidden />
            {t("conversations.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatOption({ value, title, help }: { value: string; title: string; help: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line p-2.5 has-[[data-checked]]:border-brand-border has-[[data-checked]]:bg-brand-subtle">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-fg-muted">{help}</span>
      </span>
    </label>
  );
}

// ----- 가져오기 ----- //

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: ConversationStore | null;
  existingIds: readonly string[];
  onImported: () => Promise<void>;
}

export function ImportDialog({ open, onOpenChange, store, existingIds, onImported }: ImportDialogProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportPreview | ImportFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_IMPORT_BYTES) {
      setResult({ ok: false, code: "tooLarge" });
      return;
    }
    setResult(parseImport(await file.text()));
  };

  const run = async () => {
    if (!store || !result?.ok || busy) return;
    setBusy(true);
    const records = assignImportIds(result.valid, new Set(existingIds));
    const { saved, failed } = await store.putMany(records);
    await onImported();
    setBusy(false);
    if (failed > 0) notify.warning(t("conversations.importPartial", { n: saved, failed }));
    else notify.success(t("conversations.imported", { n: saved }));
    if (saved > 0) onOpenChange(false);
  };

  const failure = result && !result.ok ? importErrorText(t, result) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-import-dialog>
        <DialogHeader>
          <DialogTitle>{t("conversations.importTitle")}</DialogTitle>
          <DialogDescription>{t("conversations.importDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-import-input
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} data-action="import-choose">
            <FileUpIcon aria-hidden />
            {t("conversations.chooseFile")}
          </Button>
          <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{fileName ?? t("conversations.noFile")}</span>
        </div>

        <div role="status" aria-live="polite" className="grid gap-1.5 text-xs" data-import-result>
          {failure ? (
            <p className="flex items-start gap-1.5 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-danger-fg">
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 flex-none" />
              <span>{failure}</span>
            </p>
          ) : null}
          {result?.ok ? (
            <>
              <p className="text-foreground">{t("conversations.importReady", { n: result.valid.length })}</p>
              {result.invalid > 0 ? (
                <p className="text-warning-fg">
                  {t("conversations.importSkipped", { n: result.invalid })}
                  {result.firstIssue ? ` ${t("conversations.importFirstIssue", { issue: result.firstIssue })}` : ""}
                </p>
              ) : null}
              <p className="text-fg-muted">{t("conversations.importNote")}</p>
            </>
          ) : null}
        </div>

        <DialogFooter showCloseButton>
          <Button type="button" disabled={!store || !result?.ok || result.valid.length === 0 || busy} onClick={() => void run()} data-action="import-run">
            {t("conversations.importAction", { n: result?.ok ? result.valid.length : 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function importErrorText(t: Translator, failure: ImportFailure): string {
  switch (failure.code) {
    case "tooLarge":
      return t("conversations.errTooLarge", { size: formatBytes(MAX_IMPORT_BYTES) });
    case "invalidJson":
      return t("conversations.errInvalidJson");
    case "notExport":
      return t("conversations.errNotExport");
    case "unsupportedVersion":
      return t("conversations.errUnsupportedVersion", { version: String(failure.version ?? "?"), supported: EXPORT_VERSION });
    case "empty":
      return t("conversations.errEmpty");
    case "tooMany":
      return t("conversations.errTooMany", { max: MAX_IMPORT_CONVERSATIONS });
  }
}
