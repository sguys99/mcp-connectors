// 시나리오 내보내기 대상 판정. scenario-export.ts 는 yaml 라이브러리를 끌어오므로,
// History 패널처럼 판정만 필요한 곳이 번들에 yaml 을 싣지 않도록 따로 둔다.

import type { HistoryEntry } from "./history";

export const isExportable = (entry: HistoryEntry): boolean => entry.status !== "cancelled" && entry.outcome !== "transport";
