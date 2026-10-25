"use client";

// Settings 화면 (client).
//   * 섹션 6개: LLM, API 키, 화면과 언어, 시작 안내, 로컬 데이터, 정보. 901px 이상에서는 왼쪽 앵커 목록이 붙고, 그 아래에서는 위에 칩 줄이 붙는다.
//   * 저장 방식: LLM 과 API 키 섹션은 명시적 저장(하단 고정 바, ⌘/Ctrl+S). 키가 들어 있어 입력 중 값이 곧바로 저장되는 것을 피하고,
//     검증 오류를 저장 시점에 한꺼번에 보여 주기 위해서다. 테마, 언어, 시작 안내, 초기화는 누르는 즉시 적용되며 섹션 머리글 칩으로 구분한다.
//   * 설정 객체(localStorage "mcp-connectors.settings")는 Chat 툴바와 공유한다. 저장은 loadSettings 와 병합하므로 selectedServer 는 보존된다.

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BotIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  PaletteIcon,
  RocketIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { SectionNav, type SectionNavItem } from "@/components/settings/SectionNav";
import { ApiKeyField } from "@/components/settings/ApiKeyField";
import { LanguageControl, ThemeControl } from "@/components/settings/AppearanceControls";
import { Code, SettingRow, SettingsSection } from "@/components/settings/SettingsSection";
import { useShortcut } from "@/components/shell/shortcuts";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Translator } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { MAX_ITERATIONS, MIN_ITERATIONS } from "@/lib/llm/constants";
import { ANTHROPIC_MODELS, modelOptions, OPENAI_MODELS, PROVIDER_LABELS, type LLMProvider } from "@/lib/llm/models";
import {
  SERVER_SNAPSHOT,
  clearGettingStarted,
  countDone,
  getSnapshot,
  resetGettingStarted,
  setGettingStartedHidden,
  STEP_IDS,
  subscribe,
} from "@/lib/onboarding/getting-started";
import { shortcutLabel } from "@/lib/shell/shortcuts";
import { useIsApple } from "@/components/shell/shortcuts";
import { clearConversations, conversationStats } from "@/lib/chat/history/store";
import { formatBytes } from "@/lib/chat/history/time";
import { clearRuntimeServers } from "@/lib/runtime/store";
import { LOCAL_DATA_GROUPS, browserStorages, clearLocalData, countLocalData, type LocalDataId } from "@/lib/storage/local-data";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, resetSettings, saveSettings } from "@/lib/storage/settings";
import { notify } from "@/lib/ui/notify";
import { cn } from "@/lib/utils";

const PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
const KEY_PLACEHOLDERS: Record<LLMProvider, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  openrouter: "sk-or-...",
};
const REPO_URL = "https://github.com/sguys99/mcp-connectors";
const SERVER_KEY_VARS = "ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY";

// 검증 메시지가 현재 언어를 따르도록 t 를 받아 스키마를 만든다.
// 서버 키를 쓸 수 있는 제공자는 브라우저 키를 비워 둘 수 있다.
function createFormSchema(t: Translator, serverKeys: Record<LLMProvider, boolean>) {
  return z
    .object({
      llmProvider: z.enum(PROVIDERS),
      anthropicApiKey: z.string(),
      openaiApiKey: z.string(),
      openrouterApiKey: z.string(),
      anthropicModel: z.string().trim().min(1, t("settings.modelRequired")),
      openaiModel: z.string().trim().min(1, t("settings.modelRequired")),
      openrouterModel: z.string().trim().min(1, t("settings.modelRequired")),
      systemPromptOverride: z.string(),
      maxIterations: z
        .number({ error: t("settings.maxIterationsRange", { min: MIN_ITERATIONS, max: MAX_ITERATIONS }) })
        .int(t("settings.maxIterationsRange", { min: MIN_ITERATIONS, max: MAX_ITERATIONS }))
        .min(MIN_ITERATIONS, t("settings.maxIterationsRange", { min: MIN_ITERATIONS, max: MAX_ITERATIONS }))
        .max(MAX_ITERATIONS, t("settings.maxIterationsRange", { min: MIN_ITERATIONS, max: MAX_ITERATIONS })),
    })
    .superRefine((values, ctx) => {
      for (const provider of PROVIDERS) {
        const field = `${provider}ApiKey` as const;
        if (values.llmProvider === provider && values[field].trim() === "" && !serverKeys[provider]) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: t("settings.keyRequired", { provider: PROVIDER_LABELS[provider] }),
          });
        }
      }
    });
}

