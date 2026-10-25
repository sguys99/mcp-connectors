// API 키 표시용 순수 함수. 키 전체는 화면에 다시 내보내지 않고, 설정 여부와 끝 4자리만 알려 준다.

export interface KeyHint {
  configured: boolean;
  // 끝 4자리. 키가 너무 짧으면(12자 미만) 끝자리도 단서가 되므로 null 로 둔다.
  last4: string | null;
}

const MIN_LENGTH_FOR_HINT = 12;

export function describeKey(value: string): KeyHint {
  const key = value.trim();
  if (key === "") return { configured: false, last4: null };
  return { configured: true, last4: key.length >= MIN_LENGTH_FOR_HINT ? key.slice(-4) : null };
}
