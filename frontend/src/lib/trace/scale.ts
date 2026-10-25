// 워터폴 시간축 계산과 시간 표기. 눈금, 격자선, 막대 위치가 한 도메인(0..domain ms)을 공유한다.

export interface Axis {
  // 축의 끝 값(ms). 마지막 눈금과 같다.
  domain: number;
  // 눈금 간격(ms)
  step: number;
  // 0 부터 domain 까지의 눈금 값
  ticks: number[];
}

const MANTISSAS = [1, 2, 2.5, 5] as const;

// total 을 덮는 "보기 좋은" 눈금 간격(1, 2, 2.5, 5 x 10^k)을 골라 눈금 수가 maxTicks 이하가 되게 한다.
// 간격이 작을수록 격자가 촘촘하므로 조건을 만족하는 가장 작은 간격을 쓴다.
export function buildAxis(total: number, maxTicks: number): Axis {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 1;
  const limit = Math.max(2, Math.floor(maxTicks));
  const base = Math.floor(Math.log10(safeTotal / limit));

  let best: { step: number; n: number } | null = null;
  for (let exp = base - 1; exp <= base + 2 && !best; exp += 1) {
    const unit = 10 ** exp;
    for (const m of MANTISSAS) {
      const step = round(m * unit);
      const n = Math.ceil(safeTotal / step - 1e-9);
      if (n <= limit && n >= 1) {
        best = { step, n: Math.max(n, 2) };
        break;
      }
    }
  }
  const { step, n } = best ?? { step: round(safeTotal), n: 1 };
  const ticks = Array.from({ length: n + 1 }, (_, i) => round(i * step));
  return { domain: round(n * step), step, ticks };
}

// 부동소수 오차(0.30000000000000004)를 지운다.
function round(value: number): number {
  return Number(value.toPrecision(12));
}

// 막대 위치와 폭을 도메인 비율(0..1)로 바꾼다. 도메인 밖으로 나가지 않게 자른다.
export function spanFraction(start: number, dur: number, domain: number): { left: number; width: number } {
  if (!(domain > 0)) return { left: 0, width: 0 };
  const left = clamp(start / domain, 0, 1);
  const right = clamp((start + Math.max(0, dur)) / domain, 0, 1);
  return { left, width: Math.max(0, right - left) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 소요 시간 표기. 1ms 미만도 의미가 있어서 10ms 아래는 소수 한 자리까지 보인다.
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value >= 1000) {
    const seconds = value / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  }
  if (value >= 10) return `${Math.round(value)} ms`;
  if (value >= 0.1) return `${value.toFixed(1)} ms`;
  return value === 0 ? "0 ms" : "<0.1 ms";
}

// 눈금 라벨. 간격에 맞는 자릿수만 보인다 (500 -> "0.5 s", 2.5 -> "2.5 ms").
export function formatTick(value: number, step: number): string {
  if (value === 0) return "0";
  if (step >= 1000 || value >= 1000) {
    const decimals = step % 1000 === 0 ? 0 : step % 100 === 0 ? 1 : 2;
    return `${(value / 1000).toFixed(decimals)} s`;
  }
  const decimals = step >= 1 ? (Number.isInteger(step) ? 0 : 1) : step >= 0.1 ? 1 : 2;
  return `${value.toFixed(decimals)} ms`;
}
