"use client";

// 호출 기록을 시나리오 YAML 로 내보내는 대화상자. 미리 보기, 복사, 내려받기를 한곳에서 한다.
// 기대값은 관찰한 응답에서 끌어낸 것이라, 검토하라는 안내와 실행 명령을 함께 보여 준다.

import { CopyIcon, DownloadIcon } from "lucide-react";
import { useMemo } from "react";

import { useCopy } from "@/components/dashboard/CopyCommand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";
import type { HistoryEntry } from "@/lib/inspector/history";
import { exportScenarioYaml, scenarioFileName } from "@/lib/inspector/scenario-export";
import { notify } from "@/lib/ui/notify";

interface ExportScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  entries: readonly HistoryEntry[];
}

export function ExportScenarioDialog({ open, onOpenChange, serverName, entries }: ExportScenarioDialogProps) {
  const t = useT();
  const copy = useCopy();
  const result = useMemo(() => (open ? exportScenarioYaml(entries, { server: serverName }) : null), [open, entries, serverName]);
  const fileName = scenarioFileName(serverName);
  const count = result?.scenario.cases.length ?? 0;

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.yaml], { type: "application/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notify.success(t("inspector.exportDownloaded", { file: fileName }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-[901px]:max-w-2xl" data-export-dialog>
        <DialogHeader>
          <DialogTitle>{t("inspector.exportTitle")}</DialogTitle>
          <DialogDescription>{t("inspector.exportDesc", { n: count, server: serverName })}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid min-w-0 gap-2">
            <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg" data-export-derived>
              {t("inspector.exportDerived")}
            </p>
            {result.skipped > 0 ? <p className="text-xs text-fg-muted">{t("inspector.exportSkipped", { n: result.skipped })}</p> : null}
            <pre
              tabIndex={0}
              aria-label={t("inspector.exportPreview")}
              className="max-h-[40vh] overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-xs leading-5 whitespace-pre text-foreground [font-variant-ligatures:none]"
              data-export-yaml
            >
              {result.yaml}
            </pre>
            <p className="text-xs text-fg-muted">
              {t("inspector.exportRun")} <code className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono">python scripts/mcp_cli.py test {fileName}</code>
            </p>
          </div>
        ) : null}
        <DialogFooter showCloseButton>
          <Button type="button" variant="outline" disabled={!result} onClick={() => result && void copy(result.yaml)} data-action="export-copy">
            <CopyIcon aria-hidden />
            {t("inspector.exportCopy")}
          </Button>
          <Button type="button" disabled={!result} onClick={download} data-action="export-download">
            <DownloadIcon aria-hidden />
            {t("inspector.exportDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
