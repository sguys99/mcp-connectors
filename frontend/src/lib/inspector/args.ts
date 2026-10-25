// Inspector 요청 입력: inputSchema 에서 폼 필드를 뽑고, 폼 값 <-> arguments JSON 을 서로 바꾼다.
//
// 폼은 값을 전부 "사용자가 친 그대로의 문자열"(체크박스만 boolean)로 들고 있고, 실행할 때 타입에 맞게 바꾼다.
// 그래서 "12a" 같은 잘못된 정수도 지우지 않고 오류로 보여 줄 수 있고, JSON 으로 갔다 와도 입력이 유지된다.
// 순수 모듈이라 단위 테스트로 규칙을 고정한다.

import { extractType } from "@/lib/schema/json-type";

export type FieldKind = "string" | "integer" | "number" | "boolean" | "enum" | "array" | "json";

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  // 칩에 보이는 타입 표기 (string, integer, string[] ...)
  typeLabel: string;
  required: boolean;
  description?: string;
  // 스키마의 default. 입력칸의 placeholder 와 도움말에만 쓰고, 사용자가 비워 두면 보내지 않는다 (서버 기본값이 적용됨).
  defaultValue?: unknown;
  enumValues?: string[];
  // 여러 줄 입력칸으로 그릴지 (SQL, 쿼리, 긴 텍스트)
  multiline: boolean;
}

type PropSchema = Record<string, unknown>;

const MULTILINE_NAME = /sql|query/i;

function asObject(value: unknown): PropSchema {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PropSchema) : {};
}

// 폼 필드 목록. properties 순서를 그대로 따른다.
export function fieldsFromSchema(inputSchema: unknown): FieldSpec[] {
  const schema = asObject(inputSchema);
  const properties = asObject(schema.properties);
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : [],
  );
  return Object.entries(properties).map(([name, raw]) => fieldFromProperty(name, asObject(raw), required.has(name)));
}

function fieldFromProperty(name: string, prop: PropSchema, required: boolean): FieldSpec {
  const type = extractType(prop);
  const enumValues = enumOf(prop);
  const itemType = type === "array" ? extractType(asObject(prop.items)) : undefined;

  let kind: FieldKind;
  if (enumValues) kind = "enum";
  else if (type === "integer") kind = "integer";
  else if (type === "number") kind = "number";
  else if (type === "boolean") kind = "boolean";
  // 배열은 "한 줄에 하나"로 입력한다. 항목이 객체나 배열이면 줄 단위로 못 나누니 JSON 으로 받는다.
  else if (type === "array") kind = itemType && itemType !== "object" && itemType !== "array" ? "array" : itemType ? "json" : "array";
  else if (type === "object") kind = "json";
  else kind = "string";

  const format = typeof prop.format === "string" ? prop.format : "";
  const maxLength = typeof prop.maxLength === "number" ? prop.maxLength : 0;
  const multiline =
    kind === "array" ||
    kind === "json" ||
    (kind === "string" && (/sql|multiline|textarea/i.test(format) || maxLength > 200 || MULTILINE_NAME.test(name)));

  return {
    name,
    kind,
    typeLabel: type === "array" ? `${itemType ?? "any"}[]` : (type ?? "string"),
    required,
    description: typeof prop.description === "string" ? prop.description : undefined,
    defaultValue: "default" in prop ? prop.default : undefined,
    enumValues,
    multiline,
  };
}

function enumOf(prop: PropSchema): string[] | undefined {
  if (!Array.isArray(prop.enum)) return undefined;
  const values = prop.enum.filter((x): x is string => typeof x === "string");
  return values.length > 0 ? values : undefined;
}

export type FormValues = Record<string, string | boolean>;

export function emptyValues(fields: readonly FieldSpec[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) values[f.name] = f.kind === "boolean" ? false : "";
  return values;
}

export type FieldError = "required" | "integer" | "number" | "json" | "enum";
export type FieldErrors = Record<string, FieldError>;

export interface BuildResult {
  args: Record<string, unknown>;
  errors: FieldErrors;
}

