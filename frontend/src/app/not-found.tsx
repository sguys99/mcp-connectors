// 전역 404. 루트 레이아웃 안에서 그려지므로 셸(타이틀바, 활동 바, 상태바)이 그대로 유지된다.

import Link from "next/link";

import { StatusScreen } from "@/components/status/StatusScreen";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function NotFound() {
  const t = await getT();
  return (
    <StatusScreen
      code={t("status.notFoundCode")}
      title={t("status.notFoundTitle")}
      description={t("status.notFoundDescription")}
      actions={
        <Link href="/" className={cn(buttonVariants({ variant: "default" }))}>
          {t("status.home")}
        </Link>
      }
    />
  );
}
