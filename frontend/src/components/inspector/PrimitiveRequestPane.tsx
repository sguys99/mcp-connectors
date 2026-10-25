"use client";

// Resources, Prompts 의 요청 패널. 도구 요청 패널(RequestPane)과 같은 머리, 본문, 실행 바 모양이다.
//   * resource: uri(읽기 전용)와 mime. template 이면 URI 변수 폼과 "읽을 URI" 미리보기
//   * prompt: 인자 폼 (필수/선택). 값은 모두 문자열이다 (prompts/get 규격)

import { FileIcon, MessageSquareIcon, PlugIcon } from "lucide-react";
import { useId } from "react";

import { Chip } from "@/components/ui/chip";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import type { FieldErrors, FieldSpec, FormValues } from "@/lib/inspector/args";
import type { PromptMeta, ResourceMeta, ResourceTemplateMeta } from "@/lib/mcp/types";

import { RunBar, type RunStatus } from "./RequestPane";
import { SchemaForm } from "./SchemaForm";

export type ResourceSelection =
  | { kind: "resource"; meta: ResourceMeta }
  | { kind: "template"; meta: ResourceTemplateMeta };

interface BaseProps {
  serverName: string;
  endpoint: string;
  fields: readonly FieldSpec[];
  values: FormValues;
  errors: FieldErrors;
  onField: (name: string, value: string | boolean) => void;
  status: RunStatus;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function ResourceRequestPane({
  selection,
  resolvedUri,
  ...base
}: BaseProps & { selection: ResourceSelection | null; resolvedUri: string }) {
  const t = useT();
  const uid = useId();

  if (!selection) {
    return <EmptyPane icon={<FileIcon aria-hidden />} title={t("inspector.pickResource")} hint={t("inspector.pickResourceHint")} />;
  }
  const meta = selection.meta;
  const title = meta.title || meta.name;
  const uri = selection.kind === "resource" ? selection.meta.uri : resolvedUri;

  return (
    <section aria-label={t("inspector.paneRequest")} className="flex h-full min-h-0 flex-col bg-surface">
      <Header method="resources/read" title={title} description={meta.description} serverName={base.serverName} endpoint={base.endpoint}>
        {selection.kind === "template" ? <Chip tone="info">{t("inspector.chipTemplate")}</Chip> : null}
        {meta.mimeType ? <Chip>{meta.mimeType}</Chip> : null}
      </Header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid gap-4">
          {selection.kind === "template" ? (
            <>
              <p className="text-2xs leading-4 text-fg-muted">{t("inspector.templateHint")}</p>
              <p className="font-mono text-xs [overflow-wrap:anywhere] text-fg-muted">{selection.meta.uriTemplate}</p>
              <SchemaForm toolName="" fields={base.fields} values={base.values} errors={base.errors} onChange={base.onField} />
            </>
          ) : null}
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${uid}-uri`} className="font-mono text-xs font-medium text-foreground">
                {selection.kind === "template" ? t("inspector.resolvedUri") : t("inspector.resourceUri")}
              </label>
              <Chip>string</Chip>
            </div>
            <Input id={`${uid}-uri`} readOnly value={uri} className="font-mono text-xs" data-testid="resource-uri" />
          </div>
        </div>
      </div>
      <RunBar status={base.status} onRun={base.onRun} onCancel={base.onCancel} onReset={base.onReset} runLabel={t("inspector.read")} />
    </section>
  );
}

export function PromptRequestPane({ prompt, ...base }: BaseProps & { prompt: PromptMeta | null }) {
  const t = useT();
  if (!prompt) {
    return <EmptyPane icon={<MessageSquareIcon aria-hidden />} title={t("inspector.pickPrompt")} hint={t("inspector.pickPromptHint")} />;
  }
  return (
    <section aria-label={t("inspector.paneRequest")} className="flex h-full min-h-0 flex-col bg-surface">
      <Header method="prompts/get" title={prompt.title || prompt.name} description={prompt.description} serverName={base.serverName} endpoint={base.endpoint} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {base.fields.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("inspector.noPromptArgs")}</p>
        ) : (
          <SchemaForm toolName="" fields={base.fields} values={base.values} errors={base.errors} onChange={base.onField} />
        )}
      </div>
      <RunBar status={base.status} onRun={base.onRun} onCancel={base.onCancel} onReset={base.onReset} runLabel={t("inspector.get")} />
    </section>
  );
}

function Header({
  method,
  title,
  description,
  serverName,
  endpoint,
  children,
}: {
  method: string;
  title: string;
  description?: string;
  serverName: string;
  endpoint: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="grid flex-none gap-1 border-b border-line px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 max-[1081px]:flex-nowrap max-[1081px]:gap-1.5">
        <Chip tone="brand" className="max-[1081px]:hidden">
          {method}
        </Chip>
        <h2 className="min-w-0 font-display text-md font-semibold [overflow-wrap:anywhere] max-[1081px]:flex-1 max-[1081px]:truncate max-[1081px]:text-sm max-[1081px]:tracking-tight max-[1081px]:[overflow-wrap:normal]">
          {title}
        </h2>
      </div>
      {description ? <p className="line-clamp-4 text-xs leading-[18px] text-fg-muted">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-1">
        <Chip tone="brand" className="hidden max-[1081px]:inline-flex">
          {method}
        </Chip>
        <Chip>
          <PlugIcon aria-hidden />
          {serverName}
        </Chip>
        {children}
        <Chip>POST {endpoint}</Chip>
      </div>
    </header>
  );
}

function EmptyPane({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  const t = useT();
  return (
    <section aria-label={t("inspector.paneRequest")} className="flex h-full min-h-0 flex-col bg-surface">
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{hint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
