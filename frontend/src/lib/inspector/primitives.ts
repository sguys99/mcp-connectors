// Inspector 의 Resources, Prompts 지원 규칙. 순수 모듈이라 단위 테스트로 고정한다.
//   * 서버가 선언한 capability 판정 (initialize 결과 기준)
//   * resource template 의 URI 변수 읽기, 값 채우기 (RFC 6570 의 자주 쓰는 형태)
//   * prompt 인자, template 변수를 도구와 같은 폼 필드(FieldSpec)로 바꾸기

import type { PromptMeta, ResourceTemplateMeta } from "@/lib/mcp/types";

import type { FieldSpec } from "./args";

export type PrimitiveKind = "tools" | "resources" | "prompts";

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ["tools", "resources", "prompts"];

// initialize 결과의 capabilities 에 해당 항목이 있으면 서버가 선언한 것이다 (빈 객체 {} 도 선언).
export function isDeclared(capabilities: Record<string, unknown> | null | undefined, kind: PrimitiveKind): boolean {
  if (!capabilities) return false;
  const value = capabilities[kind];
  return value !== undefined && value !== null && value !== false;
}

// ----- resource template -----

// {var}, {+var}, {#var}, {/var}, {?a,b}, {&a}, {var*}, {var:3} 의 변수 이름을 순서대로 모은다 (중복 제거).
export function templateVariables(template: string): string[] {
  const names: string[] = [];
  for (const m of template.matchAll(/\{([^}]*)\}/g)) {
    const body = (m[1] ?? "").replace(/^[+#./;?&]/, "");
    for (const part of body.split(",")) {
      const name = part.replace(/\*$/, "").replace(/:\d+$/, "").trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

// 쿼리 형식({?a,b}, {&a})으로만 나오는 변수는 선택 입력이다.
function optionalVariables(template: string): Set<string> {
  const optional = new Set<string>();
  for (const m of template.matchAll(/\{([?&])([^}]*)\}/g)) {
    for (const part of (m[2] ?? "").split(",")) optional.add(part.replace(/\*$/, "").replace(/:\d+$/, "").trim());
  }
  return optional;
}

export function templateFields(template: ResourceTemplateMeta): FieldSpec[] {
  const optional = optionalVariables(template.uriTemplate);
  return templateVariables(template.uriTemplate).map((name) => ({
    name,
    kind: "string",
    typeLabel: "string",
    required: !optional.has(name),
    multiline: false,
  }));
}

// RFC 3986 reserved 문자는 {+var} 와 {#var} 에서만 그대로 둔다.
const encodeReserved = (value: string) => encodeURI(value).replace(/%5B/g, "[").replace(/%5D/g, "]");

// 템플릿의 {변수} 를 채워 읽을 URI 를 만든다. 값이 비어 있는 선택 변수는 건너뛴다.
export function expandUriTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^}]*)\}/g, (_all, body: string) => {
    const op = /^[+#./;?&]/.test(body) ? body[0]! : "";
    const names = body
      .slice(op.length)
      .split(",")
      .map((p) => p.replace(/\*$/, "").replace(/:\d+$/, "").trim())
      .filter(Boolean);
    const pairs = names
      .map((name) => [name, values[name]] as const)
      .filter(([, v]) => v !== undefined && v !== null && String(v) !== "");
    const text = (v: unknown) => (op === "+" || op === "#" ? encodeReserved(String(v)) : encodeURIComponent(String(v)));
    switch (op) {
      case "":
        return pairs.map(([, v]) => text(v)).join(",");
      case "+":
        return pairs.map(([, v]) => text(v)).join(",");
      case "#":
        return pairs.length ? `#${pairs.map(([, v]) => text(v)).join(",")}` : "";
      case ".":
        return pairs.map(([, v]) => `.${text(v)}`).join("");
      case "/":
        return pairs.map(([, v]) => `/${text(v)}`).join("");
      case ";":
        return pairs.map(([n, v]) => `;${n}=${text(v)}`).join("");
      case "?":
        return pairs.length ? `?${pairs.map(([n, v]) => `${n}=${text(v)}`).join("&")}` : "";
      case "&":
        return pairs.map(([n, v]) => `&${n}=${text(v)}`).join("");
      default:
        return "";
    }
  });
}

// ----- prompt -----

export function promptFields(prompt: PromptMeta): FieldSpec[] {
  return prompt.arguments.map((arg) => ({
    name: arg.name,
    kind: "string",
    typeLabel: "string",
    required: arg.required,
    description: arg.description,
    multiline: false,
  }));
}

// ----- 목록 항목 -----

// 목록 패널이 그리는 항목. 도구, 리소스, 프롬프트를 같은 모양으로 맞춘 것이다.
export interface PaneItem {
  // 선택과 ?tool= 같은 딥링크에 쓰는 고유값 (도구 이름, resource uri, template, prompt 이름)
  id: string;
  title: string;
  sub: string;
  // sub 를 고정폭으로 (URI)
  mono?: boolean;
  chips?: { label: string; tone?: "info" | "brand" }[];
  // resource 를 이미지 아이콘으로 구분하는 용도
  icon?: "image" | "file" | "template" | "message";
}

export function shortMime(mime: string | undefined): string | null {
  if (!mime) return null;
  const sub = mime.split(";")[0]!.split("/")[1];
  return sub ? sub.replace(/^x-/, "") : mime;
}
