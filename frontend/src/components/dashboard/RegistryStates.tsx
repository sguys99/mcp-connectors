"use client";

import { AlertTriangleIcon, FileTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useT } from "@/lib/i18n/client";

const REGISTRY_FILE = "configs/mcp_servers.yaml";

const EXAMPLE = `servers:
  - name: my-server
    transport: streamable_http
    url: http://localhost:8001/mcp
    description: "What this server does"`;

function FileName() {
  return <code className="font-mono text-foreground">{REGISTRY_FILE}</code>;
}

// 등록된 서버가 하나도 없을 때. 레지스트리 파일을 어떻게 채우는지 보여 준다.
export function RegistryEmpty({ onReload }: { onReload: () => void }) {
  const t = useT();
  return (
    <Empty className="border border-dashed border-line-strong">
      <EmptyHeader className="max-w-lg">
        <EmptyMedia variant="icon">
          <FileTextIcon />
        </EmptyMedia>
        <EmptyTitle>{t("dashboard.emptyTitle")}</EmptyTitle>
        <EmptyDescription>{t.rich("dashboard.emptyDescription", { file: <FileName /> })}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg">
        <figure className="grid w-full gap-1 text-left">
          <figcaption className="font-mono text-2xs text-fg-muted">{t("dashboard.emptyExample")}</figcaption>
          <pre
            tabIndex={0}
            className="overflow-x-auto rounded-sm border border-line bg-surface-sunken p-3 font-mono text-xs leading-[18px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
          >
            {EXAMPLE}
          </pre>
        </figure>
        <Button type="button" variant="outline" className="rounded-md" onClick={onReload}>
          {t("dashboard.reload")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// 레지스트리 파일을 읽지 못했을 때. 서버가 돌려준 실제 오류 메시지를 함께 보여 준다.
export function RegistryError({ message, onReload }: { message: string; onReload: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="grid gap-3 rounded-md border border-danger-border bg-danger-bg p-4">
      <div className="flex items-center gap-2 text-danger-fg">
        <AlertTriangleIcon aria-hidden className="size-4 flex-none" />
        <h2 className="text-sm font-semibold">{t("dashboard.errorTitle")}</h2>
      </div>
      <p className="text-xs leading-[18px]">{t.rich("dashboard.errorDescription", { file: <FileName /> })}</p>
      <pre
        tabIndex={0}
        className="overflow-x-auto rounded-sm border border-line bg-surface-sunken p-3 font-mono text-2xs leading-4 whitespace-pre-wrap text-fg-muted outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
      >
        {message}
      </pre>
      <div>
        <Button type="button" variant="outline" className="rounded-md" onClick={onReload}>
          {t("dashboard.reload")}
        </Button>
      </div>
    </div>
  );
}
