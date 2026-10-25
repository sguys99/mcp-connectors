// JSON Schema 속성의 기본 타입을 꺼낸다 (Inspector 폼의 타입 칩과 인자 변환이 쓴다).
// FastMCP 가 emit 하는 부분집합만 다룬다. oneOf, $ref 는 지원하지 않고 undefined 를 돌려준다.

type PropSchema = Record<string, unknown>;

function asPropSchema(s: unknown): PropSchema {
  return s && typeof s === "object" ? (s as PropSchema) : {};
}

// FastMCP 가 Optional[str] 를 **`{anyOf: [{type:"string"},{type:"null"}]}`** 로 emit 한다
// (실측 — Phase 4-4-5 검증). 기존에 가정했던 `{type: ["string","null"]}` 형태는 fall-back 보조.
// null 을 걸러내고 첫 primitive 를 반환한다.
export function extractType(propSchema: unknown): string | undefined {
  const ps = asPropSchema(propSchema);
  return extractTypeInner(ps);
}

function extractTypeInner(propSchema: PropSchema): string | undefined {
  // 1순위: 직접 type (단일 또는 배열)
  const t = propSchema.type;
  if (Array.isArray(t)) {
    const picked = t.find(
      (x): x is string => typeof x === "string" && x !== "null",
    );
    if (picked) return picked;
  } else if (typeof t === "string") {
    return t;
  }

  // 2순위: anyOf 안의 nested type — FastMCP Optional[X] 의 실제 형태
  const anyOf = propSchema.anyOf;
  if (Array.isArray(anyOf)) {
    for (const variant of anyOf) {
      if (variant && typeof variant === "object" && "type" in variant) {
        const vt = (variant as Record<string, unknown>).type;
        if (typeof vt === "string" && vt !== "null") return vt;
      }
    }
  }

  return undefined;
}
