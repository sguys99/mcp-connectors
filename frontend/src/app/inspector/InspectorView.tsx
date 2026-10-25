"use client";

// Inspector 본체: 도구 목록, 요청, 응답 3분할 (final.html 의 A Inspector).
//
//   * 서버는 셸의 탐색기가 ?server= 로 고른다 (page.tsx 가 key 로 서버마다 새로 마운트한다). 이 화면에는 서버 선택이 없다.
//   * MCPClient 한 개를 서버당 유지한다. 서버가 바뀌거나 Retry 하면 닫고 새로 만든다 (dashboard 와 같은 생애주기).
//   * 실행은 AbortController 로 취소할 수 있다. SDK 가 notifications/cancelled 를 보내고 세션은 그대로라 다음 호출이 이어진다.
//   * 호출이 끝나면 셸 상태바(last, p50)에 소요 시간을 올리고, 성공이면 시작하기 체크리스트의 "첫 호출"을 완료로 표시한다.
//   * 왼쪽 목록은 Tools / Resources / Prompts 탭이다. Resources, Prompts 는 서버가 initialize 에서 capability 를 선언했을 때만 목록을 부른다.
//     딥링크: ?tool=, ?resource=<uri 또는 uriTemplate>, ?prompt=<이름>. 요청과 응답 패널은 선택한 종류에 맞춰 바뀐다.
//   * 하단 도킹 패널의 탭: JSON-RPC 로그(transport 를 지나는 메시지 원문, 이 화면을 연 뒤의 것), History(호출 기록, 서버별
//     localStorage), Server info (initialize 결과). 기록은 열기(요청 패널 채우기)와 다시 실행, 삭제, 시나리오 YAML 내보내기를 지원한다.

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InspectorLayout, type MobilePane } from "@/components/inspector/InspectorLayout";
import { InspectorDock, type DockTab, type ServerInfoState } from "@/components/inspector/InspectorDock";
import { PrimitivePane } from "@/components/inspector/PrimitivePane";
import {
  PromptRequestPane,
  ResourceRequestPane,
  type ResourceSelection,
} from "@/components/inspector/PrimitiveRequestPane";
import { RequestPane, type RunStatus } from "@/components/inspector/RequestPane";
import { ResponsePane, type ResponseTab } from "@/components/inspector/ResponsePane";
import { StdioNotice } from "@/components/inspector/StdioNotice";
import { useLayoutBand } from "@/components/inspector/use-layout-band";
import type { CallMethod, CallPayload, ResponseView } from "@/components/inspector/types";
import { useShell, useShellMeta } from "@/components/shell/shell-context";
import { useShortcut } from "@/components/shell/shortcuts";
import { useT } from "@/lib/i18n/client";
import {
  buildArgs,
  emptyValues,
  fieldsFromSchema,
  parseRawArgs,
  stringifyArgs,
  valuesFromArgs,
  type FieldErrors,
  type FormValues,
} from "@/lib/inspector/args";
import { loadSamples, p50, recordSample } from "@/lib/inspector/call-stats";
import { DOCK_OPEN_KEYS, parseDockOpen, type DockMode } from "@/lib/inspector/layout";
import { draftToForm, draftToJson, newDraft, resetDraft, type InputMode, type ToolDraft } from "@/lib/inspector/draft";
import {
  buildHistoryEntry,
  clearHistory,
  loadHistory,
  pushHistory,
  removeHistory,
  type HistoryEntry,
} from "@/lib/inspector/history";
import { containsRedacted } from "@/lib/inspector/redact";
import { appendRpc, emptyRpcLog, type RpcLog } from "@/lib/inspector/rpc-log";
import {
  expandUriTemplate,
  isDeclared,
  promptFields,
  shortMime,
  templateFields,
  type PaneItem,
  type PrimitiveKind,
} from "@/lib/inspector/primitives";
import { loadPrimitivesCache, savePrimitivesCache } from "@/lib/inspector/primitives-cache";
import { loadToolsCache, saveToolsCache } from "@/lib/inspector/tools-cache";
import { createMCPClient, isBrowserNetworkError, type MCPClient } from "@/lib/mcp/client";
import { displayTarget } from "@/lib/runtime/connection";
import { describeNetworkFailure } from "@/lib/runtime/errors";
import { useHydrated } from "@/lib/onboarding/use-getting-started";
import type {
  CallResult,
  PromptMeta,
  ResourceMeta,
  ResourceTemplateMeta,
  RpcMessageEvent,
  ServerInfo,
  StreamableHttpServer,
  ToolMeta,
} from "@/lib/mcp/types";
import { markGettingStarted } from "@/lib/onboarding/getting-started";
import { safeStorage } from "@/lib/storage/safe-storage";
import { saveSettings } from "@/lib/storage/settings";
import { notify } from "@/lib/ui/notify";


