"use client";

// 서버 한 줄의 "더 보기" 메뉴: 클라이언트 설정 복사(모든 서버), 수정과 삭제(런타임 서버만). 탐색기와 Dashboard 표가 함께 쓴다.

import { FileJsonIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n/client";
import type { PublicServer } from "@/lib/mcp/types";
import { cn } from "@/lib/utils";

export function isRuntimeServer(server: PublicServer): boolean {
  return server.transport === "streamable_http" && Boolean(server.runtime);
}

export function ServerMenu({ server, className }: { server: PublicServer; className?: string }) {
  const t = useT();
  const { openClientConfig, openEditServer, requestRemoveServer } = useShell();
  const runtime = isRuntimeServer(server);
  const label = t("runtime.menuLabel", { name: server.name });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon" aria-label={label} title={label} className={cn("size-8", className)} data-server-menu={server.name} />}
      >
        <MoreHorizontalIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => openClientConfig(server.name)} data-menu-action="copy-config">
          <FileJsonIcon aria-hidden />
          {t("runtime.menuCopyConfig")}
        </DropdownMenuItem>
        {runtime ? (
          <>
            <DropdownMenuItem onClick={() => openEditServer(server.name)} data-menu-action="edit">
              <PencilIcon aria-hidden />
              {t("runtime.menuEdit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => requestRemoveServer(server.name)} data-menu-action="remove">
              <Trash2Icon aria-hidden />
              {t("runtime.menuRemove")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
