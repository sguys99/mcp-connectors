import type { Metadata, Viewport } from "next";
import {
  IBM_Plex_Sans,
  IBM_Plex_Sans_KR,
  JetBrains_Mono,
} from "next/font/google";

import { AppShell } from "@/components/shell/AppShell";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { getPublicServers } from "@/lib/mcp/registry";
import { GS_HIDDEN_SCRIPT } from "@/lib/onboarding/getting-started";
import { isRuntimeProxyEnabled } from "@/lib/runtime/guards";
import type { PublicServer } from "@/lib/mcp/types";
import "@/styles/globals.css";

// 제목과 코드용 고정폭, 본문용 산세리프, 한국어 폴백. 토큰은 globals.css 의 --font-display/body/code.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// 한국어 글리프는 커서 preload 하지 않고 필요한 구간만 받게 한다.
const plexSansKr = IBM_Plex_Sans_KR({
  variable: "--font-plex-sans-kr",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "MCP Connectors",
  description: "MCP server inspector & chat playground",
};

// 노치와 홈 인디케이터 영역까지 그리고, 셸이 env(safe-area-inset-*) 로 비켜 간다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// 레지스트리를 읽지 못해도 셸(내비게이션, 설정)은 살아 있어야 한다. 오류는 각 화면이 보여 준다.
async function loadServers(): Promise<PublicServer[]> {
  try {
    return await getPublicServers();
  } catch {
    return [];
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // mcpc-lang 쿠키로 첫 렌더부터 언어를 정한다 (cookies() 때문에 모든 라우트가 동적 렌더링).
  const { locale, dictionary, t } = await getI18n();
  const servers = await loadServers();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${jetbrainsMono.variable} ${plexSans.variable} ${plexSansKr.variable} h-full antialiased`}
    >
      <head>
        {/* Dashboard 시작하기 패널을 숨긴 사용자에게 서버에서 그린 패널이 잠깐 보이지 않게 한다 (lib/onboarding/getting-started.ts) */}
        <script dangerouslySetInnerHTML={{ __html: GS_HIDDEN_SCRIPT }} />
      </head>
      <body className="h-dvh overflow-hidden bg-background text-foreground">
        <I18nProvider locale={locale} dictionary={dictionary}>
          <ThemeProvider>
            <SkipLink label={t("shell.skipToContent")} />
            <AppShell servers={servers} runtimeProxyEnabled={isRuntimeProxyEnabled()}>
              {children}
            </AppShell>
            {/* 토스트는 상태바 위(모바일은 하단 탭바 위)에 쌓인다. --toast-bottom 은 globals.css */}
            <Toaster
              containerAriaLabel={t("shell.notifications")}
              offset={{ bottom: "var(--toast-bottom)", right: "var(--gutter-r)" }}
              mobileOffset={{ bottom: "var(--toast-bottom)", left: "var(--gutter-l)", right: "var(--gutter-r)" }}
            />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

// 건너뛰기 링크: 포커스를 받을 때만 화면에 내려온다.
function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      className="fixed top-2 left-[max(12px,env(safe-area-inset-left,0px))] z-[var(--z-toast)] -translate-y-[160%] rounded-sm bg-inverse px-3 py-1.5 text-xs font-medium text-fg-on-inverse no-underline transition-transform focus:translate-y-0"
    >
      {label}
    </a>
  );
}