export interface StdioTarget {
  name: string;
  description?: string;
  descriptionKo?: string;
  twin: string | null;
}

interface InspectorViewProps {
  initialServer: string;
  reachable: readonly StreamableHttpServer[];
  // ?server= 가 stdio 서버를 가리키면 3분할 대신 CLI 안내를 보여 준다.
  stdio?: StdioTarget | null;
}

// 실행 전 입력 검증에 걸리면 첫 오류 칸으로 포커스를 옮긴다. 포커스가 Run 버튼에 남으면 스크린 리더는 오류를 알 수 없고,
// 칸으로 옮기면 이름, invalid 상태, 오류 문구(aria-describedby)가 한 번에 읽힌다. 오류 표시가 그려진 다음 프레임에 찾는다.
function focusFirstInvalid() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>("main [aria-invalid='true']")?.focus());
}

export function InspectorView({ initialServer, reachable, stdio }: InspectorViewProps) {
  if (stdio) return <StdioView target={stdio} />;
  return <HttpInspector serverName={initialServer} reachable={reachable} />;
}

function StdioView({ target }: { target: StdioTarget }) {
  const t = useT();
  useShellMeta({ server: target.name });
  return (
    <div className="h-full min-h-0">
      <h1 className="sr-only">{t("inspector.title")}</h1>
      <StdioNotice {...target} />
    </div>
  );
}

