"use client";

import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "lucide-react";
import { useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { describeKey } from "@/lib/settings/keys";

interface ApiKeyFieldProps {
  providerLabel: string;
  placeholder: string;
  serverKeyAvailable: boolean;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
}

// API 키 입력칸 하나: 가려진 입력, 보기/숨기기, 지우기, 설정 여부와 끝 4자리 표시.
// react-hook-form 의 FormField 안에서 쓴다 (FormItem 컨텍스트가 필요하다).
export function ApiKeyField({
  providerLabel,
  placeholder,
  serverKeyAvailable,
  name,
  value,
  onChange,
  onBlur,
  inputRef,
}: ApiKeyFieldProps) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const hint = describeKey(value);

  return (
    <FormItem>
      <FormLabel>{t("settings.apiKey", { provider: providerLabel })}</FormLabel>
      <div className="flex items-center gap-1.5">
        <FormControl>
          <Input
            type={shown ? "text" : "password"}
            name={name}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            ref={inputRef}
            placeholder={placeholder}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
          />
        </FormControl>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-label={t(shown ? "settings.hideKey" : "settings.showKey", { provider: providerLabel })}
          title={t(shown ? "settings.hideKey" : "settings.showKey", { provider: providerLabel })}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={value === ""}
          onClick={() => {
            onChange("");
            setShown(false);
          }}
          aria-label={t("settings.clearKey", { provider: providerLabel })}
          title={t("settings.clearKey", { provider: providerLabel })}
        >
          <XIcon />
        </Button>
      </div>
      <FormDescription className="flex flex-wrap items-center gap-1.5 text-xs">
        {hint.configured ? (
          <Chip tone="ok">
            <CheckIcon aria-hidden />
            {t("settings.keyConfigured")}
            {hint.last4 ? `, ${t("settings.keyEnds", { last4: hint.last4 })}` : ""}
          </Chip>
        ) : (
          <Chip>{t("settings.keyNotSet")}</Chip>
        )}
        {serverKeyAvailable ? <Chip tone="info">{t("settings.keyServer")}</Chip> : null}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}