type FormValues = z.infer<ReturnType<typeof createFormSchema>>;

// API keys 섹션에 속한 필드. 나머지 저장 대상 필드는 LLM 섹션이다 (섹션 칩의 변경 표시용).
const KEY_FIELDS = ["anthropicApiKey", "openaiApiKey", "openrouterApiKey"] as const satisfies readonly (keyof FormValues)[];

function valuesFromSettings(s: ReturnType<typeof loadSettings>): FormValues {
  return {
    llmProvider: s.llmProvider,
    anthropicApiKey: s.anthropicApiKey,
    openaiApiKey: s.openaiApiKey,
    openrouterApiKey: s.openrouterApiKey,
    anthropicModel: s.anthropicModel,
    openaiModel: s.openaiModel,
    openrouterModel: s.openrouterModel,
    systemPromptOverride: s.systemPromptOverride ?? "",
    maxIterations: s.maxIterations,
  };
}

const DEFAULT_FORM = valuesFromSettings(DEFAULT_SETTINGS);

interface SettingsViewProps {
  serverKeys: Record<LLMProvider, boolean>;
  serverKeysEnabled: boolean;
  version: string;
  sdkVersion: string;
}

export default function SettingsView({ serverKeys, serverKeysEnabled, version, sdkVersion }: SettingsViewProps) {
  const t = useT();
  const apple = useIsApple();
  const formSchema = useMemo(() => createFormSchema(t, serverKeys), [t, serverKeys]);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: DEFAULT_FORM });
  const { confirm, confirmDialog } = useConfirm();

  const [ready, setReady] = useState(false);
  // 저장된 값이 모델 목록에 없으면(예전 값) 목록 맨 앞에 더해 선택 상태가 사라지지 않게 한다.
  const [loadedModels, setLoadedModels] = useState({ anthropic: "", openai: "" });
  const [counts, setCounts] = useState<Record<LocalDataId, number> | null>(null);
  const [saved, setSaved] = useState<FormValues>(DEFAULT_FORM);

  // 저장된 Chat 대화 (IndexedDB). undefined 는 아직 읽는 중, null 은 이 브라우저에서 쓸 수 없음.
  const [conversations, setConversations] = useState<{ count: number; bytes: number } | null | undefined>(undefined);

  const refreshCounts = useCallback(() => {
    const { local, session } = browserStorages();
    setCounts(countLocalData(local, session));
    void conversationStats().then(setConversations);
  }, []);

  useEffect(() => {
    // React 19 의 react-hooks/set-state-in-effect 를 피하려고 macrotask 로 미룬다 (Dashboard HealthIndicator 와 같은 방식).
    const handle = setTimeout(() => {
      const s = loadSettings();
      const values = valuesFromSettings(s);
      form.reset(values);
      setSaved(values);
      setLoadedModels({ anthropic: s.anthropicModel, openai: s.openaiModel });
      refreshCounts();
      setReady(true);
    }, 0);
    return () => clearTimeout(handle);
    // form 은 안정적인 react-hook-form 인스턴스이고, 이 하이드레이션은 한 번만 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provider = useWatch({ control: form.control, name: "llmProvider" });
  const isDirty = form.formState.isDirty;

  // 저장하지 않은 변경이 있을 때 탭을 닫거나 새로 고치면 브라우저가 한 번 묻는다.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const onSubmit = form.handleSubmit((values) => {
    const trimmedPrompt = values.systemPromptOverride.trim();
    saveSettings({
      llmProvider: values.llmProvider,
      anthropicApiKey: values.anthropicApiKey.trim(),
      openaiApiKey: values.openaiApiKey.trim(),
      openrouterApiKey: values.openrouterApiKey.trim(),
      anthropicModel: values.anthropicModel.trim(),
      openaiModel: values.openaiModel.trim(),
      openrouterModel: values.openrouterModel.trim(),
      systemPromptOverride: trimmedPrompt.length > 0 ? trimmedPrompt : null,
      maxIterations: values.maxIterations,
    });
    const next = valuesFromSettings(loadSettings());
    setSaved(next);
    // 저장한 값을 새 기준으로 삼아 변경 표시를 지운다.
    form.reset(next);
    refreshCounts();
    notify.success(t("settings.saved", { time: new Date().toLocaleTimeString(t.locale) }));
  });

  // 입력칸 안에서도 동작해야 하므로 allowInInput. 대화상자가 열려 있으면 무시된다.
  useShortcut("mod+s", () => void onSubmit(), { enabled: ready, allowInInput: true });

  const handleRevert = () => {
    form.reset(saved);
    notify.info(t("settings.reverted"));
  };

  const handleResetSettings = async () => {
    const ok = await confirm({
      title: t("settings.resetTitle"),
      description: t("settings.confirmReset"),
      confirmLabel: t("settings.resetAction"),
      destructive: true,
    });
    if (!ok) return;
    resetSettings();
    setSaved(DEFAULT_FORM);
    form.reset(DEFAULT_FORM);
    setLoadedModels({ anthropic: "", openai: "" });
    refreshCounts();
    notify.success(t("toast.settingsReset"));
  };

  const handleResetAll = async () => {
    const ok = await confirm({
      title: t("settings.resetAllTitle"),
      description: t("settings.resetAllConfirm"),
      confirmLabel: t("settings.resetAllAction"),
      destructive: true,
    });
    if (!ok) return;
    const { local, session } = browserStorages();
    clearLocalData(local, session);
    // 시작하기와 런타임 서버는 메모리 캐시도 비워야 열려 있는 화면이 바로 따라간다.
    clearGettingStarted();
    clearRuntimeServers();
    await clearConversations();
    setSaved(DEFAULT_FORM);
    form.reset(DEFAULT_FORM);
    setLoadedModels({ anthropic: "", openai: "" });
    refreshCounts();
    notify.success(t("settings.resetAllDone"));
  };

  const gettingStarted = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const stepsDone = countDone(gettingStarted);

  const themeLabelId = useId();
  const languageLabelId = useId();

  const navItems: SectionNavItem[] = [
    { id: "llm", label: t("settings.navLlm") },
    { id: "keys", label: t("settings.navKeys") },
    { id: "appearance", label: t("settings.navAppearance") },
    { id: "onboarding", label: t("settings.navOnboarding") },
    { id: "data", label: t("settings.navData") },
    { id: "about", label: t("settings.navAbout") },
  ];
  // 저장이 필요한 두 섹션의 칩은 그 섹션 안에 저장하지 않은 변경이 있을 때만 경고 색의 "저장 안 한 변경"이 되고,
  // 평소에는 "저장 시 적용"(반영 방식)만 알린다. 아래 저장 표시줄의 상태와 어긋나지 않는다.
  const dirtyFields = form.formState.dirtyFields;
  const keysDirty = KEY_FIELDS.some((name) => dirtyFields[name]);
  const llmDirty = (Object.keys(dirtyFields) as (keyof FormValues)[]).some(
    (name) => dirtyFields[name] && !(KEY_FIELDS as readonly string[]).includes(name),
  );
  const saveMode = (dirty: boolean) =>
    dirty ? { label: t("settings.modeDirty"), tone: "warn" as const } : { label: t("settings.modeSave"), tone: "brand" as const };
  const instantMode = { label: t("settings.modeInstant"), tone: "neutral" as const };

  const modelSelect = (p: "anthropic" | "openai") => {
    const name = p === "anthropic" ? "anthropicModel" : "openaiModel";
    const base: readonly string[] = p === "anthropic" ? ANTHROPIC_MODELS : OPENAI_MODELS;
    return (
      <FormField
        key={p}
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <ModelLabel provider={p} active={provider === p} />
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {modelOptions(p, loadedModels[p]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {base.includes(m) ? m : t("settings.legacy", { model: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 py-4 min-[901px]:px-6 min-[901px]:py-6">
      <header className="mb-4 grid gap-1 min-[901px]:mb-5">
        <h1 className="font-heading text-xl leading-[30px] font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-fg-muted">{t("settings.description")}</p>
      </header>

      <div className="grid gap-4 min-[901px]:grid-cols-[160px_minmax(0,1fr)] min-[901px]:gap-8">
        <SectionNav items={navItems} />

        <div className="flex min-w-0 flex-col gap-4">
          <Form {...form}>
            <form id="settings-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <SettingsSection id="llm" title={t("settings.sectionLlm")} icon={BotIcon} mode={saveMode(llmDirty)}>
                <FormField
                  control={form.control}
                  name="llmProvider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.provider")}</FormLabel>
                      <FormDescription className="text-xs">{t("settings.providerHelp")}</FormDescription>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={(v) => field.onChange(v as LLMProvider)}
                          className="grid-cols-1 gap-2 min-[560px]:grid-cols-3"
                        >
                          {PROVIDERS.map((p) => (
                            <label
                              key={p}
                              className={cn(
                                "flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                                field.value === p ? "border-brand-border bg-brand-subtle text-brand-text" : "border-line hover:bg-surface-hover",
                              )}
                            >
                              <RadioGroupItem value={p} />
                              {PROVIDER_LABELS[p]}
                            </label>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 min-[701px]:grid-cols-2">
                  {modelSelect("anthropic")}
                  {modelSelect("openai")}
                  <FormField
                    control={form.control}
                    name="openrouterModel"
                    render={({ field }) => (
                      <FormItem className="min-[701px]:col-span-2">
                        <ModelLabel provider="openrouter" active={provider === "openrouter"} />
                        <FormControl>
                          <Input
                            name={field.name}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            placeholder="anthropic/claude-sonnet-4.6"
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">{t("settings.modelExamples")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="maxIterations"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.maxIterations")}</FormLabel>
                      <FormControl>
                        <Input
                          name={field.name}
                          type="number"
                          inputMode="numeric"
                          min={MIN_ITERATIONS}
                          max={MAX_ITERATIONS}
                          step={1}
                          value={Number.isNaN(field.value) ? "" : field.value}
                          onChange={(e) => field.onChange(e.target.value === "" ? Number.NaN : e.target.valueAsNumber)}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          className="w-24 font-mono"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">{t("settings.maxIterationsHelp")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="systemPromptOverride"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.systemPrompt")}</FormLabel>
                      <FormControl>
                        <Textarea
                          name={field.name}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          rows={6}
                          placeholder={t("settings.systemPromptPlaceholder")}
                          className="font-mono text-xs"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">{t("settings.systemPromptHelp")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsSection>

              <SettingsSection id="keys" title={t("settings.sectionKeys")} icon={KeyRoundIcon} mode={saveMode(keysDirty)}>
                <StorageNotice serverKeysEnabled={serverKeysEnabled} />
                {PROVIDERS.map((p) => {
                  const name = `${p}ApiKey` as const;
                  return (
                    <FormField
                      key={p}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <ApiKeyField
                          providerLabel={PROVIDER_LABELS[p]}
                          placeholder={KEY_PLACEHOLDERS[p]}
                          serverKeyAvailable={serverKeys[p]}
                          name={field.name}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          inputRef={field.ref}
                        />
                      )}
                    />
                  );
                })}
              </SettingsSection>
            </form>
          </Form>

          <SettingsSection id="appearance" title={t("settings.sectionAppearance")} icon={PaletteIcon} mode={instantMode}>
            <SettingRow label={t("settings.theme")} labelId={themeLabelId} help={t("settings.themeHelp")}>
              <ThemeControl labelledBy={themeLabelId} />
            </SettingRow>
            <SettingRow
              label={t("settings.language")}
              labelId={languageLabelId}
              help={t.rich("settings.languageHelp", { cookie: <Code>mcpc-lang</Code> })}
            >
              <LanguageControl labelledBy={languageLabelId} />
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="onboarding" title={t("settings.sectionOnboarding")} icon={RocketIcon} mode={instantMode}>
            <div className="grid gap-1">
              <p className="text-sm">{t("settings.onboardingHelp")}</p>
              <p className="text-xs text-fg-muted" role="status">
                {t(gettingStarted.hidden ? "settings.onboardingHidden" : "settings.onboardingShown", {
                  done: stepsDone,
                  total: STEP_IDS.length,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!gettingStarted.hidden}
                onClick={() => {
                  setGettingStartedHidden(false);
                  notify.success(t("settings.onboardingShownToast"));
                }}
              >
                {t("settings.onboardingShowAgain")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={stepsDone === 0}
                onClick={() => {
                  resetGettingStarted();
                  notify.success(t("settings.onboardingResetToast"));
                }}
              >
                {t("settings.onboardingReset")}
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection id="data" title={t("settings.sectionData")} icon={DatabaseIcon} mode={instantMode}>
            <p className="text-sm">{t("settings.dataHelp")}</p>
            <ul className="divide-y divide-line rounded-md border border-line">
              {LOCAL_DATA_GROUPS.map((group) => (
                <li key={group.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-[1_1_240px]">
                    <div className="text-sm font-medium">{t(`settings.data${capitalize(group.id)}` as DataLabelKey)}</div>
                    <div className="text-xs text-fg-muted">{t(`settings.data${capitalize(group.id)}Desc` as DataLabelKey)}</div>
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <Chip>{group.store === "local" ? "localStorage" : "sessionStorage"}</Chip>
                    {counts ? <Chip tone={counts[group.id] > 0 ? "brand" : "neutral"}>{t("settings.dataStored", { n: counts[group.id] })}</Chip> : null}
                  </div>
                </li>
              ))}
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-local-data="conversations">
                <div className="min-w-0 flex-[1_1_240px]">
                  <div className="text-sm font-medium">{t("settings.dataConversations")}</div>
                  <div className="text-xs text-fg-muted">{t("settings.dataConversationsDesc")}</div>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <Chip>IndexedDB</Chip>
                  {conversations === null ? (
                    <Chip tone="warn">{t("settings.dataConversationsUnavailable")}</Chip>
                  ) : conversations ? (
                    <Chip tone={conversations.count > 0 ? "brand" : "neutral"} data-conversations-stored>
                      {t("settings.dataConversationsStored", { n: conversations.count, size: formatBytes(conversations.bytes) })}
                    </Chip>
                  ) : null}
                </div>
              </li>
            </ul>
            <p className="text-xs text-fg-muted">{t("settings.dataKept")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleResetSettings}>
                {t("settings.resetDefaults")}
              </Button>
              <Button type="button" variant="destructive" onClick={handleResetAll}>
                {t("settings.resetAll")}
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection id="about" title={t("settings.sectionAbout")} icon={InfoIcon} mode={instantMode}>
            <dl className="grid gap-3 text-sm">
              <AboutRow term={t("settings.aboutVersion")}>
                <Code>{version}</Code>
              </AboutRow>
              <AboutRow term={t("settings.aboutSdk")}>
                <Code>{`@modelcontextprotocol/sdk ${sdkVersion}`}</Code>
              </AboutRow>
              <AboutRow term={t("settings.aboutRegistry")} help={t("settings.aboutRegistryHelp")}>
                <Code>configs/mcp_servers.yaml</Code>
              </AboutRow>
              <AboutRow term={t("settings.aboutProtocol")} help={t("settings.aboutProtocolHelp")}>
                <span className="text-fg-muted">MCP Streamable HTTP</span>
              </AboutRow>
              <AboutRow term={t("settings.aboutDocs")}>
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <ExternalLink href={`${REPO_URL}#readme`}>{t("settings.aboutReadme")}</ExternalLink>
                  <ExternalLink href={REPO_URL}>{t("settings.aboutRepo")}</ExternalLink>
                </span>
              </AboutRow>
            </dl>
          </SettingsSection>

          <div
            role="group"
            aria-label={t("settings.save")}
            className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line-strong bg-surface p-2 pl-3 shadow-md"
          >
            <p className="flex min-w-0 flex-[1_1_160px] items-center gap-2 text-xs" role="status">
              <span
                aria-hidden
                className={cn("size-2 flex-none rounded-full", isDirty ? "bg-warning-solid" : "bg-success-solid")}
              />
              {isDirty ? t("settings.dirty") : t("settings.clean")}
            </p>
            <Button type="button" variant="ghost" disabled={!isDirty} onClick={handleRevert}>
              {t("settings.revert")}
            </Button>
            <Button type="submit" form="settings-form" disabled={!ready}>
              {t("settings.save")}
              <Kbd className="max-[901px]:hidden">{shortcutLabel("mod+s", apple).join(apple ? "" : " ")}</Kbd>
            </Button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

type DataLabelKey = Parameters<Translator>[0];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ModelLabel({ provider, active }: { provider: LLMProvider; active: boolean }) {
  const t = useT();
  return (
    <FormLabel className="flex items-center gap-2">
      {t("settings.model", { provider: PROVIDER_LABELS[provider] })}
      {active ? <Chip tone="brand">{t("settings.providerActive")}</Chip> : null}
    </FormLabel>
  );
}

// API 키를 어디에 어떻게 두는지 알리는 안내. 문구는 실제 코드 동작에 맞춘다:
//   * 저장: lib/storage/settings.ts 가 localStorage(SETTINGS_KEY)에 JSON 평문으로 쓴다.
//   * 전송: Chat 이 요청 body 의 apiKey 로 /api/chat 에 보내고, 라우트는 제공자 SDK 호출에만 쓴다 (디스크, 로그 기록 없음).
//   * 서버 키: CHAT_ALLOW_SERVER_KEYS=true 일 때만 body 의 apiKey 가 비었으면 서버 env 키를 쓴다 (lib/llm/serverKeys.ts).
//   * MCP 키: 프록시(/api/mcp/[server])가 서버에서 X-MCP-API-Key 로 붙인다.
function StorageNotice({ serverKeysEnabled }: { serverKeysEnabled: boolean }) {
  const t = useT();
  return (
    <section
      aria-labelledby="storage-notice-title"
      className="grid gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning-fg"
    >
      <h3 id="storage-notice-title" className="flex items-center gap-2 font-semibold">
        <TriangleAlertIcon aria-hidden className="size-4 flex-none" />
        {t("settings.noticeTitle")}
      </h3>
      <p>{t.rich("settings.noticeStored", { key: <NoticeCode>{SETTINGS_KEY}</NoticeCode> })}</p>
      <p>{t.rich("settings.noticeSent", { route: <NoticeCode>/api/chat</NoticeCode> })}</p>
      <p>
        {t.rich("settings.noticeServer", {
          flag: <NoticeCode>CHAT_ALLOW_SERVER_KEYS=true</NoticeCode>,
          vars: <NoticeCode>{SERVER_KEY_VARS}</NoticeCode>,
          env: <NoticeCode>.env</NoticeCode>,
          local: <NoticeCode>frontend/.env.local</NoticeCode>,
        })}
      </p>
      <p>
        {t.rich("settings.noticeMcp", {
          var: <NoticeCode>MCP_API_KEY</NoticeCode>,
          proxy: <NoticeCode>/api/mcp/[server]</NoticeCode>,
        })}
      </p>
      <p className="font-medium">
        {serverKeysEnabled
          ? t("settings.serverKeysOn")
          : t.rich("settings.serverKeysOff", { flag: <NoticeCode>CHAT_ALLOW_SERVER_KEYS</NoticeCode> })}
      </p>
    </section>
  );
}

function NoticeCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded-xs bg-background/60 px-1 py-px font-mono text-[0.92em] break-words">{children}</code>;
}

function AboutRow({ term, help, children }: { term: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 min-[701px]:grid-cols-[140px_minmax(0,1fr)] min-[701px]:gap-4">
      <dt className="text-xs font-medium text-fg-muted">{term}</dt>
      <dd className="min-w-0">
        {children}
        {help ? <p className="mt-0.5 text-xs text-fg-muted">{help}</p> : null}
      </dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 items-center gap-1 text-brand-text underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      <ExternalLinkIcon aria-hidden className="size-3" />
    </a>
  );
}
