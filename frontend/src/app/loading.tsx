// `dashboard` 라우트 로딩 UI. 셸의 <main> 안에 그려지며, 화면 골격과 같은 모양의 skeleton 을 보여 준다.

import { DashboardSkeleton } from "@/components/skeletons/screens";
import { getT } from "@/lib/i18n/server";

export default async function DashboardLoading() {
  const t = await getT();
  return <DashboardSkeleton label={t("common.loading")} title={t("nav.dashboard")} />;
}
