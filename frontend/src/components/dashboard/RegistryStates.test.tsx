import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/client";

import { RegistryEmpty, RegistryError } from "./RegistryStates";

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider locale="en" dictionary={en}>
      {node}
    </I18nProvider>,
  );

describe("레지스트리 빈 상태와 오류 상태", () => {
  it("빈 상태는 파일 이름과 예시 항목과 새로고침 버튼을 보여 준다", () => {
    const html = wrap(<RegistryEmpty onReload={() => {}} />);
    expect(html).toContain("No servers registered");
    expect(html).toContain("configs/mcp_servers.yaml");
    expect(html).toContain("transport: streamable_http");
    expect(html).toContain("Reload");
  });

  it("오류 상태는 role=alert 이고 실제 오류 메시지를 그대로 보여 준다", () => {
    const html = wrap(<RegistryError message="[registry] Cannot read /x/nope.yaml" onReload={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("[registry] Cannot read /x/nope.yaml");
    expect(html).toContain("MCP_REGISTRY_PATH");
  });
});
