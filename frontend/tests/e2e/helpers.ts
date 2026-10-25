import { expect, type Page } from "@playwright/test";

// 하이드레이션이 끝나 전역 단축키 리스너가 달릴 때까지 기다린다 (고정 대기 대신).
// ShortcutProvider 가 리스너를 단 뒤 <html data-shortcuts-ready="true"> 를 표시한다.
export async function waitForShell(page: Page) {
  await expect(page.locator("html[data-shortcuts-ready='true']")).toBeAttached({ timeout: 20_000 });
}

// 페이지를 열고 하이드레이션까지 기다린다.
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await waitForShell(page);
}
