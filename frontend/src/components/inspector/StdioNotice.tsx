"use client";

// stdio 서버를 선택했을 때의 안내. 브라우저는 프록시로 Streamable HTTP 서버만 부를 수 있어서,
// 터미널에서 쓸 명령(복사 가능)과 HTTP 쌍둥이 서버로 가는 버튼을 보여 준다.

import { ArrowRightIcon, TerminalIcon } from "lucide-react";
import Link from "next/link";

import { CommandLine } from "@/components/dashboard/CopyCommand";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useLocale, useT } from "@/lib/i18n/client";
import { cliCommands } from "@/lib/inspector/cli";
import { pickDescription } from "@/lib/mcp/description";

interface StdioNoticeProps {
  name: string;
  description?: string;
  descriptionKo?: string;
  // 브라우저에서 부를 수 있는 "<name>-http" 서버 이름 (없으면 null)
  twin: string | null;
}

export function StdioNotice({ name, description, descriptionKo, twin }: StdioNoticeProps) {
  const t = useT();
  const locale = useLocale();
  const commands = cliCommands(name);
  const desc = pickDescription({ description, descriptionKo }, locale);

  return (
    <section aria-label={name} className="h-full overflow-y-auto bg-surface p-6 max-[901px]:p-4">
      <div className="mx-auto grid max-w-[560px] gap-3">
        <div className="flex items-center gap-2">
          <Chip>stdio</Chip>
          <h2 className="font-display text-md font-semibold [overflow-wrap:anywhere]">{name}</h2>
        </div>
        {desc ? <p className="text-xs leading-[18px] text-fg-muted">{desc}</p> : null}

        <div className="mt-2 flex items-center gap-2">
          <TerminalIcon aria-hidden className="size-4 text-fg-muted" />
          <h3 className="text-sm font-medium">{t("inspector.stdioTitle")}</h3>
        </div>
        <p className="text-xs leading-5 text-fg-muted">{t("inspector.stdioBody")}</p>

        <CommandLine command={commands.call} label={t("inspector.copyCallCommand")} />
        <CommandLine command={commands.list} label={t("inspector.copyListCommand")} />

        {twin ? (
          <div className="pt-1">
            <Link
              href={`/inspector?server=${encodeURIComponent(twin)}`}
              className={buttonVariants({ variant: "default", size: "default" })}
            >
              {t("inspector.openTwin", { name: twin })}
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
