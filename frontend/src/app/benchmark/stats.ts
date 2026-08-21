/**
 * stats.ts — pure, framework-free latency statistics for the benchmark.
 *
 * No Angular/DOM deps so it is trivially unit-testable (see stats.spec.ts),
 * per CLAUDE.md's rule that pure logic lives in standalone modules.
 */

/**
 * The p-th percentile (0..100) of `values`, using linear interpolation between
 * closest ranks (the "R-7" / Excel PERCENTILE.INC method). Does not mutate the
 * input. Returns `NaN` for an empty array.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sorted[lo];
  }
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Median (50th percentile). `NaN` for an empty array. */
export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/** Median and p95 of a latency sample, in one pass-friendly bundle. */
export interface LatencySummary {
  readonly median: number;
  readonly p95: number;
  readonly count: number;
}

export function summarize(values: readonly number[]): LatencySummary {
  return {
    median: median(values),
    p95: percentile(values, 95),
    count: values.length,
  };
}
