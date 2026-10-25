"use client";

// 런타임 서버 추가/수정 대화상자 (Phase 5, P5-5). 이름, Streamable HTTP URL, 헤더, 연결 방식을 받고
// initialize 로 연결을 확인한 뒤 이 탭의 세션에 저장한다 (sessionStorage, 탭을 닫으면 사라짐).
//
// 연결 방식
//   * 브라우저 직결 (기본): 브라우저가 대상 URL 에 직접 붙는다. 대상 서버가 CORS 로 이 앱의 origin 을 허용하고 mcp-session-id 를 노출해야 한다.
//   * 서버 프록시: 서버 env MCP_ALLOW_RUNTIME_PROXY=true 일 때만 고를 수 있다. CORS 가 없는 서버와 Chat 에서 쓴다.
// 헤더 값은 가려서 입력하고 (눈 아이콘으로 보기), 화면, 로그, 내보내기, localStorage 에 남기지 않는다.

import { CheckCircle2Icon, EyeIcon, EyeOffIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n";
import { createMCPClient } from "@/lib/mcp/client";
import { toRuntimeServer } from "@/lib/runtime/connection";
import { describeNetworkFailure } from "@/lib/runtime/errors";
import { MAX_RUNTIME_HEADERS, checkHttpUrl } from "@/lib/runtime/guards";
import { MAX_RUNTIME_SERVERS } from "@/lib/runtime/storage";
import { addRuntimeServer, findRuntimeServer, updateRuntimeServer } from "@/lib/runtime/store";
import type { RuntimeMode, RuntimeServerDef } from "@/lib/runtime/types";
import { useRuntimeServers } from "@/lib/runtime/use-runtime-servers";
import { MAX_NAME_LENGTH, cleanHeaders, suggestName, validateDraft, type DraftErrors } from "@/lib/runtime/validate";
import { notify } from "@/lib/ui/notify";
import { cn } from "@/lib/utils";

const CONNECT_TIMEOUT_MS = 8_000;

export function AddServerDialog() {
  const { serverDialog, closeServerDialog } = useShell();
  const t = useT();
  const editing = serverDialog?.mode === "edit" ? serverDialog.name : null;
  return (
    <Dialog open={serverDialog !== null} onOpenChange={(open) => !open && closeServerDialog()}>
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 min-[901px]:max-w-lg max-[901px]:overflow-hidden max-[901px]:pb-[env(safe-area-inset-bottom,0px)]"
        data-dialog="add-server"
      >
        <DialogHeader className="p-4 pr-12 pb-3">
          <DialogTitle>{editing ? t("runtime.editTitle", { name: editing }) : t("runtime.addTitle")}</DialogTitle>
          <DialogDescription>{t("runtime.addDescription")}</DialogDescription>
        </DialogHeader>
        {/* 열릴 때마다 새로 마운트해 입력 상태를 초기화한다 */}
        {serverDialog ? <ServerForm editing={editing} onDone={closeServerDialog} /> : null}
      </DialogContent>
    </Dialog>
  );
}

interface HeaderRow {
  id: number;
  name: string;
  value: string;
  shown: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "connecting"; url: string }
  | { kind: "error"; message: string; detail?: string }
  | { kind: "connected"; name: string };

const NAME_ERRORS: Record<NonNullable<DraftErrors["name"]>, TKey> = {
  empty: "runtime.errNameEmpty",
  format: "runtime.errNameFormat",
  tooLong: "runtime.errNameLong",
  taken: "runtime.errNameTaken",
};
const URL_ERRORS: Record<NonNullable<DraftErrors["url"]>, TKey> = {
  empty: "runtime.errUrlEmpty",
  invalid: "runtime.errUrlInvalid",
  scheme: "runtime.errUrlScheme",
  credentials: "runtime.errUrlCredentials",
  tooLong: "runtime.errUrlLong",
};
const HEADER_NAME_ERRORS: Record<string, TKey> = {
  empty: "runtime.errHeaderNameEmpty",
  invalid: "runtime.errHeaderNameInvalid",
  reserved: "runtime.errHeaderNameReserved",
  duplicate: "runtime.errHeaderNameDuplicate",
};
const HEADER_VALUE_ERRORS: Record<string, TKey> = {
  invalid: "runtime.errHeaderValueInvalid",
  tooLong: "runtime.errHeaderValueLong",
};

function ServerForm({ editing, onDone }: { editing: string | null; onDone: () => void }) {
  const t = useT();
  const { servers, runtimeProxyEnabled } = useShell();
  const runtime = useRuntimeServers();
  const baseId = useId();
  // 새 행의 id 는 처음 채운 행(0부터 순번)과 겹치지 않게 1000 부터
  const nextRowId = useRef(1000);
  const original = editing ? findRuntimeServer(editing) : undefined;

  const [name, setName] = useState(original?.name ?? "");
  // 이름을 직접 고치기 전에는 URL 로 이름을 추천한다
  const [nameTouched, setNameTouched] = useState(Boolean(original));
  const [url, setUrl] = useState(original?.url ?? "");
  const [mode, setMode] = useState<RuntimeMode>(original && (original.mode === "direct" || runtimeProxyEnabled) ? original.mode : "direct");
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    (original?.headers ?? []).map((h, i) => ({ id: i, name: h.name, value: h.value, shown: false })),
  );
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // 연결 실패 안내가 나타나면 (긴 폼은 대화상자 안에서 스크롤된다) 보이는 곳으로 가져온다
  useEffect(() => {
    if (status.kind === "error") errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [status]);

  const registryNames = servers.filter((s) => !(s.transport === "streamable_http" && s.runtime)).map((s) => s.name);
  const ctx = { registryNames, runtimeNames: runtime.map((d) => d.name), editing };
  const draft = { name, url, headers: rows.map((r) => ({ name: r.name, value: r.value })) };
  const { valid, errors } = validateDraft(draft, ctx);
  const limitReached = !editing && runtime.length >= MAX_RUNTIME_SERVERS;
  const busy = status.kind === "connecting";
  const show = (cond: boolean) => submitted && cond;

  const updateRow = (id: number, patch: Partial<HeaderRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  function buildDef(): Omit<RuntimeServerDef, "rev"> {
    const checked = checkHttpUrl(url);
    return {
      name: name.trim(),
      url: checked.ok ? checked.url : url.trim(),
      headers: cleanHeaders(rows.map((r) => ({ name: r.name, value: r.value }))),
      mode,
    };
  }

  function save(def: Omit<RuntimeServerDef, "rev">): boolean {
    const ok = editing ? updateRuntimeServer(editing, def) : addRuntimeServer(def);
    if (!ok) setStatus({ kind: "error", message: t("runtime.errSave") });
    return ok;
  }

  async function submit(skipConnect: boolean) {
    setSubmitted(true);
    if (!valid || limitReached || busy) {
      // 첫 번째 잘못된 입력으로 포커스를 옮긴다
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const def = buildDef();
    if (skipConnect) {
      if (save(def)) finish(def.name, false);
      return;
    }
    setStatus({ kind: "connecting", url: def.url });
    const client = createMCPClient(toRuntimeServer({ ...def, rev: 0 }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t("errors.pingTimeout", { s: CONNECT_TIMEOUT_MS / 1000 }))), CONNECT_TIMEOUT_MS);
      });
      const result = await Promise.race([client.ping(), timeout]);
      if (result.ok) {
        if (save(def)) finish(def.name, true);
        return;
      }
      const friendly = describeNetworkFailure(
        { transport: "streamable_http", runtime: { mode: def.mode, target: def.url } },
        result.errorKind,
        t,
      );
      setStatus({ kind: "error", message: friendly ?? t("runtime.errConnect"), detail: result.error });
    } catch (err) {
      setStatus({ kind: "error", message: t("runtime.errConnect"), detail: err instanceof Error ? err.message : String(err) });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      void client.close().catch(() => undefined);
    }
  }

  function finish(savedName: string, connected: boolean) {
    notify.success(connected ? t("runtime.connectedToast", { name: savedName }) : t("runtime.addedToast", { name: savedName }));
    setStatus({ kind: "connected", name: savedName });
    onDone();
  }

  const nameId = `${baseId}-name`;
  const urlId = `${baseId}-url`;
  const showNameError = show(Boolean(errors.name));
  const showUrlError = show(Boolean(errors.url));

  return (
    <form
      ref={formRef}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      {/* 본문만 스크롤하고 버튼 줄은 항상 아래에 보인다 (키 작은 화면과 모바일 시트에서도 "연결하고 추가"가 가려지지 않게) */}
      <div className="grid gap-4 overflow-y-auto px-4 pb-4">
      <div className="grid gap-1.5">
        <Label htmlFor={urlId}>{t("runtime.url")}</Label>
        <Input
          id={urlId}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="http://localhost:8001/mcp"
          className="font-mono"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (!nameTouched) setName(suggestName(e.target.value));
          }}
          aria-invalid={showUrlError || undefined}
          aria-describedby={showUrlError ? `${urlId}-err` : `${urlId}-hint`}
          data-field="url"
        />
        {showUrlError ? (
          <FieldMessage id={`${urlId}-err`} tone="error">{t(URL_ERRORS[errors.url!])}</FieldMessage>
        ) : (
          <FieldMessage id={`${urlId}-hint`}>{t("runtime.urlHint")}</FieldMessage>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>{t("runtime.name")}</Label>
        <Input
          id={nameId}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={MAX_NAME_LENGTH + 10}
          placeholder="my-server"
          className="font-mono"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          aria-invalid={showNameError || undefined}
          aria-describedby={showNameError ? `${nameId}-err` : `${nameId}-hint`}
          data-field="name"
        />
        {showNameError ? (
          <FieldMessage id={`${nameId}-err`} tone="error">{t(NAME_ERRORS[errors.name!])}</FieldMessage>
        ) : (
          <FieldMessage id={`${nameId}-hint`}>{t("runtime.nameHint")}</FieldMessage>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm leading-none font-medium">{t("runtime.transport")}</span>
        <p className="font-mono text-xs text-fg-muted">{t("runtime.transportValue")}</p>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm leading-none font-medium">{t("runtime.mode")}</legend>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as RuntimeMode)} aria-label={t("runtime.mode")}>
          <ModeOption
            id={`${baseId}-direct`}
            value="direct"
            label={t("runtime.modeDirect")}
            hint={t("runtime.modeDirectHint")}
          />
          <ModeOption
            id={`${baseId}-proxy`}
            value="proxy"
            label={t("runtime.modeProxy")}
            hint={runtimeProxyEnabled ? t("runtime.modeProxyHint") : t("runtime.modeProxyOff")}
            disabled={!runtimeProxyEnabled}
          />
        </RadioGroup>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm leading-none font-medium">{t("runtime.headers")}</legend>
        {rows.length === 0 ? <p className="text-xs text-fg-muted">{t("runtime.headersEmpty")}</p> : null}
        {rows.map((row, index) => {
          const rowErr = errors.headers[index] ?? {};
          const nameErr = show(Boolean(rowErr.name)) ? rowErr.name : undefined;
          const valueErr = show(Boolean(rowErr.value)) ? rowErr.value : undefined;
          const hid = `${baseId}-h${row.id}`;
          return (
            <div key={row.id} className="grid gap-1" data-header-row>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto] items-center gap-1.5 max-[520px]:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  aria-label={t("runtime.headerName", { n: index + 1 })}
                  placeholder="X-API-Key"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="font-mono max-[520px]:col-span-3"
                  value={row.name}
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                  aria-invalid={nameErr ? true : undefined}
                  aria-describedby={nameErr ? `${hid}-nerr` : undefined}
                  data-field="header-name"
                />
                <Input
                  aria-label={t("runtime.headerValue", { n: index + 1 })}
                  type={row.shown ? "text" : "password"}
                  placeholder={t("runtime.headerValuePlaceholder")}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="font-mono max-[520px]:col-span-1"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  aria-invalid={valueErr ? true : undefined}
                  aria-describedby={valueErr ? `${hid}-verr` : undefined}
                  data-field="header-value"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // 이름이 Show/Hide 로 바뀌어 상태를 알린다 (aria-pressed 와 겹치지 않게).
                  aria-label={t(row.shown ? "runtime.hideValue" : "runtime.showValue", { n: index + 1 })}
                  title={t(row.shown ? "runtime.hideValue" : "runtime.showValue", { n: index + 1 })}
                  onClick={() => updateRow(row.id, { shown: !row.shown })}
                >
                  {row.shown ? <EyeOffIcon /> : <EyeIcon />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("runtime.removeHeader", { n: index + 1 })}
                  title={t("runtime.removeHeader", { n: index + 1 })}
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                >
                  <XIcon />
                </Button>
              </div>
              {nameErr ? <FieldMessage id={`${hid}-nerr`} tone="error">{t(HEADER_NAME_ERRORS[nameErr]!)}</FieldMessage> : null}
              {valueErr ? <FieldMessage id={`${hid}-verr`} tone="error">{t(HEADER_VALUE_ERRORS[valueErr]!)}</FieldMessage> : null}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length >= MAX_RUNTIME_HEADERS}
            onClick={() => setRows((prev) => [...prev, { id: nextRowId.current++, name: "", value: "", shown: false }])}
            data-action="add-header"
          >
            <PlusIcon aria-hidden />
            {t("runtime.addHeader")}
          </Button>
        </div>
        <FieldMessage>{mode === "direct" ? t("runtime.headersNoteDirect") : t("runtime.headersNoteProxy")}</FieldMessage>
      </fieldset>

      <div role="status" aria-live="polite" className="min-h-0 text-xs" data-connect-status={status.kind}>
        {status.kind === "connecting" ? (
          <p className="flex items-center gap-2 text-fg-muted">
            <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
            {t("runtime.connecting", { url: status.url })}
          </p>
        ) : null}
        {status.kind === "connected" ? (
          <p className="flex items-center gap-2 text-success-fg">
            <CheckCircle2Icon aria-hidden className="size-3.5" />
            {t("runtime.connectedOk", { name: status.name })}
          </p>
        ) : null}
      </div>
      {status.kind === "error" ? (
        <div ref={errorRef} role="alert" className="grid gap-1.5 rounded-md border border-danger-border bg-danger-bg p-3 text-xs leading-[18px] text-foreground" data-connect-error>
          <p className="flex items-start gap-2 font-medium text-danger-fg">
            <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{status.message}</span>
          </p>
          {status.detail ? <p className="font-mono text-2xs break-words text-fg-muted">{status.detail}</p> : null}
        </div>
      ) : null}

      {limitReached ? <p className="text-xs text-danger-fg">{t("runtime.limitReached", { n: MAX_RUNTIME_SERVERS })}</p> : null}

      <p className="rounded-md border border-line bg-surface-sunken p-2.5 text-xs leading-[18px] text-fg-muted" data-session-note>
        {t("runtime.sessionNote")}
      </p>

      </div>

      <DialogFooter className="m-0 flex-none">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        {status.kind === "error" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(true)} data-action="add-anyway">
            {t("runtime.addAnyway")}
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || limitReached} data-action="connect-add">
          {busy ? t("runtime.connectingShort") : editing ? t("runtime.saveConnect") : t("runtime.connectAdd")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldMessage({ id, tone, children }: { id?: string; tone?: "error"; children: ReactNode }) {
  return (
    <p id={id} className={cn("text-xs leading-4", tone === "error" ? "text-danger-fg" : "text-fg-muted")}>
      {children}
    </p>
  );
}

function ModeOption({
  id,
  value,
  label,
  hint,
  disabled,
}: {
  id: string;
  value: RuntimeMode;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    // 비활성은 투명도 대신 점선 테두리와 바탕으로 보여 준다. 안내 문구(왜 꺼졌는지)는 읽혀야 해서 대비를 낮추지 않는다 (P5-10 감사).
    <div className={cn("flex items-start gap-2.5 rounded-md border border-line p-2.5", disabled && "border-dashed bg-surface-sunken")} data-disabled={disabled || undefined}>
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" aria-describedby={`${id}-hint`} data-mode={value} />
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={id} className="text-sm leading-snug">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs leading-4 text-fg-muted">
          {hint}
        </p>
      </div>
    </div>
  );
}
