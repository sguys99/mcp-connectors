import { describe, expect, it } from "vitest";

import { MAX_SAMPLES, type Sample } from "@/lib/shell/health-history";

import {
  SPARK_HEIGHT,
  SPARK_WIDTH,
  buildSparkline,
  median,
  niceScale,
  p50Of,
  pooledP50,
  sharedSparkScale,
} from "./latency";

const s = (ms: number | null, at = 0): Sample => ({ at, ms });

describe("median", () => {
  it("자료가 없으면 null", () => {
    expect(median([])).toBeNull();
  });
  it("홀수 개는 가운데 값", () => {
    expect(median([30, 10, 20])).toBe(20);
  });
  it("짝수 개는 가운데 두 값의 평균을 반올림", () => {
    expect(median([10, 21])).toBe(16);
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});

describe("p50Of", () => {
  it("실패한 점검(null)은 세지 않는다", () => {
    expect(p50Of([s(10), s(null), s(30), s(null), s(20)])).toBe(20);
  });
  it("최근 window 개만 본다", () => {
    const old = Array.from({ length: 20 }, () => s(500));
    const recent = Array.from({ length: 12 }, () => s(20));
    expect(p50Of([...old, ...recent])).toBe(20);
  });
  it("샘플이 없거나 모두 실패면 null", () => {
    expect(p50Of(undefined)).toBeNull();
    expect(p50Of([])).toBeNull();
    expect(p50Of([s(null), s(null)])).toBeNull();
  });
});

describe("pooledP50", () => {
  it("서버별 샘플을 한데 모아 가운데 값을 구한다", () => {
    expect(pooledP50([[s(10), s(20)], undefined, [s(30)]])).toBe(20);
  });
  it("모두 비면 null", () => {
    expect(pooledP50([undefined, []])).toBeNull();
  });
});

describe("niceScale", () => {
  it("100 이하와 이상한 값은 최솟값 100", () => {
    expect(niceScale(0)).toBe(100);
    expect(niceScale(42)).toBe(100);
    expect(niceScale(Number.NaN)).toBe(100);
  });
  it("보기 좋은 값으로 올린다", () => {
    expect(niceScale(101)).toBe(200);
    expect(niceScale(280)).toBe(300);
    expect(niceScale(301)).toBe(500);
    expect(niceScale(1200)).toBe(2000);
    expect(niceScale(4999)).toBe(5000);
  });
  it("후보를 넘으면 10초 단위로 올린다", () => {
    expect(niceScale(12_000)).toBe(20_000);
  });
});

describe("sharedSparkScale", () => {
  it("모든 서버의 최근 샘플 중 최댓값으로 정하고 실패한 점검은 무시한다", () => {
    expect(sharedSparkScale([[s(120), s(null)], undefined, [s(260)]])).toBe(300);
  });
  it("스파크라인에 보이지 않는 오래된 샘플은 세지 않는다", () => {
    const old = [s(4000), ...Array.from({ length: 24 }, () => s(50))];
    expect(sharedSparkScale([old])).toBe(100);
  });
  it("샘플이 없으면 최솟값", () => {
    expect(sharedSparkScale([])).toBe(100);
  });
});

describe("buildSparkline", () => {
  it("샘플이 없으면 선, 면, 끝점이 없다", () => {
    const g = buildSparkline([]);
    expect(g.line).toBe("");
    expect(g.area).toBe("");
    expect(g.end).toBeNull();
  });

  it("0 ms 는 바닥(H-3), 눈금 최댓값은 위(3)에 놓이고 그 이상은 눈금 위로 자른다", () => {
    const g = buildSparkline([s(0), s(200), s(900)], undefined, 200);
    const ys = [...g.line.matchAll(/,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys).toEqual([SPARK_HEIGHT - 3, 3, 3]);
    expect(g.maxMs).toBe(200);
  });

  it("눈금을 주지 않으면 자기 샘플의 최댓값을 보기 좋은 값으로 올려 잘리지 않는다", () => {
    const g = buildSparkline([s(150), s(280)]);
    expect(g.maxMs).toBe(300);
    const ys = [...g.line.matchAll(/,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThan(3);
  });

  it("같은 값이면 서버와 상관없이 같은 높이 (공용 눈금)", () => {
    const a = buildSparkline([s(60), s(60)]);
    const b = buildSparkline([s(60), s(60), s(60)]);
    expect(a.line.match(/,([\d.]+)/)![1]).toBe(b.line.match(/,([\d.]+)/)![1]);
  });

  it("샘플이 적으면 오른쪽(최신) 슬롯부터 채운다", () => {
    const g = buildSparkline([s(10), s(10)]);
    expect(g.end!.x).toBe(SPARK_WIDTH - 3);
    const firstX = Number(g.line.match(/^M([\d.]+),/)![1]);
    expect(firstX).toBeGreaterThan(SPARK_WIDTH / 2);
  });

  it("샘플이 가득 차면 왼쪽 끝부터 오른쪽 끝까지 쓴다", () => {
    const g = buildSparkline(Array.from({ length: MAX_SAMPLES }, () => s(10)));
    expect(Number(g.line.match(/^M([\d.]+),/)![1])).toBe(3);
    expect(g.end!.x).toBe(SPARK_WIDTH - 3);
  });

  it("샘플 한 개는 선 대신 점으로 그린다", () => {
    const g = buildSparkline([s(40)]);
    expect(g.line).toBe("");
    expect(g.dots).toHaveLength(1);
    expect(g.end).toEqual({ x: g.dots[0]!.x, y: g.dots[0]!.y, offline: false });
  });

  it("실패 구간은 바닥 점선으로 잇고, 마지막이 실패면 속 빈 끝점을 바닥에 둔다", () => {
    const g = buildSparkline([s(20), s(30), s(null), s(null)]);
    expect(g.line.startsWith("M")).toBe(true);
    expect(g.gap).toMatch(/^M[\d.]+,25L[\d.]+,25$/);
    expect(g.end).toMatchObject({ offline: true, y: SPARK_HEIGHT - 3 });
  });

  it("복구되면 선이 끊어진 두 구간이 되고 끝점은 파란 점", () => {
    const g = buildSparkline([s(20), s(30), s(null), s(25), s(26)]);
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.area.match(/Z/g)).toHaveLength(2);
    expect(g.end!.offline).toBe(false);
  });

  it("격자선은 반 픽셀에 맞춘다 (1px 선이 번지지 않게)", () => {
    const g = buildSparkline([s(10), s(20)]);
    expect(g.gridMidY % 1).toBe(0.5);
    expect(g.gridBaseY % 1).toBe(0.5);
  });
});
