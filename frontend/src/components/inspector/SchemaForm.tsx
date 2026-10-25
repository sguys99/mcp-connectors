"use client";

// inputSchema 에서 만든 폼. 값은 모두 문자열(체크박스만 boolean)로 들고 있고 변환과 검증은 lib/inspector/args.ts 가 맡는다.
//   * 필드마다: 이름, 타입 칩, 필수/선택, 기본값 도움말, 오류
//   * 정수는 입력 그대로 검사하고(12a, 1.5 는 오류), 배열은 한 줄에 하나
//   * SQL, query 같은 긴 입력은 여러 줄 입력칸. run_sql_query 에는 예시 칩이 붙는다.

import { useId } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import type { TKey } from "@/lib/i18n/translate";
import type { FieldError, FieldErrors, FieldSpec, FormValues } from "@/lib/inspector/args";
import { examplesFor } from "@/lib/inspector/examples";
import { cn } from "@/lib/utils";

const ERROR_KEY: Record<FieldError, TKey> = {
  required: "inspector.errRequired",
  integer: "inspector.errInteger",
  number: "inspector.errNumber",
  json: "inspector.errJson",
  enum: "inspector.errEnum",
};

interface SchemaFormProps {
  toolName: string;
  fields: readonly FieldSpec[];
  values: FormValues;
  errors: FieldErrors;
  onChange: (name: string, value: string | boolean) => void;
}

// 서버가 준 설명에 이미 기본값이 적혀 있으면("Default 1000" 등) 같은 말을 한 번 더 붙이지 않는다.
export function descriptionMentionsDefault(description: string | undefined): boolean {
  return !!description && /\bdefaults?\b|기본값?/i.test(description);
}

export function SchemaForm({ toolName, fields, values, errors, onChange }: SchemaFormProps) {
  const t = useT();
  const uid = useId();

  if (fields.length === 0) {
    return <p className="text-xs text-fg-muted">{t("inspector.noArgs")}</p>;
  }

  return (
    <div className="grid gap-4">
      {fields.map((field) => {
        const id = `${uid}-${field.name}`;
        const error = errors[field.name];
        const helpParts = [
          field.description,
          field.defaultValue !== undefined && field.defaultValue !== null && !descriptionMentionsDefault(field.description)
            ? t("inspector.defaultValue", { v: JSON.stringify(field.defaultValue) })
            : undefined,
          field.kind === "array" ? t("inspector.arrayHelp") : undefined,
        ].filter(Boolean);
        const describedBy = [error ? `${id}-e` : null, helpParts.length > 0 ? `${id}-h` : null].filter(Boolean).join(" ") || undefined;
        const examples = examplesFor(toolName, field.name);

        return (
          <div key={field.name} className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <label htmlFor={id} id={`${id}-l`} className="font-mono text-xs font-medium text-foreground">
                {field.name}
              </label>
              <Chip>{field.typeLabel}</Chip>
              {field.required ? (
                <span className="font-mono text-2xs text-danger-fg">{t("inspector.required")}</span>
              ) : (
                <span className="text-2xs text-fg-muted">{t("inspector.optional")}</span>
              )}
            </div>

            <FieldControl
              id={id}
              field={field}
              value={values[field.name]}
              invalid={Boolean(error)}
              describedBy={describedBy}
              onChange={(v) => onChange(field.name, v)}
            />

            {error ? (
              <p id={`${id}-e`} className="text-2xs leading-4 text-danger-fg">
                {t(ERROR_KEY[error])}
              </p>
            ) : null}
            {helpParts.length > 0 ? (
              <p id={`${id}-h`} className="text-2xs leading-4 text-fg-muted">
                {helpParts.map((part) => String(part).replace(/[.。]\s*$/, "")).join(". ")}
              </p>
            ) : null}

            {examples.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-2xs text-fg-muted">{t("inspector.examples")}</span>
                {examples.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => onChange(field.name, ex.sql)}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-2xs whitespace-nowrap text-fg-muted transition-colors hover:border-line-strong hover:text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 rounded-full", ex.tone === "ok" ? "bg-success-solid" : "bg-danger-solid")}
                    />
                    {t(ex.labelKey)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface FieldControlProps {
  id: string;
  field: FieldSpec;
  value: string | boolean | undefined;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: string | boolean) => void;
}

function FieldControl({ id, field, value, invalid, describedBy, onChange }: FieldControlProps) {
  const text = typeof value === "string" ? value : "";
  const placeholder =
    field.defaultValue !== undefined && field.defaultValue !== null && typeof field.defaultValue !== "object"
      ? String(field.defaultValue)
      : undefined;

  switch (field.kind) {
    case "boolean":
      return (
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
          aria-labelledby={`${id}-l`}
          aria-describedby={describedBy}
        />
      );

    case "enum":
      return (
        <Select value={text} onValueChange={(v) => onChange(typeof v === "string" ? v : "")}>
          <SelectTrigger
            id={id}
            className="w-full font-mono text-xs"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-labelledby={`${id}-l`}
          >
            <SelectValue placeholder="-" />
          </SelectTrigger>
          <SelectContent>
            {(field.enumValues ?? []).map((v) => (
              <SelectItem key={v} value={v}>
                <span className="font-mono text-xs">{v}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "integer":
    case "number":
      return (
        <Input
          id={id}
          type="text"
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs [font-variant-ligatures:none]"
        />
      );

    default:
      if (field.multiline) {
        const rows = field.kind === "string" ? 7 : field.kind === "json" ? 5 : 3;
        return (
          <Textarea
            id={id}
            rows={rows}
            spellCheck={false}
            value={text}
            placeholder={field.kind === "json" ? '{"key": "value"}' : placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs leading-5 [font-variant-ligatures:none]"
            style={{ minHeight: `${rows * 1.25 + 1}rem` }}
          />
        );
      }
      return (
        <Input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs [font-variant-ligatures:none]"
        />
      );
  }
}
