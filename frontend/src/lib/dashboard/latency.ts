// Dashboard 지연 계산: p50 과 스파크라인 도형. 모두 순수 함수라 단위 테스트로 고정한다.
// 스파크라인의 가로축은 "최근 N회 점검"이고 세로축은 모든 서버가 같은 0 ~ max ms 눈금이다.
// max 는 화면에 보이는 모든 서버의 샘플 중 가장 큰 값을 보기 좋은 값(100, 200, 300, 500, 1000 ...)으로 올린 것이라,
// 행마다 눈금이 달라지지 않으면서도 Docker 프록시처럼 지연이 큰 환경에서 막대가 잘리지 않는다.

import { MAX_SAMPLES, type Sample } from "@/lib/shell/health-history";

// 눈금 최솟값. 로컬 직결처럼 지연이 작을 때 몇 ms 차이가 과장되지 않게 한다.
export const SPARK_MIN_SCALE_MS = 100;
// 눈금 후보. 마지막 값보다 크면 그 값의 배수로 올린다.
const NICE_STEPS = [100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000] as const;
// p50 에 쓰는 최근 샘플 수 (실패한 점검은 제외한다).
export const P50_WINDOW = 12;

export const SPARK_WIDTH = 120;
export const SPARK_HEIGHT = 28;
const PAD = 3;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value);
}

function latest(samples: readonly Sample[], window: number): number[] {
  return samples
    .slice(-window)
    .map((s) => s.ms)
    .filter((ms): ms is number => ms !== null);
}

// 한 서버의 p50. 최근 window 개 샘플 중 성공한 것만 센다. 자료가 없으면 null.
export function p50Of(samples: readonly Sample[] | undefined, window = P50_WINDOW): number | null {
  return samples ? median(latest(samples, window)) : null;
}

// 여러 서버의 최근 샘플을 한데 모은 p50 (지표 띠용).
export function pooledP50(lists: readonly (readonly Sample[] | undefined)[], window = P50_WINDOW): number | null {
  return median(lists.flatMap((samples) => (samples ? latest(samples, window) : [])));
}

// 보기 좋은 눈금으로 올림. 100 미만은 100, 후보를 넘으면 10초 단위로 올린다.
export function niceScale(ms: number): number {
  if (!Number.isFinite(ms) || ms <= SPARK_MIN_SCALE_MS) return SPARK_MIN_SCALE_MS;
  for (const step of NICE_STEPS) if (ms <= step) return step;
  const last = NICE_STEPS[NICE_STEPS.length - 1];
  return Math.ceil(ms / last) * last;
}

// 여러 서버가 함께 쓰는 눈금(ms). 스파크라인에 보이는 최근 slots 개 샘플 중 성공한 것의 최댓값을 올린다.
export function sharedSparkScale(
  lists: readonly (readonly Sample[] | undefined)[],
  slots = MAX_SAMPLES,
): number {
  let max = 0;
  for (const samples of lists) {
    if (!samples) continue;
    for (const s of samples.slice(-slots)) if (s.ms !== null && s.ms > max) max = s.ms;
  }
  return niceScale(max);
}

export interface SparkGeometry {
  width: number;
  height: number;
  // 세로 눈금 최댓값(ms).
  maxMs: number;
  // 점선 격자: 눈금 절반 선과 바닥선. 1px 선이 번지지 않게 반 픽셀에 맞춘다.
  gridMidY: number;
  gridBaseY: number;
  // 연속 구간의 선과 면. 구간이 없으면 빈 문자열.
  line: string;
  area: string;
  // 실패한 점검 구간을 바닥에 잇는 점선.
  gap: string;
  // 샘플 하나짜리 구간 (선을 그릴 수 없어 점으로 그린다).
  dots: { x: number; y: number }[];
  // 마지막 샘플 표시. offline 이면 속 빈 원을 바닥에 그린다.
  end: { x: number; y: number; offline: boolean } | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const crisp = (n: number) => Math.round(n) + 0.5;

// slots 는 가로 슬롯 수. 샘플이 적으면 오른쪽(최신)부터 채워, 새 점이 늘 오른쪽에서 자란다.
// maxMs 는 공용 눈금(sharedSparkScale). 생략하면 이 샘플만으로 정한다.
export function buildSparkline(
  samples: readonly Sample[],
  slots = MAX_SAMPLES,
  maxMs = sharedSparkScale([samples], slots),
): SparkGeometry {
  const visible = samples.slice(-slots);
  const offset = slots - visible.length;
  const baseY = SPARK_HEIGHT - PAD;
  const x = (i: number) => r1(PAD + ((i + offset) * (SPARK_WIDTH - 2 * PAD)) / Math.max(1, slots - 1));
  const y = (ms: number) =>
    r1(SPARK_HEIGHT - PAD - (Math.min(Math.max(ms, 0), maxMs) / maxMs) * (SPARK_HEIGHT - 2 * PAD));
  const step = (SPARK_WIDTH - 2 * PAD) / Math.max(1, slots - 1);

  const lineParts: string[] = [];
  const areaParts: string[] = [];
  const gapParts: string[] = [];
  const dots: { x: number; y: number }[] = [];

  let i = 0;
  while (i < visible.length) {
    let j = i;
    const isOk = visible[i]!.ms !== null;
    while (j + 1 < visible.length && (visible[j + 1]!.ms !== null) === isOk) j += 1;
    if (isOk) {
      const pts = [];
      for (let k = i; k <= j; k += 1) pts.push(`${x(k)},${y(visible[k]!.ms!)}`);
      if (i === j) {
        dots.push({ x: x(i), y: y(visible[i]!.ms!) });
      } else {
        const d = `M${pts.join("L")}`;
        lineParts.push(d);
        areaParts.push(`${d}L${x(j)},${baseY}L${x(i)},${baseY}Z`);
      }
    } else {
      const from = Math.max(0, x(i) - (i === j ? step / 2 : 0));
      const to = Math.min(SPARK_WIDTH, x(j) + (i === j ? step / 2 : 0));
      gapParts.push(`M${r1(from)},${baseY}L${r1(to)},${baseY}`);
    }
    i = j + 1;
  }

  const last = visible[visible.length - 1];
  let end: SparkGeometry["end"] = null;
  if (last) {
    end =
      last.ms === null
        ? { x: x(visible.length - 1), y: baseY, offline: true }
        : { x: x(visible.length - 1), y: y(last.ms), offline: false };
  }

  return {
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    maxMs,
    gridMidY: crisp(y(maxMs / 2)),
    gridBaseY: crisp(baseY),
    line: lineParts.join(""),
    area: areaParts.join(""),
    gap: gapParts.join(""),
    dots,
    end,
  };
}
