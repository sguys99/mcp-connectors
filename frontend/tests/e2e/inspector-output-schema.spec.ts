import { expect, test, type Page } from "@playwright/test";

// 브라우저의 SDK 에는 ajv 가 없고, 도구 outputSchema 검증은 Inspector 호출 때 별도 청크로 불러와 한다.
// mock-repo-mcp 의 list_repositories 는 outputSchema 를 선언한다. 프록시 응답의 schema 를 바꿔 어긋난 경우를 만든다.

const responsePane = (page: Page) => page.getByRole("region", { name: "Response" });
const DECLARED = '"outputSchema":{"additionalProperties":true,"type":"object"}';

async function open(page: Page, rewrite: (body: string) => string) {
  await page.route("**/api/mcp/mock-repo-mcp", async (route) => {
    if (route.request().method() !== "POST" || !route.request().postData()?.includes('"tools/list"')) return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: rewrite(await res.text()) });
  });
  await page.goto("/inspector?server=mock-repo-mcp");
  await expect(page.getByRole("option", { name: /^list_repositories/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("option", { name: /^list_repositories/ }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
}

test("structuredContent that violates the declared outputSchema is flagged", async ({ page }) => {
  await open(page, (body) => {
    expect(body).toContain(DECLARED);
    return body.replace(DECLARED, '"outputSchema":{"type":"object","required":["no_such_field"]}');
  });
  await expect(responsePane(page).getByText(/does not match the tool's output schema/)).toBeVisible({ timeout: 15_000 });
});

test("a conforming structuredContent passes (ajv chunk loads lazily)", async ({ page }) => {
  await open(page, (body) => body);
  await expect(responsePane(page).getByText("OK", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(responsePane(page).getByText(/output schema/)).toHaveCount(0);
});
