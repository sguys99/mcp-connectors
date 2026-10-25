"use client";

// 응답 내용 블록. content[i] 마다 머리(인덱스, 타입 칩, 크기, 복사)와 본문을 그린다.
//   * text: JSON 객체나 배열이면 구문 강조, 아니면 줄바꿈이 유지되는 일반 텍스트
//   * image, audio: 안전한 data: URL 일 때만 미리보기 (lib/inspector/content.ts::safeDataUrl). 아니면 차단 안내와 원본 JSON
//   * resource: 내장 리소스. 텍스트(JSON, Markdown, 일반)나 이진 데이터 정보. Markdown 은 Rendered/Raw 전환
//   * resource_link: uri, 이름, mime 만 (링크를 따라가지 않는다)
//   * 그 밖의 블록: 원본 JSON
// 서버가 준 값은 신뢰하지 않는다. HTML 은 해석하지 않고 텍스트로만 그린다.
// 구문 강조는 lib/inspector/json-tokens 가 나눈 토큰에 --syntax-* 색 토큰을 입힌다 (라이트와 다크 모두 대비 검사를 통과한 값).

import { BanIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ChatMarkdown } from "@/components/chat/LazyMarkdown";
import { CopyIconButton } from "@/components/dashboard/CopyCommand";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { useT } from "@/lib/i18n/client";
import { base64Bytes, isMarkdownMime, safeDataUrl } from "@/lib/inspector/content";
import { formatBytes, parseJsonContainer, tokenizeJson, type JsonTokenKind } from "@/lib/inspector/json-tokens";
import { cn } from "@/lib/utils";

// 이보다 긴 JSON 은 토큰 수만큼 DOM 이 늘어 느려지므로 강조 없이 그린다.
const HIGHLIGHT_MAX_CHARS = 120_000;

const TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-(--syntax-key)",
  string: "text-(--syntax-string)",
  number: "text-(--syntax-number)",
  boolean: "text-(--syntax-boolean)",
  null: "text-(--syntax-null)",
  punct: "text-(--syntax-punct)",
  space: "",
};

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export function JsonCode({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const large = text.length > HIGHLIGHT_MAX_CHARS;
  const tokens = useMemo(() => (large ? null : tokenizeJson(text)), [text, large]);
  return (
    <>
      <pre
        tabIndex={0}
        className={cn(
          "max-h-[420px] overflow-auto bg-surface-sunken p-3 font-mono text-xs leading-5 whitespace-pre text-foreground [font-variant-ligatures:none]",
          className,
        )}
      >
        {tokens
          ? tokens.map((tok, i) =>
              tok.kind === "space" ? tok.text : (
                <span key={i} className={TOKEN_CLASS[tok.kind]}>
                  {tok.text}
                </span>
              ),
            )
          : text}
      </pre>
      {large ? <p className="border-t border-line bg-background px-3 py-1 text-2xs text-fg-muted">{t("inspector.plainLarge")}</p> : null}
    </>
  );
}

function PlainText({ text }: { text: string }) {
  return (
    <pre
      tabIndex={0}
      className="max-h-[420px] overflow-auto bg-surface-sunken p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground [font-variant-ligatures:none]"
    >
      {text}
    </pre>
  );
}

interface BlockFrameProps {
  index: string;
  type: string;
  tone?: ChipTone;
  meta?: string;
  size?: string;
  copyText?: string;
  // 머리 오른쪽에 붙는 조작 (Rendered/Raw 전환 등)
  actions?: React.ReactNode;
  children: React.ReactNode;
}

function BlockFrame({ index, type, tone, meta, size, copyText, actions, children }: BlockFrameProps) {
  const t = useT();
  return (
    <div data-block={type} className="min-w-0 overflow-hidden rounded-md border border-line">
      <div className="flex min-w-0 items-center gap-2 border-b border-line bg-background py-[3px] pr-1.5 pl-3 font-mono text-2xs whitespace-nowrap text-fg-muted [&>button]:flex-none max-[1081px]:gap-1.5 max-[1081px]:pl-2">
        <span className="min-w-0 shrink-[2] truncate">{index}</span>
        <Chip tone={tone} className="flex-none">
          {type}
        </Chip>
        {/* 조작(Rendered/Raw)이 있는 블록은 mime 을 본문 줄에 보여 주고, 머리는 좁은 폭에서도 복사 버튼이 잘리지 않게 비운다 */}
        <span className="min-w-0 flex-1 truncate" title={meta}>
          {actions ? null : meta}
        </span>
        {size ? <span className={cn("flex-none tabular-nums", actions && "max-[1081px]:hidden")}>{size}</span> : null}
        {actions}
        {copyText !== undefined ? <CopyIconButton text={copyText} label={t("inspector.copyBlock")} /> : null}
      </div>
      {children}
    </div>
  );
}

type Block = Record<string, unknown>;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

// 텍스트 본문. JSON 이면 강조, Markdown mime 이면 Rendered/Raw 전환, 그 밖에는 일반 텍스트.
function useTextBody(text: string, mimeType: string) {
  const t = useT();
  const parsed = useMemo(() => parseJsonContainer(text), [text]);
  const markdown = isMarkdownMime(mimeType);
  const [raw, setRaw] = useState(false);
  const body = parsed ? (
    <JsonCode text={JSON.stringify(parsed, null, 2)} />
  ) : markdown && !raw ? (
    <div className="max-h-[420px] overflow-auto bg-surface p-3" data-rendered="markdown">
      <ChatMarkdown text={text} untrusted className="text-sm" />
    </div>
  ) : (
    <PlainText text={text} />
  );
  const actions = markdown ? (
    <span role="group" aria-label={t("inspector.viewMode")} className="flex flex-none overflow-hidden rounded-sm border border-line">
      {([false, true] as const).map((isRaw) => (
        <button
          key={String(isRaw)}
          type="button"
          aria-pressed={raw === isRaw}
          onClick={() => setRaw(isRaw)}
          className={cn(
            "h-6 min-w-6 px-1.5 text-2xs outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            raw === isRaw ? "bg-muted text-foreground" : "text-fg-muted hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {t(isRaw ? "inspector.viewRaw" : "inspector.viewRendered")}
        </button>
      ))}
    </span>
  ) : null;
  return { body, actions };
}

function TextBlock({ label, text, mimeType, meta, type, tone, copyText }: { label: string; text: string; mimeType: string; meta?: string; type: string; tone?: ChipTone; copyText?: string }) {
  const { body, actions } = useTextBody(text, mimeType);
  return (
    <BlockFrame index={label} type={type} tone={tone} meta={meta} size={formatBytes(byteLength(text))} copyText={copyText ?? text} actions={actions}>
      {body}
    </BlockFrame>
  );
}

// 안전하지 않은 미디어 블록: 데이터를 자르고 원본 JSON 만 보여 준다.
function BlockedMedia({ block }: { block: Block }) {
  const t = useT();
  const shown = { ...block } as Block;
  for (const key of ["data", "blob"]) if (typeof shown[key] === "string") shown[key] = `${(shown[key] as string).slice(0, 32)}…`;
  return (
    <div className="grid gap-2 p-3">
      <p role="note" className="flex items-center gap-1.5 text-2xs text-warning-fg">
        <BanIcon aria-hidden className="size-3.5 flex-none" />
        {t("inspector.mediaBlocked")}
      </p>
      <div className="overflow-hidden rounded-sm border border-line">
        <JsonCode text={JSON.stringify(shown, null, 2)} className="max-h-40" />
      </div>
    </div>
  );
}

function MediaBlock({ block, label, kind, uri }: { block: Block; label: string; kind: "image" | "audio"; uri?: string }) {
  const t = useT();
  const data = asString(block.data) || asString(block.blob);
  const mime = asString(block.mimeType);
  const src = safeDataUrl(kind, mime, data);
  const size = formatBytes(base64Bytes(data));
  return (
    <BlockFrame index={label} type={kind} tone="info" meta={uri ? `${mime} ${uri}` : mime} size={size}>
      {src ? (
        <div className="grid place-items-center bg-surface-sunken p-4">
          {kind === "image" ? (
            // data URI 라 next/image 의 최적화 대상이 아니다
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={uri ? t("inspector.imageAltUri", { uri }) : t("inspector.imageAlt")} src={src} className="block h-auto max-h-60 max-w-full" />
          ) : (
            <audio controls src={src} aria-label={uri ?? t("inspector.audioLabel")} className="w-full max-w-md" />
          )}
        </div>
      ) : (
        <BlockedMedia block={block} />
      )}
    </BlockFrame>
  );
}

export function ContentBlock({
  block,
  index,
  prefix = "content",
  label: labelOverride,
}: {
  block: unknown;
  index: number;
  prefix?: string;
  // 머리에 보이는 이름을 직접 정할 때 (예: messages[0].content)
  label?: string;
}) {
  const t = useT();
  const label = labelOverride ?? `${prefix}[${index}]`;
  const b: Block = block && typeof block === "object" ? (block as Block) : { value: block };
  const type = asString(b.type);

  if (type === "text" && typeof b.text === "string") {
    return <TextBlock label={label} text={b.text} mimeType="" type="text" />;
  }

  if (type === "image" && typeof b.data === "string") {
    return <MediaBlock block={b} label={label} kind="image" uri={asString(b.uri) || undefined} />;
  }

  if (type === "audio" && typeof b.data === "string") {
    return <MediaBlock block={b} label={label} kind="audio" uri={asString(b.uri) || undefined} />;
  }

  if (type === "resource" && b.resource && typeof b.resource === "object") {
    const r = b.resource as Block;
    const mime = asString(r.mimeType);
    const uri = asString(r.uri);
    if (typeof r.text === "string") {
      return <EmbeddedText label={label} uri={uri} mime={mime} text={r.text} />;
    }
    if (typeof r.blob === "string") {
      // 내장 이진 리소스: 이미지면 미리보기, 그 밖에는 크기와 mime 만
      const image = safeDataUrl("image", mime, r.blob);
      if (image) return <MediaBlock block={{ ...r, type: "image" }} label={label} kind="image" uri={uri} />;
      if (safeDataUrl("audio", mime, r.blob)) return <MediaBlock block={{ ...r, type: "audio" }} label={label} kind="audio" uri={uri} />;
      return (
        <BlockFrame index={label} type="resource" tone="brand" meta={mime} size={formatBytes(base64Bytes(r.blob))}>
          <div className="grid gap-1 p-3 text-xs">
            <span className="font-mono [overflow-wrap:anywhere] text-brand-text">{uri}</span>
            <span className="text-fg-muted">{t("inspector.binaryNote")}</span>
          </div>
        </BlockFrame>
      );
    }
  }

  if (type === "resource_link") {
    const title = asString(b.title) || asString(b.name);
    return (
      <BlockFrame index={label} type="resource_link" tone="brand" meta={asString(b.mimeType)} copyText={asString(b.uri)}>
        <div className="grid gap-1 p-3 text-xs">
          {title ? <b className="font-medium">{title}</b> : null}
          <span className="font-mono [overflow-wrap:anywhere] text-brand-text">{asString(b.uri)}</span>
          {asString(b.description) ? <span className="text-fg-muted">{asString(b.description)}</span> : null}
        </div>
      </BlockFrame>
    );
  }

  const json = JSON.stringify(b, null, 2);
  return (
    <BlockFrame index={label} type={type || "block"} size={formatBytes(byteLength(json))} copyText={json}>
      <JsonCode text={json} />
    </BlockFrame>
  );
}

// 내장 텍스트 리소스: uri 줄 아래에 본문 (JSON, Markdown, 일반)
function EmbeddedText({ label, uri, mime, text }: { label: string; uri: string; mime: string; text: string }) {
  const { body, actions } = useTextBody(text, mime);
  return (
    <BlockFrame index={label} type="resource" tone="brand" meta={mime} size={formatBytes(byteLength(text))} copyText={text} actions={actions}>
      <div className="grid gap-2 p-3 text-xs">
        <span className="font-mono [overflow-wrap:anywhere] text-brand-text">
          {uri}
          {mime ? <span className="ml-2 text-fg-muted">{mime}</span> : null}
        </span>
        <div className="overflow-hidden rounded-sm border border-line">{body}</div>
      </div>
    </BlockFrame>
  );
}

export function StructuredBlock({ value }: { value: unknown }) {
  const t = useT();
  const json = JSON.stringify(value, null, 2) ?? "null";
  return (
    <BlockFrame
      index={t("inspector.structured")}
      type={Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : typeof value}
      size={formatBytes(byteLength(json))}
      copyText={json}
    >
      <JsonCode text={json} />
    </BlockFrame>
  );
}