// 폼 값을 arguments 객체로 바꾼다. 비어 있고 필수가 아닌 필드는 키를 넣지 않는다.
// lenient 이면 형식이 틀린 값도 문자열 그대로 남긴다 (Form -> JSON 전환 때 입력을 잃지 않으려고).
export function buildArgs(
  fields: readonly FieldSpec[],
  values: FormValues,
  options: { lenient?: boolean } = {},
): BuildResult {
  const args: Record<string, unknown> = {};
  const errors: FieldErrors = {};

  for (const f of fields) {
    const raw = values[f.name];

    if (f.kind === "boolean") {
      // 체크하지 않은 선택 boolean 은 보내지 않는다. 필수이거나 체크했으면 값을 넣는다.
      if (raw === true || f.required) args[f.name] = raw === true;
      continue;
    }

    const text = typeof raw === "string" ? raw : "";
    const blank = f.kind === "array" ? text.trim() === "" : text.trim() === "";
    if (blank) {
      if (f.required) errors[f.name] = "required";
      continue;
    }

    switch (f.kind) {
      case "string":
        // 줄바꿈과 공백은 SQL 같은 입력에서 의미가 있어서 앞뒤만 정리하지 않고 그대로 둔다.
        args[f.name] = text;
        break;
      case "enum":
        if (f.enumValues && !f.enumValues.includes(text.trim())) {
          errors[f.name] = "enum";
          if (options.lenient) args[f.name] = text;
        } else {
          args[f.name] = text.trim();
        }
        break;
      case "integer":
      case "number": {
        const n = Number(text.trim());
        const finite = Number.isFinite(n);
        if (!finite) {
          errors[f.name] = "number";
          if (options.lenient) args[f.name] = text;
        } else if (f.kind === "integer" && !Number.isInteger(n)) {
          errors[f.name] = "integer";
          if (options.lenient) args[f.name] = text;
        } else {
          args[f.name] = n;
        }
        break;
      }
      case "array": {
        const items = splitLines(text).map((line) => coerceItem(line, f.typeLabel));
        args[f.name] = items;
        break;
      }
      case "json":
        try {
          args[f.name] = JSON.parse(text);
        } catch {
          errors[f.name] = "json";
          if (options.lenient) args[f.name] = text;
        }
        break;
    }
  }
  return { args, errors };
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// 배열 항목 타입이 숫자나 boolean 이면 그 타입으로 바꾼다. 바꿀 수 없으면 문자열로 둔다.
function coerceItem(line: string, typeLabel: string): unknown {
  if (typeLabel === "integer[]" || typeLabel === "number[]") {
    const n = Number(line);
    return Number.isFinite(n) ? n : line;
  }
  if (typeLabel === "boolean[]") return line === "true" ? true : line === "false" ? false : line;
  return line;
}

export interface FromArgsResult {
  values: FormValues;
  // 스키마에 없는 키. JSON 에서 폼으로 갔다 돌아올 때 되살린다.
  extra: Record<string, unknown>;
}

// arguments 객체를 폼 값으로 바꾼다. 폼으로 나타낼 수 없는 값(예: 정수 칸에 객체)은 JSON 문자열로 보인다.
export function valuesFromArgs(fields: readonly FieldSpec[], args: Record<string, unknown>): FromArgsResult {
  const values = emptyValues(fields);
  const known = new Set(fields.map((f) => f.name));
  for (const f of fields) {
    if (!(f.name in args)) continue;
    values[f.name] = stringifyForField(f, args[f.name]);
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!known.has(key)) extra[key] = value;
  }
  return { values, extra };
}

function stringifyForField(f: FieldSpec, value: unknown): string | boolean {
  if (f.kind === "boolean") return value === true;
  if (value === null || value === undefined) return "";
  if (f.kind === "array") {
    if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return value.map(String).join("\n");
    }
    return JSON.stringify(value);
  }
  if (f.kind === "json") return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export type ParsedRaw =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

// "arguments" 입력칸의 텍스트를 읽는다. 비어 있으면 빈 객체. 객체가 아닌 JSON 은 오류.
export function parseRawArgs(text: string): ParsedRaw {
  if (text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "arguments must be a JSON object" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function stringifyArgs(args: Record<string, unknown>): string {
  return Object.keys(args).length === 0 ? "{}" : JSON.stringify(args, null, 2);
}

// inputSchema 의 필수 키 중 args 에 없는 것.
export function missingRequired(fields: readonly FieldSpec[], args: Record<string, unknown>): string[] {
  return fields.filter((f) => f.required && !(f.name in args)).map((f) => f.name);
}

export function requiredNames(fields: readonly FieldSpec[]): string[] {
  return fields.filter((f) => f.required).map((f) => f.name);
}