function HttpInspector({ serverName, reachable }: { serverName: string; reachable: readonly StreamableHttpServer[] }) {
  const t = useT();
  // 레지스트리 서버, 없으면 이 탭 세션의 런타임 서버. 런타임 서버는 sessionStorage 를 읽는 하이드레이션 뒤에야 목록에 나타난다.
  const { servers: shellServers, openClientConfig } = useShell();
  const hydrated = useHydrated();
  const server = useMemo<StreamableHttpServer | null>(() => {
    const registry = reachable.find((s) => s.name === serverName);
    if (registry) return registry;
    const runtime = shellServers.find((s) => s.name === serverName);
    return runtime && runtime.transport === "streamable_http" && runtime.runtime ? runtime : null;
  }, [reachable, shellServers, serverName]);
  // 화면에 보이는 주소: 런타임 서버는 대상 URL (쿼리 문자열은 가림), 그 밖에는 프록시 경로
  const endpointLabel = server?.runtime ? displayTarget(server.runtime.target) : (server?.url ?? "");

  // ----- 목록 (도구, 리소스, 프롬프트) 과 서버 정보 -----
  const [tools, setTools] = useState<ToolMeta[] | null>(null);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [info, setInfo] = useState<ServerInfoState>({ kind: "loading" });
  const [resources, setResources] = useState<ResourceMeta[] | null>(null);
  const [templates, setTemplates] = useState<ResourceTemplateMeta[]>([]);
  const [prompts, setPrompts] = useState<PromptMeta[] | null>(null);
  // 리소스, 프롬프트 목록은 도구 목록 뒤에 부른다. 그 사이는 loading.
  const [primLoading, setPrimLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [filters, setFilters] = useState<Record<PrimitiveKind, string>>({ tools: "", resources: "", prompts: "" });
  const filterRef = useRef<HTMLInputElement | null>(null);
  const clientRef = useRef<MCPClient | null>(null);
  // 실행 중인 호출의 취소 컨트롤러
  const abortRef = useRef<AbortController | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("tools");
  // JSON-RPC 로그: 이 화면(서버)을 연 뒤 transport 를 지난 메시지. client 를 다시 만들어도(Retry) 이어서 쌓는다.
  const [rpcLog, setRpcLog] = useState<RpcLog>(emptyRpcLog);
  const onMessage = useCallback((event: RpcMessageEvent) => setRpcLog((log) => appendRpc(log, event)), []);
  // 호출 기록: 모든 서버가 한 저장소를 쓰고, 화면에는 이 서버 것만 보인다. 마운트 뒤에 읽는다 (서버 렌더와 같게 비워 시작).
  const [allHistory, setAllHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAllHistory(loadHistory()), 0);
    return () => clearTimeout(timer);
  }, []);
  const history = useMemo(() => allHistory.filter((e) => e.server === serverName), [allHistory, serverName]);
  // 언어를 바꿔도 목록을 다시 불러오지 않도록 t 는 ref 로 읽는다.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // 서버 전환 또는 Retry: 이전 client 를 닫고 새로 만든 뒤 listTools, initialize 결과, (선언했다면) listResources, listPrompts.
  // 상태 갱신은 setTimeout(..., 0) 으로 macrotask 를 나눈다 (react-hooks/set-state-in-effect 회피, Dashboard 와 같은 패턴).
  useEffect(() => {
    let cancelled = false;
    const previous = clientRef.current;
    clientRef.current = null;
    if (previous) void previous.close();

    const timerId = setTimeout(() => {
      if (cancelled) return;
      if (!server) {
        // 런타임 서버일 수 있는 이름은 하이드레이션이 끝나 목록이 채워질 때까지 기다린다 (잘못된 "알 수 없는 서버" 깜빡임 방지)
        if (!hydrated) return;
        setToolsError(tRef.current("inspector.unknownServer", { name: serverName }));
        setTools(null);
        setToolsLoading(false);
        setInfo({ kind: "unavailable" });
        setPrimLoading(false);
        return;
      }
      setToolsLoading(true);
      setPrimLoading(true);
      setToolsError(null);
      setInfo({ kind: "loading" });

      const client = createMCPClient(server, { onMessage });
      clientRef.current = client;
      void (async () => {
        let list: ToolMeta[];
        try {
          list = await client.listTools();
        } catch (err) {
          if (cancelled) return;
          // 서버가 꺼져 있으면 마지막으로 본 목록을 보여 준다 (이 탭에서 본 적이 있을 때).
          const cache = loadToolsCache(serverName);
          if (cache) {
            setTools(cache.tools);
            setCachedAt(cache.at);
            setToolsError(null);
            const prim = loadPrimitivesCache(serverName);
            setInfo(prim?.info ? { kind: "ready", info: prim.info } : { kind: "unavailable" });
            setResources(prim?.resources ?? null);
            setTemplates(prim?.templates ?? []);
            setPrompts(prim?.prompts ?? null);
          } else {
            setTools(null);
            setCachedAt(null);
            setToolsError(
              describeNetworkFailure(server, isBrowserNetworkError(err) ? "network" : undefined, tRef.current) ??
                (err instanceof Error ? err.message : String(err)),
            );
            setInfo({ kind: "unavailable" });
          }
          setToolsLoading(false);
          setPrimLoading(false);
          return;
        }
        if (cancelled) return;
        saveToolsCache(serverName, list);
        setTools(list);
        setCachedAt(null);
        setToolsLoading(false);

        // initialize 결과를 읽고, 서버가 선언한 기능만 목록을 부른다.
        let serverInfo: ServerInfo | null = null;
        try {
          serverInfo = await client.getServerInfo();
        } catch {
          serverInfo = null;
        }
        if (cancelled) return;
        setInfo(serverInfo ? { kind: "ready", info: serverInfo } : { kind: "unavailable" });

        const wantResources = serverInfo ? isDeclared(serverInfo.capabilities, "resources") : false;
        const wantPrompts = serverInfo ? isDeclared(serverInfo.capabilities, "prompts") : false;
        const [res, tpl, prm] = await Promise.allSettled([
          wantResources ? client.listResources() : Promise.resolve([] as ResourceMeta[]),
          // 템플릿 목록은 서버가 지원하지 않을 수 있어 실패해도 리소스 목록은 보여 준다.
          wantResources ? client.listResourceTemplates() : Promise.resolve([] as ResourceTemplateMeta[]),
          wantPrompts ? client.listPrompts() : Promise.resolve([] as PromptMeta[]),
        ]);
        if (cancelled) return;
        const resList = res.status === "fulfilled" ? res.value : null;
        const tplList = tpl.status === "fulfilled" ? tpl.value : [];
        const prmList = prm.status === "fulfilled" ? prm.value : null;
        setResources(resList);
        setTemplates(tplList);
        setPrompts(prmList);
        setResourcesError(res.status === "rejected" ? String(res.reason instanceof Error ? res.reason.message : res.reason) : null);
        setPromptsError(prm.status === "rejected" ? String(prm.reason instanceof Error ? prm.reason.message : prm.reason) : null);
        setPrimLoading(false);
        savePrimitivesCache(serverName, {
          info: serverInfo,
          resources: resList ?? [],
          templates: tplList,
          prompts: prmList ?? [],
        });
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [server, serverName, retryToken, onMessage, hydrated]);

  // 화면을 떠날 때 마지막 client 와 진행 중인 호출을 정리한다.
  useEffect(() => {
    return () => {
      abortRef.current?.abort("Inspector closed");
      const c = clientRef.current;
      clientRef.current = null;
      if (c) void c.close();
    };
  }, []);

  // 마지막으로 본 서버를 기억해 Chat 이 같은 서버로 시작하게 한다.
  useEffect(() => {
    saveSettings({ selectedServer: serverName });
  }, [serverName]);

  // ----- 탭, 선택 -----
  // ?tool= / ?resource= / ?prompt= 로 들어오면 그 항목을 고른다 (팔레트의 "Tools on 서버" 등). 같은 서버에서 쿼리만 바뀌어도 따라간다.
  const searchParams = useSearchParams();
  const toolParam = searchParams.get("tool");
  const resourceParam = searchParams.get("resource");
  const promptParam = searchParams.get("prompt");
  const paramKey = `${toolParam ?? ""}|${resourceParam ?? ""}|${promptParam ?? ""}`;
  const [tab, setTab] = useState<PrimitiveKind>(resourceParam ? "resources" : promptParam ? "prompts" : "tools");
  const [selectedName, setSelectedName] = useState<string | null>(toolParam);
  const [selectedResource, setSelectedResource] = useState<string | null>(resourceParam);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(promptParam);
  const [seenParams, setSeenParams] = useState(paramKey);
  if (seenParams !== paramKey) {
    setSeenParams(paramKey);
    if (toolParam) {
      setTab("tools");
      setSelectedName(toolParam);
      setMobilePane("request");
    } else if (resourceParam) {
      setTab("resources");
      setSelectedResource(resourceParam);
      setMobilePane("request");
    } else if (promptParam) {
      setTab("prompts");
      setSelectedPrompt(promptParam);
      setMobilePane("request");
    }
  }
  const [drafts, setDrafts] = useState<Record<string, ToolDraft>>({});
  // 리소스 template 변수와 prompt 인자 입력값 (항목별)
  const [primValues, setPrimValues] = useState<Record<string, FormValues>>({});
  const [errors, setErrors] = useState<FieldErrors>({});

  // 목록이 처음 오면 첫 항목을 고른다 (직접 고른 뒤에는 건드리지 않는다).
  const firstTool = tools?.[0]?.name ?? null;
  const effectiveName = selectedName && tools?.some((x) => x.name === selectedName) ? selectedName : firstTool;
  const tool = useMemo(() => tools?.find((x) => x.name === effectiveName) ?? null, [tools, effectiveName]);
  const fields = useMemo(() => (tool ? fieldsFromSchema(tool.inputSchema) : []), [tool]);
  const draft = tool ? (drafts[tool.name] ?? newDraft(fields)) : null;

  const resourceSelection = useMemo<ResourceSelection | null>(() => {
    const meta = resources?.find((r) => r.uri === selectedResource);
    if (meta) return { kind: "resource", meta };
    const tpl = templates.find((x) => x.uriTemplate === selectedResource);
    if (tpl) return { kind: "template", meta: tpl };
    const first = resources?.[0];
    if (first) return { kind: "resource", meta: first };
    return templates[0] ? { kind: "template", meta: templates[0] } : null;
  }, [resources, templates, selectedResource]);
  const resourceId = resourceSelection ? (resourceSelection.kind === "resource" ? resourceSelection.meta.uri : resourceSelection.meta.uriTemplate) : null;
  const resourceFields = useMemo(
    () => (resourceSelection?.kind === "template" ? templateFields(resourceSelection.meta) : []),
    [resourceSelection],
  );
  const prompt = useMemo(() => prompts?.find((p) => p.name === selectedPrompt) ?? prompts?.[0] ?? null, [prompts, selectedPrompt]);
  const promptFieldList = useMemo(() => (prompt ? promptFields(prompt) : []), [prompt]);

  // 현재 탭에서 값을 받는 폼 (template 변수, prompt 인자)
  const primKey = tab === "resources" && resourceId ? `r:${resourceId}` : tab === "prompts" && prompt ? `p:${prompt.name}` : null;
  const primFields = useMemo(
    () => (tab === "resources" ? resourceFields : tab === "prompts" ? promptFieldList : []),
    [tab, resourceFields, promptFieldList],
  );
  const primFormValues: FormValues = (primKey && primValues[primKey]) || emptyValues(primFields);
  const resolvedUri =
    resourceSelection?.kind === "template"
      ? expandUriTemplate(resourceSelection.meta.uriTemplate, buildArgs(resourceFields, primFormValues, { lenient: true }).args)
      : (resourceSelection?.meta as ResourceMeta | undefined)?.uri ?? "";

  const updateDraft = useCallback(
    (update: (d: ToolDraft) => ToolDraft) => {
      if (!tool) return;
      setDrafts((all) => ({ ...all, [tool.name]: update(all[tool.name] ?? newDraft(fields)) }));
    },
    [tool, fields],
  );

  const selectItem = useCallback(
    (id: string) => {
      if (tab === "tools") setSelectedName(id);
      else if (tab === "resources") setSelectedResource(id);
      else setSelectedPrompt(id);
      setErrors({});
      setMobilePane("request");
    },
    [tab],
  );

  const changeTab = useCallback((next: PrimitiveKind) => {
    setTab(next);
    setErrors({});
  }, []);

  const clearError = useCallback((name: string) => {
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const onField = useCallback(
    (name: string, value: string | boolean) => {
      updateDraft((d) => ({ ...d, values: { ...d.values, [name]: value } }));
      clearError(name);
    },
    [updateDraft, clearError],
  );

  const onPrimField = useCallback(
    (name: string, value: string | boolean) => {
      if (!primKey) return;
      setPrimValues((all) => ({ ...all, [primKey]: { ...(all[primKey] ?? emptyValues(primFields)), [name]: value } }));
      clearError(name);
    },
    [primKey, primFields, clearError],
  );

  const onRaw = useCallback((text: string) => updateDraft((d) => ({ ...d, raw: text })), [updateDraft]);

  const onMode = useCallback(
    (mode: InputMode) => {
      if (!draft) return;
      if (mode === "json") {
        updateDraft((d) => draftToJson(fields, d));
        setErrors({});
        return;
      }
      const result = draftToForm(fields, draft);
      if (!result.ok) {
        notify.warning(t("inspector.jsonFixFirst"));
        return;
      }
      updateDraft(() => result.draft);
    },
    [draft, fields, updateDraft, t],
  );

  const onReset = useCallback(() => {
    if (tab === "tools") updateDraft((d) => resetDraft(fields, d));
    else if (primKey) setPrimValues((all) => ({ ...all, [primKey]: emptyValues(primFields) }));
    setErrors({});
  }, [tab, fields, updateDraft, primKey, primFields]);

  // ----- 실행 -----
  const [view, setView] = useState<ResponseView>({ kind: "idle" });
  const [status, setStatus] = useState<RunStatus>({ kind: "ready" });
  const [responseTab, setResponseTab] = useState<ResponseTab>("content");
  const [lastCallMs, setLastCallMs] = useState<number | undefined>(undefined);
  // 초기값은 서버 렌더와 같게 null 로 두고, 마운트 뒤에 이 세션의 기록을 읽는다.
  const [p50Ms, setP50Ms] = useState<number | undefined>(undefined);
  const running = status.kind === "running";

  useEffect(() => {
    const timer = setTimeout(() => {
      const value = p50(loadSamples());
      if (value !== null) setP50Ms(value);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useShellMeta({ server: serverName, lastCallMs, p50Ms });

  // 요청 한 건을 보내고 결과를 응답 패널과 상태바에 반영한다. 도구, 리소스, 프롬프트가 같은 경로를 쓴다.
  const execute = useCallback(
    async (
      method: CallMethod,
      target: string,
      args: Record<string, unknown>,
      send: (client: MCPClient, signal: AbortSignal) => Promise<CallResult<CallPayload>>,
      // 기록용: template 으로 읽은 리소스는 uriTemplate 과 변수를 남긴다 (args 는 {uri} 라 변수가 없다)
      historyMeta?: { template?: string; args?: Record<string, unknown> },
    ) => {
      if (!server) return;
      // clientRef 가 stale-session 정리로 비어 있으면 새로 만든다.
      let client = clientRef.current;
      if (!client) {
        client = createMCPClient(server, { onMessage });
        clientRef.current = client;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = performance.now();
      setStatus({ kind: "running", startedAt });
      setView({ kind: "running", tool: target, method });
      // 모바일에서는 실행하면 응답 탭으로 넘어간다.
      setMobilePane("response");

      const result = await send(client, controller.signal);
      if (abortRef.current === controller) abortRef.current = null;
      const detail = result.detail;
      const outcome = detail?.outcome ?? (result.isError ? "tool-error" : "ok");
      const elapsed = detail?.elapsedMs ?? result.durationMs;

      // 세션이 만료된 연결은 버려서 다음 호출이 새 세션으로 시작하게 한다.
      const failureText = detail?.errorMessage ?? (typeof result.content === "string" ? result.content : "");
      if (
        (outcome === "transport" || outcome === "rpc-error") &&
        (failureText.includes("Session not found") || failureText.includes("Missing session ID"))
      ) {
        const stale = clientRef.current;
        clientRef.current = null;
        if (stale) void stale.close().catch(() => undefined);
      }

      setView({ kind: "done", method, server: serverName, tool: target, endpoint: endpointLabel, args, result });
      setAllHistory(
        pushHistory(
          buildHistoryEntry({ server: serverName, method, target, args: historyMeta?.args ?? args, result, template: historyMeta?.template }),
        ),
      );
      if (outcome === "cancelled") {
        setStatus({ kind: "cancelled", ms: elapsed });
        return;
      }
      setStatus({ kind: "done", ms: elapsed });
      if (outcome === "ok" || outcome === "tool-error") {
        setLastCallMs(Math.round(elapsed));
        setP50Ms(p50(recordSample(Math.round(elapsed))) ?? undefined);
      }
      if (outcome === "ok" && method === "tools/call") markGettingStarted("inspectorCall");
    },
    [server, serverName, onMessage, endpointLabel],
  );

  const run = useCallback(async () => {
    if (!server || running) return;

    if (tab === "resources") {
      if (!resourceSelection) return;
      let uri: string;
      if (resourceSelection.kind === "template") {
        const built = buildArgs(resourceFields, primFormValues);
        if (Object.keys(built.errors).length > 0) {
          setErrors(built.errors);
          focusFirstInvalid();
          return;
        }
        uri = expandUriTemplate(resourceSelection.meta.uriTemplate, built.args);
      } else {
        uri = resourceSelection.meta.uri;
      }
      setErrors({});
      const historyMeta =
        resourceSelection.kind === "template"
          ? { template: resourceSelection.meta.uriTemplate, args: buildArgs(resourceFields, primFormValues).args }
          : undefined;
      await execute("resources/read", uri, { uri }, (client, signal) => client.readResource(uri, { signal }), historyMeta);
      return;
    }

    if (tab === "prompts") {
      if (!prompt) return;
      const built = buildArgs(promptFieldList, primFormValues);
      if (Object.keys(built.errors).length > 0) {
        setErrors(built.errors);
        focusFirstInvalid();
        return;
      }
      setErrors({});
      const args = built.args as Record<string, string>;
      await execute("prompts/get", prompt.name, args, (client, signal) => client.getPrompt(prompt.name, args, { signal }));
      return;
    }

    if (!tool || !draft) return;
    // 입력 확인. 폼은 필드별 오류를 보여 주고, JSON 은 파싱 오류가 입력칸 아래에 이미 보이니 실행만 막는다.
    let args: Record<string, unknown>;
    if (draft.mode === "form") {
      const built = buildArgs(fields, draft.values);
      if (Object.keys(built.errors).length > 0) {
        setErrors(built.errors);
        focusFirstInvalid();
        return;
      }
      args = { ...built.args, ...draft.extra };
    } else {
      const parsed = parseRawArgs(draft.raw);
      if (!parsed.ok) return;
      args = parsed.value;
    }
    setErrors({});
    await execute("tools/call", tool.name, args, (client, signal) => client.callTool(tool.name, args, { signal }));
  }, [
    server,
    running,
    tab,
    resourceSelection,
    resourceFields,
    primFormValues,
    prompt,
    promptFieldList,
    tool,
    draft,
    fields,
    execute,
  ]);

  const cancel = useCallback(() => {
    abortRef.current?.abort("User cancelled from Inspector");
  }, []);

  // ----- 호출 기록: 열기, 다시 실행, 삭제 -----
  // 기록의 입력을 요청 패널에 채운다. 대상이 목록에 없으면(서버가 바뀜) 알리고 false.
  const applyHistory = useCallback(
    (entry: HistoryEntry): boolean => {
      const gone = () => {
        notify.warning(t("inspector.histGone", { name: entry.target }));
        return false;
      };
      if (entry.kind === "tool") {
        const meta = tools?.find((x) => x.name === entry.target);
        if (!meta) return gone();
        const { values, extra } = valuesFromArgs(fieldsFromSchema(meta.inputSchema), entry.args);
        setDrafts((all) => ({ ...all, [meta.name]: { mode: "form", values, raw: stringifyArgs(entry.args), extra } }));
        setTab("tools");
        setSelectedName(meta.name);
      } else if (entry.kind === "resource") {
        const tpl = entry.template ? templates.find((x) => x.uriTemplate === entry.template) : undefined;
        if (tpl) {
          const { values } = valuesFromArgs(templateFields(tpl), entry.args);
          setPrimValues((all) => ({ ...all, [`r:${tpl.uriTemplate}`]: values }));
          setSelectedResource(tpl.uriTemplate);
        } else if (resources?.some((r) => r.uri === entry.target)) {
          setSelectedResource(entry.target);
        } else {
          return gone();
        }
        setTab("resources");
      } else {
        const meta = prompts?.find((p) => p.name === entry.target);
        if (!meta) return gone();
        const { values } = valuesFromArgs(promptFields(meta), entry.args);
        setPrimValues((all) => ({ ...all, [`p:${meta.name}`]: values }));
        setSelectedPrompt(meta.name);
        setTab("prompts");
      }
      setErrors({});
      setMobilePane("request");
      return true;
    },
    [tools, templates, resources, prompts, t],
  );

  const openHistory = useCallback(
    (entry: HistoryEntry) => {
      if (applyHistory(entry)) notify.info(t("inspector.histOpened", { name: entry.target }));
    },
    [applyHistory, t],
  );

  const rerunHistory = useCallback(
    async (entry: HistoryEntry) => {
      if (running || !applyHistory(entry)) return;
      // 비밀 값을 가려 저장했으므로 그대로 보내면 가려진 문구가 나간다. 채우기만 하고 다시 입력하게 한다.
      if (entry.redacted || containsRedacted(entry.args)) {
        notify.warning(t("inspector.histRedactedBlocked"));
        return;
      }
      const args = entry.args;
      if (entry.kind === "tool") {
        await execute("tools/call", entry.target, args, (client, signal) => client.callTool(entry.target, args, { signal }));
      } else if (entry.kind === "resource") {
        const uri = entry.target;
        await execute("resources/read", uri, { uri }, (client, signal) => client.readResource(uri, { signal }), {
          template: entry.template,
          args,
        });
      } else {
        const promptArgs = args as Record<string, string>;
        await execute("prompts/get", entry.target, promptArgs, (client, signal) => client.getPrompt(entry.target, promptArgs, { signal }));
      }
    },
    [running, applyHistory, execute, t],
  );

  // ----- 도킹 패널 -----
  const [dockTab, setDockTab] = useState<DockTab>("log");
  // 펼침 상태는 데스크톱과 모바일(900px 이하)을 따로 브라우저에 기억한다. 저장값이 없으면 데스크톱은 펼침(시안),
  // 모바일은 접힘이다(좁은 화면에서 40vh 를 먼저 차지하면 요청과 응답이 가려진다). 읽기는 클라이언트에서만 일어나고,
  // 패널은 폭을 잰 뒤에 그려진다.
  const band = useLayoutBand();
  const dockMode: DockMode = band === "mobile" ? "mobile" : "desktop";
  const [dockPref, setDockPref] = useState<Record<DockMode, boolean>>(() => ({
    desktop: parseDockOpen(safeStorage.getItem(DOCK_OPEN_KEYS.desktop), "desktop"),
    mobile: parseDockOpen(safeStorage.getItem(DOCK_OPEN_KEYS.mobile), "mobile"),
  }));
  const dockOpen = dockPref[dockMode];
  const setDockOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      setDockPref((prev) => {
        const value = typeof next === "function" ? next(prev[dockMode]) : next;
        if (value === prev[dockMode]) return prev;
        safeStorage.setItem(DOCK_OPEN_KEYS[dockMode], value ? "open" : "closed");
        return { ...prev, [dockMode]: value };
      });
    },
    [dockMode],
  );
  const toggleDock = useCallback(() => setDockOpen((open) => !open), [setDockOpen]);
  // 접힌 상태에서 탭을 누르면 그 탭으로 펼친다.
  const selectDockTab = useCallback(
    (next: DockTab) => {
      setDockTab(next);
      setDockOpen(true);
    },
    [setDockOpen],
  );

  const canRun =
    tab === "tools" ? Boolean(tool) : tab === "resources" ? Boolean(resourceSelection) : Boolean(prompt);

  // 단축키: 실행(⌘↵ / Ctrl+↵), 실행 중 취소(Esc), 도킹 패널(⌘J), 목록 필터(/, 목록에 포커스가 있을 때)
  useShortcut("mod+enter", () => void run(), { enabled: canRun && !running, allowInInput: true });
  useShortcut("escape", cancel, { enabled: running, allowInInput: true });
  useShortcut("mod+j", toggleDock, { allowInInput: true });
  useShortcut(
    "/",
    () => {
      filterRef.current?.focus();
      filterRef.current?.select();
    },
    // 한 글자 단축키라 목록 영역에 포커스가 있을 때만 동작한다 (WCAG 2.1.4)
    { whenFocusWithin: '[data-shortcut-scope="tool-list"]' },
  );

  // ----- 목록 항목 -----
  const items = useMemo<Record<PrimitiveKind, PaneItem[] | null>>(
    () => ({
      tools: tools
        ? tools.map((x) => ({
            id: x.name,
            title: x.name,
            sub: x.description,
            chips: x.annotations?.readOnlyHint ? [{ label: t("inspector.readOnly"), tone: "info" as const }] : undefined,
          }))
        : null,
      resources:
        resources === null && templates.length === 0
          ? null
          : [
              ...(resources ?? []).map((r) => {
                const mime = shortMime(r.mimeType);
                return {
                  id: r.uri,
                  title: r.name,
                  sub: r.uri,
                  mono: true,
                  icon: r.mimeType?.startsWith("image/") ? ("image" as const) : ("file" as const),
                  chips: mime ? [{ label: mime }] : undefined,
                };
              }),
              ...templates.map((x) => ({
                id: x.uriTemplate,
                title: x.name,
                sub: x.uriTemplate,
                mono: true,
                icon: "template" as const,
                chips: [{ label: t("inspector.chipTemplate"), tone: "brand" as const }],
              })),
            ],
      prompts: prompts
        ? prompts.map((p) => ({ id: p.name, title: p.name, sub: p.description ?? "", icon: "message" as const }))
        : null,
    }),
    [tools, resources, templates, prompts, t],
  );
  const counts: Record<PrimitiveKind, number | null> = {
    tools: tools?.length ?? null,
    resources: items.resources?.length ?? null,
    prompts: items.prompts?.length ?? null,
  };
  const caps = info.kind === "ready" ? info.info.capabilities : null;
  const declared = tab === "tools" ? true : info.kind === "loading" ? true : isDeclared(caps, tab);
  const listLoading = tab === "tools" ? toolsLoading : toolsLoading || primLoading;
  const listError = tab === "tools" ? toolsError : tab === "resources" ? resourcesError : promptsError;
  const selectedId = tab === "tools" ? effectiveName : tab === "resources" ? resourceId : (prompt?.name ?? null);
  const listLabel = t(tab === "tools" ? "inspector.tabTools" : tab === "resources" ? "inspector.tabResources" : "inspector.tabPrompts");

  const requestShared = {
    serverName,
    endpoint: endpointLabel,
    errors,
    status,
    onRun: () => void run(),
    onCancel: cancel,
    onReset,
  };

  return (
    <div className="h-full min-h-0">
      <h1 className="sr-only">{t("inspector.title")}</h1>
      <InspectorLayout
        mobilePane={mobilePane}
        onMobilePane={setMobilePane}
        listLabel={listLabel}
        dockOpen={dockOpen}
        dock={
          <InspectorDock
            open={dockOpen}
            onToggle={toggleDock}
            tab={dockTab}
            onTab={selectDockTab}
            serverName={serverName}
            endpoint={endpointLabel}
            runtime={server?.runtime}
            onCopyConfig={() => openClientConfig(serverName)}
            info={info}
            log={rpcLog}
            onClearLog={() => {
              setRpcLog(emptyRpcLog());
              notify.success(t("inspector.logCleared"));
            }}
            history={history}
            onOpenHistory={openHistory}
            onRerunHistory={(entry) => void rerunHistory(entry)}
            onDeleteHistory={(id) => {
              setAllHistory(removeHistory(id));
              notify.success(t("inspector.histDeleted"));
            }}
            onClearHistory={() => {
              setAllHistory(clearHistory(serverName));
              notify.success(t("inspector.histCleared"));
            }}
            running={running}
          />
        }
        tools={
          <PrimitivePane
            tab={tab}
            onTab={changeTab}
            counts={counts}
            declared={declared}
            items={items[tab]}
            loading={listLoading}
            error={listError}
            onRetry={() => setRetryToken((n) => n + 1)}
            cachedAt={cachedAt}
            selectedId={selectedId}
            onSelect={selectItem}
            filter={filters[tab]}
            onFilterChange={(value) => setFilters((all) => ({ ...all, [tab]: value }))}
            filterRef={filterRef}
          />
        }
        request={
          tab === "resources" ? (
            <ResourceRequestPane
              {...requestShared}
              selection={resourceSelection}
              resolvedUri={resolvedUri}
              fields={resourceFields}
              values={primFormValues}
              onField={onPrimField}
            />
          ) : tab === "prompts" ? (
            <PromptRequestPane {...requestShared} prompt={prompt} fields={promptFieldList} values={primFormValues} onField={onPrimField} />
          ) : (
            <RequestPane
              tool={tool}
              serverName={serverName}
              endpoint={endpointLabel}
              fields={fields}
              draft={draft}
              errors={errors}
              onField={onField}
              onRaw={onRaw}
              onMode={onMode}
              status={status}
              onRun={() => void run()}
              onCancel={cancel}
              onReset={onReset}
            />
          )
        }
        response={<ResponsePane view={view} tab={responseTab} onTab={setResponseTab} />}
      />
    </div>
  );
}
