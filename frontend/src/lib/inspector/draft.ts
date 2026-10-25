// 도구 하나의 요청 입력 상태(초안)와 Form <-> JSON 전환. 도구를 바꿔도 입력이 남도록 InspectorView 가 도구별로 들고 있는다.

import {
  buildArgs,
  emptyValues,
  parseRawArgs,
  stringifyArgs,
  valuesFromArgs,
  type FieldSpec,
  type FormValues,
} from "./args";

export type InputMode = "form" | "json";

export interface ToolDraft {
  mode: InputMode;
  // 폼 입력값 (JSON 모드일 때는 마지막으로 폼에 있던 값)
  values: FormValues;
  // JSON 모드의 arguments 텍스트
  raw: string;
  // 스키마에 없는 키. JSON 으로 쓴 값을 폼으로 갔다 와도 잃지 않으려고 따로 둔다.
  extra: Record<string, unknown>;
}

export function newDraft(fields: readonly FieldSpec[]): ToolDraft {
  return { mode: "form", values: emptyValues(fields), raw: "{}", extra: {} };
}

// 폼의 현재 값을 JSON 텍스트로 옮긴다. 형식이 틀린 칸도 입력한 글자 그대로 담는다.
export function draftToJson(fields: readonly FieldSpec[], draft: ToolDraft): ToolDraft {
  const { args } = buildArgs(fields, draft.values, { lenient: true });
  return { ...draft, mode: "json", raw: stringifyArgs({ ...args, ...draft.extra }) };
}

export type SwitchToFormResult = { ok: true; draft: ToolDraft } | { ok: false; message: string };

// JSON 텍스트를 폼 값으로 옮긴다. JSON 이 깨져 있으면 옮길 수 없다.
export function draftToForm(fields: readonly FieldSpec[], draft: ToolDraft): SwitchToFormResult {
  const parsed = parseRawArgs(draft.raw);
  if (!parsed.ok) return parsed;
  const { values, extra } = valuesFromArgs(fields, parsed.value);
  return { ok: true, draft: { ...draft, mode: "form", values, extra } };
}

// 초기화: 입력을 모두 비운다 (모드는 유지).
export function resetDraft(fields: readonly FieldSpec[], draft: ToolDraft): ToolDraft {
  return { mode: draft.mode, values: emptyValues(fields), raw: "{}", extra: {} };
}
