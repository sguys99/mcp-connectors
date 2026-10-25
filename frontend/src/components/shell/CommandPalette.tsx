"use client";

import { FileJsonIcon, FileTextIcon, GlobeIcon, MessageSquareIcon, MonitorIcon, MoonIcon, PlugIcon, PlusIcon, SunIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";

import { useSetLanguage } from "@/components/language-toggle";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useT } from "@/lib/i18n/client";
import { loadPrimitivesCache, savePrimitivesCache } from "@/lib/inspector/primitives-cache";
import { isDeclared } from "@/lib/inspector/primitives";
import { loadToolsCache, saveToolsCache } from "@/lib/inspector/tools-cache";
import { createMCPClient } from "@/lib/mcp/client";
import { ALL_ITEMS } from "@/lib/shell/routes";

import { useServerHealth } from "./health-store";
import { NAV_ICONS } from "./nav-icons";
import { useSelectedServer, useShell } from "./shell-context";
import { StatusDot } from "./StatusDot";
import type { PromptMeta, PublicServer, ResourceMeta, ResourceTemplateMeta, ToolMeta } from "@/lib/mcp/types";

// ⌘K / Ctrl+K 명령 팔레트. Go to(화면), Servers(Inspector 에서 열기), Preferences(테마, 언어).
// 900px 이하에서는 하단 시트 모양으로 열린다. 포커스 가둠과 복귀, Esc 닫기는 Dialog 가 맡는다.
export function CommandPalette() {
  const t = useT();
  const router = useRouter();
  const { servers, paletteOpen, setPaletteOpen, openServerInInspector, openAddServer, openClientConfig } = useShell();
  const selectedName = useSelectedServer();
  const selectedServer = servers.find((s) => s.name === selectedName);
  const { setTheme } = useTheme();
  const { setLanguage } = useSetLanguage();

  // 항목을 실행하고 팔레트를 닫는다.
  const run = (action: () => void) => () => {
    setPaletteOpen(false);
    action();
  };

  const THEMES: ReadonlyArray<[string, LucideIcon, "shell.paletteThemeLight" | "shell.paletteThemeDark" | "shell.paletteThemeSystem"]> = [
    ["light", SunIcon, "shell.paletteThemeLight"],
    ["dark", MoonIcon, "shell.paletteThemeDark"],
    ["system", MonitorIcon, "shell.paletteThemeSystem"],
  ];

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title={t("shell.openPalette")}
      description={t("shell.paletteDescription")}
      className="top-[12vh] w-[min(600px,calc(100%-2rem))] max-w-none gap-0 sm:max-w-none max-[901px]:top-auto max-[901px]:bottom-0 max-[901px]:left-0 max-[901px]:w-full max-[901px]:max-w-none max-[901px]:translate-x-0 max-[901px]:rounded-b-none! max-[901px]:pb-[env(safe-area-inset-bottom,0px)]"
    >
      <Command label={t("shell.openPalette")} className="rounded-none! bg-transparent p-0">
        <CommandInput placeholder={t("shell.palettePlaceholder")} />
        <CommandList className="max-h-[50vh]">
          <CommandEmpty>{t("shell.paletteEmpty")}</CommandEmpty>

          <CommandGroup heading={t("shell.paletteGoTo")}>
            {ALL_ITEMS.map((item) => {
              const Icon = NAV_ICONS[item.id];
              return (
                <CommandItem
                  key={item.id}
                  value={`go ${item.id} ${t(item.labelKey)}`}
                  onSelect={run(() => router.push(item.href))}
                >
                  <Icon aria-hidden />
                  {t(item.labelKey)}
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading={t("shell.paletteActions")}>
            <CommandItem value="action add server runtime" onSelect={run(openAddServer)}>
              <PlusIcon aria-hidden />
              {t("runtime.addServer")}
            </CommandItem>
            {selectedServer ? (
              <CommandItem
                value={`action copy client config ${selectedServer.name}`}
                onSelect={run(() => openClientConfig(selectedServer.name))}
              >
                <FileJsonIcon aria-hidden />
                {t("runtime.paletteCopyConfig", { name: selectedServer.name })}
              </CommandItem>
            ) : null}
          </CommandGroup>

          {servers.length > 0 && (
            <CommandGroup heading={t("shell.paletteServers")}>
              {servers.map((server) => (
                <ServerItem key={server.name} server={server} onOpen={run(() => openServerInInspector(server.name))} />
              ))}
            </CommandGroup>
          )}

          <PrimitiveGroups onDone={() => setPaletteOpen(false)} />

          <CommandGroup heading={t("shell.palettePrefs")}>
            {THEMES.map(([value, Icon, labelKey]) => (
              <CommandItem key={value} value={`theme ${value} ${t(labelKey)}`} onSelect={run(() => setTheme(value))}>
                <Icon aria-hidden />
                {t(labelKey)}
              </CommandItem>
            ))}
            <CommandItem value="language en English" onSelect={run(() => setLanguage("en"))}>
              <GlobeIcon aria-hidden />
              {t("shell.paletteLangEn")}
            </CommandItem>
            <CommandItem value="language ko 한국어 Korean" onSelect={run(() => setLanguage("ko"))}>
              <GlobeIcon aria-hidden />
              {t("shell.paletteLangKo")}
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <div className="flex flex-wrap gap-4 border-t border-line bg-background px-4 py-2 text-2xs text-fg-muted max-[901px]:hidden">
          <Hint keys={["↑", "↓"]}>{t("shell.paletteMove")}</Hint>
          <Hint keys={["↵"]}>{t("shell.paletteRun")}</Hint>
          <Hint keys={["Esc"]}>{t("common.close")}</Hint>
        </div>
      </Command>
    </CommandDialog>
  );
}

// 선택된 서버의 도구, 리소스, 프롬프트 그룹. 팔레트가 열릴 때(이 컴포넌트가 마운트될 때)만 불러온다.
// 이 탭의 캐시(도구 목록, 서버 정보와 리소스, 프롬프트)를 먼저 보여 주고, 없는 것만 프록시로 한 번 요청한다.
// 리소스와 프롬프트는 서버가 initialize 에서 선언했을 때만 부른다. stdio 서버, 오프라인, 실패는 그룹을 그리지 않는 것으로 처리한다.
interface ServerItems {
  name: string;
  tools: ToolMeta[] | null;
  resources: ResourceMeta[];
  templates: ResourceTemplateMeta[];
  prompts: PromptMeta[];
}

function PrimitiveGroups({ onDone }: { onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const { servers } = useShell();
  const selected = useSelectedServer();
  const server = servers.find((s) => s.name === selected);
  const http = server && server.transport === "streamable_http" ? server : null;
  const [loaded, setLoaded] = useState<ServerItems | null>(null);

  const httpName = http?.name ?? null;
  useEffect(() => {
    if (!http) return;
    let cancelled = false;
    const name = http.name;
    // 상태 갱신은 macrotask 로 나눈다 (react-hooks/set-state-in-effect 회피, Inspector 와 같은 패턴).
    const timer = setTimeout(() => {
      const toolsCache = loadToolsCache(name);
      const primCache = loadPrimitivesCache(name);
      const update = (patch: Partial<ServerItems>) =>
        setLoaded((prev) => ({ name, tools: null, resources: [], templates: [], prompts: [], ...(prev?.name === name ? prev : {}), ...patch }));
      if (toolsCache || primCache) {
        update({
          tools: toolsCache?.tools ?? null,
          resources: primCache?.resources ?? [],
          templates: primCache?.templates ?? [],
          prompts: primCache?.prompts ?? [],
        });
      }
      if (toolsCache && primCache) return;

      const client = createMCPClient(http);
      void (async () => {
        try {
          if (!toolsCache) {
            const tools = await client.listTools();
            if (cancelled) return;
            saveToolsCache(name, tools);
            update({ tools });
          }
          if (!primCache) {
            const info = await client.getServerInfo().catch(() => null);
            if (!info || cancelled) return;
            const wantResources = isDeclared(info.capabilities, "resources");
            const wantPrompts = isDeclared(info.capabilities, "prompts");
            const [res, tpl, prm] = await Promise.allSettled([
              wantResources ? client.listResources() : Promise.resolve([] as ResourceMeta[]),
              wantResources ? client.listResourceTemplates() : Promise.resolve([] as ResourceTemplateMeta[]),
              wantPrompts ? client.listPrompts() : Promise.resolve([] as PromptMeta[]),
            ]);
            if (cancelled) return;
            const resources = res.status === "fulfilled" ? res.value : [];
            const templates = tpl.status === "fulfilled" ? tpl.value : [];
            const prompts = prm.status === "fulfilled" ? prm.value : [];
            savePrimitivesCache(name, { info, resources, templates, prompts });
            update({ resources, templates, prompts });
          }
        } catch {
          /* 오프라인이나 실패는 그룹을 그리지 않는다 */
        } finally {
          void client.close();
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [httpName]);

  if (!http || !loaded || loaded.name !== http.name) return null;
  const go = (param: "tool" | "resource" | "prompt", value: string) => () => {
    onDone();
    router.push(`/inspector?server=${encodeURIComponent(http.name)}&${param}=${encodeURIComponent(value)}`);
  };
  return (
    <>
      {loaded.tools && loaded.tools.length > 0 ? (
        <CommandGroup heading={t("shell.paletteTools", { server: http.name })}>
          {loaded.tools.map((tool) => (
            <CommandItem key={tool.name} value={`tool ${http.name} ${tool.name} ${tool.description}`} onSelect={go("tool", tool.name)}>
              <WrenchIcon aria-hidden />
              <span className="font-mono text-xs">{tool.name}</span>
              <span className="ml-auto text-2xs text-fg-muted">{t("shell.paletteToolSub")}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {loaded.resources.length + loaded.templates.length > 0 ? (
        <CommandGroup heading={t("shell.paletteResources", { server: http.name })}>
          {loaded.resources.map((r) => (
            <CommandItem key={r.uri} value={`resource ${http.name} ${r.name} ${r.uri} ${r.title ?? ""}`} onSelect={go("resource", r.uri)}>
              <FileTextIcon aria-hidden />
              <span className="font-mono text-xs">{r.name}</span>
              <span className="ml-auto text-2xs text-fg-muted">{t("shell.paletteResourceSub")}</span>
            </CommandItem>
          ))}
          {loaded.templates.map((x) => (
            <CommandItem key={x.uriTemplate} value={`resource ${http.name} ${x.name} ${x.uriTemplate} ${x.title ?? ""}`} onSelect={go("resource", x.uriTemplate)}>
              <FileTextIcon aria-hidden />
              <span className="font-mono text-xs">{x.name}</span>
              <span className="ml-auto text-2xs text-fg-muted">{t("shell.paletteResourceSub")}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {loaded.prompts.length > 0 ? (
        <CommandGroup heading={t("shell.palettePrompts", { server: http.name })}>
          {loaded.prompts.map((p) => (
            <CommandItem key={p.name} value={`prompt ${http.name} ${p.name} ${p.title ?? ""} ${p.description ?? ""}`} onSelect={go("prompt", p.name)}>
              <MessageSquareIcon aria-hidden />
              <span className="font-mono text-xs">{p.name}</span>
              <span className="ml-auto text-2xs text-fg-muted">{t("shell.palettePromptSub")}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

function ServerItem({ server, onOpen }: { server: PublicServer; onOpen: () => void }) {
  const t = useT();
  const health = useServerHealth(server);
  const isStdio = server.transport === "stdio";
  return (
    <CommandItem
      value={`server ${server.name} ${server.description ?? ""}`}
      disabled={isStdio}
      onSelect={onOpen}
    >
      <PlugIcon aria-hidden />
      <span className="font-mono text-xs">{server.name}</span>
      <span className="ml-auto flex items-center gap-2 text-2xs text-fg-muted">
        {isStdio ? t("shell.stdioUnavailable") : t("shell.paletteOpenInInspector")}
        <StatusDot status={health.status} />
      </span>
    </CommandItem>
  );
}

function Hint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {children}
    </span>
  );
}
