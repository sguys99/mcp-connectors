// 서버와 브라우저가 함께 쓰는 LLM 상수. server-only 모듈 (adapter.ts) 에 두면
// 클라이언트 컴포넌트가 import 할 수 없어 따로 둔다.

// 기본 max iterations (PRD §3.6.2 step 3c). api/chat 의 maxIterations 생략 시 값.
export const DEFAULT_MAX_ITERATIONS = 5;

// 최대 반복 횟수의 허용 범위. 툴바와 Settings 입력은 이 범위로 맞추고, api/chat 은 범위 밖의 값을 400 으로 거부한다.
// 상한은 시안(final.html)의 입력 max=20 을 따른다. 반복 한 번이 LLM 호출 한 번이라 비용이 곧 상한에 비례한다.
export const MIN_ITERATIONS = 1;
export const MAX_ITERATIONS = 20;

// 입력값을 허용 범위의 정수로 맞춘다. 숫자가 아니면 null.
export function clampIterations(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(value)));
}
