import { ActivityIcon, BracesIcon, MessageSquareIcon, SettingsIcon, type LucideIcon } from "lucide-react";

import type { NavId } from "@/lib/shell/routes";

// 화면별 아이콘. final.html 의 pulse, braces, chat 에 대응한다.
export const NAV_ICONS: Record<NavId, LucideIcon> = {
  dashboard: ActivityIcon,
  inspector: BracesIcon,
  chat: MessageSquareIcon,
  settings: SettingsIcon,
};
