"use client";

// "클라이언트 설정 복사" 대화상자 (Phase 5, P5-5). 선택한 서버의 설정을 Claude Desktop, Cursor, VS Code, Claude Code 형식으로 보여 준다.
// 형식 생성은 lib/client-config 의 순수 함수가 하고, 이 컴포넌트는 탭, 붙여 넣을 위치 안내, 복사 버튼만 맡는다.
// 비밀은 담지 않는다: API Key 헤더는 환경 변수 참조 (자리표시자) 로만 나간다.

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useCopy } from "@/components/dashboard/CopyCommand";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLIENT_IDS,
  buildClientConfig,
  fromRegistryServer,
  fromRuntime,
  type ClientId,
  type ConfigBlock,
  type ConfigServer,
} from "@/lib/client-config";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n";
import { markGettingStarted } from "@/lib/onboarding/getting-started";
import { findRuntimeServer } from "@/lib/runtime/store";

const TAB_LABEL: Record<ClientId, TKey> = {
  "claude-desktop": "clientConfig.claudeDesktop",
  cursor: "clientConfig.cursor",
  vscode: "clientConfig.vscode",
  "claude-code": "clientConfig.claudeCode",
};

const BLOCK_HINT: Record<ConfigBlock["id"], TKey> = {
  "desktop-file": "clientConfig.hintDesktop",
  "cursor-file": "clientConfig.hintCursor",
  "vscode-file": "clientConfig.hintVscode",
  cli: "clientConfig.hintCli",
  "mcp-json": "clientConfig.hintMcpJson",
};

export function ClientConfigDialog() {
  const { configTarget, closeClientConfig } = useShell();
  const t = useT();
  return (
    <Dialog open={configTarget !== null} onOpenChange={(open) => !open && closeClientConfig()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto min-[901px]:max-w-2xl" data-dialog="client-config">
        <DialogHeader>
          <DialogTitle>{t("clientConfig.title", { name: configTarget ?? "" })}</DialogTitle>
          <DialogDescription>{t("clientConfig.description")}</DialogDescription>
        </DialogHeader>
        {configTarget ? <ConfigBody name={configTarget} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfigBody({ name }: { name: string }) {
  const t = useT();
  const { servers } = useShell();
  const server = servers.find((s) => s.name === name);
  const [includeKey, setIncludeKey] = useState(true);
  const [client, setClient] = useState<ClientId>("claude-desktop");
  const keyId = useId();

  const isRuntime = server?.transport === "streamable_http" && Boolean(server.runtime);
  const config: ConfigServer | null = useMemo(() => {
    if (!server) return null;
    if (isRuntime) {
      const def = findRuntimeServer(name);
      return def ? fromRuntime(def) : null;
    }
    return server.transport === "stdio"
      ? fromRegistryServer(server, includeKey)
      : fromRegistryServer({ name: server.name, transport: "streamable_http", externalUrl: server.externalUrl }, includeKey);
  }, [server, isRuntime, name, includeKey]);

  if (!config) {
    return <p className="text-sm text-fg-muted">{t("clientConfig.unavailable")}</p>;
  }

  const showKeyToggle = !isRuntime && config.kind === "http";

  return (
    <div className="grid gap-3 min-w-0">
      {showKeyToggle ? (
        <label htmlFor={keyId} className="flex items-start gap-2 text-xs leading-4">
          <Checkbox id={keyId} checked={includeKey} onCheckedChange={(v) => setIncludeKey(v === true)} className="mt-px" />
          <span>
            {t.rich("clientConfig.includeKey", { header: <code className="font-mono">X-MCP-API-Key</code> })}
          </span>
        </label>
      ) : null}

      <Tabs value={client} onValueChange={(v) => setClient(v as ClientId)} className="min-w-0">
        <TabsList aria-label={t("clientConfig.clients")} className="h-auto w-full flex-wrap justify-start">
          {CLIENT_IDS.map((id) => (
            <TabsTrigger key={id} value={id} className="px-2.5 text-xs" data-client-tab={id}>
              {t(TAB_LABEL[id])}
            </TabsTrigger>
          ))}
        </TabsList>
        {CLIENT_IDS.map((id) => (
          <TabsContent key={id} value={id} className="grid min-w-0 gap-3 outline-none">
            <ClientPanel client={id} server={config} serverName={name} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ClientPanel({ client, server, serverName }: { client: ClientId; server: ConfigServer; serverName: string }) {
  const t = useT();
  const out = useMemo(() => buildClientConfig(client, server), [client, server]);
  const vars = out.needs.envVars.join(", ");
  const notes: string[] = [];
  if (client === "claude-desktop" && server.kind === "http") notes.push(t("clientConfig.noteRemote"));
  if (out.needs.allowHttp) notes.push(t("clientConfig.noteAllowHttp"));
  if (out.needs.repoPath) notes.push(t("clientConfig.noteRepoPath"));
  if (out.needs.envVars.length > 0) {
    notes.push(client === "claude-desktop" ? t("clientConfig.noteEnvDesktop", { vars }) : client === "vscode" ? t("clientConfig.noteEnvVscode") : t("clientConfig.noteEnv", { vars }));
  }

  return (
    <>
      {out.blocks.map((block) => (
        <ConfigBlockView key={block.id} block={block} serverName={serverName} client={client} />
      ))}
      {notes.length > 0 ? (
        <ul className="grid list-disc gap-1 pl-4 text-xs leading-4 text-fg-muted" data-config-notes>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ConfigBlockView({ block, serverName, client }: { block: ConfigBlock; serverName: string; client: ClientId }) {
  const t = useT();
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hintId = useId();
  const label = t("clientConfig.copyLabel", { client: t(TAB_LABEL[client]) });

  return (
    <div className="grid min-w-0 gap-1.5" data-config-block={block.id}>
      <p id={hintId} className="text-xs leading-4 text-fg-muted">
        {t(BLOCK_HINT[block.id])}
      </p>
      <div className="overflow-hidden rounded-md border border-line bg-surface-sunken">
        <pre
          tabIndex={0}
          aria-label={t("clientConfig.codeLabel", { client: t(TAB_LABEL[client]), server: serverName })}
          className="max-h-72 overflow-auto p-3 font-mono text-xs leading-[18px] mono-exact outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
          data-config-text
        >
          <code>{block.text}</code>
        </pre>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={hintId}
          data-action="copy-config"
          onClick={async () => {
            if (!(await copy(block.text))) return;
            markGettingStarted("copyConfig");
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckIcon aria-hidden className="text-success-fg" /> : <CopyIcon aria-hidden />}
          {copied ? t("clientConfig.copied") : label}
        </Button>
      </div>
    </div>
  );
}
