/**
 * race-summary.ts — turns the raw timings of one race into the comparison the
 * page shows, and into a row for the results table you fill in during Act 3.
 *
 * Pure and framework-free (tested in race-summary.spec.ts). The statistics
 * themselves (median, p95) are given, in stats.ts. Each step is one small
 * function; summarizeRace and resultsRow, which put the steps together, are
 * written for you.
 */
import { LatencySummary, summarize } from './stats';

/** The raw timings of one race, as the benchmark collected them. */
export interface RaceTimings {
  /** Browser: wall-clock time per run, preprocessing + model + readback. */
  readonly localMs: readonly number[];
  /** Backend: client-measured round trip per request. */
  readonly cloudRoundTripMs: readonly number[];
  /** Backend: the model time the server reported for the same requests. */
  readonly cloudServerMs: readonly number[];
}

/** The backend side of a race, split into model time and everything else. */
export interface CloudSummary {
  readonly total: LatencySummary;
  readonly server: LatencySummary;
  /** Median round trip minus median model time, never negative. */
  readonly networkMedianMs: number;
}

export interface RaceSummary {
  readonly local: LatencySummary;
  /** null when the backend did not answer (the race still has local numbers). */
  readonly cloud: CloudSummary | null;
}

/**
 * Step 1 — The part of a backend round trip that is NOT the model: upload,
 * JPEG decode, HTTP, the injected WAN delay, the response. It is the median
 * round trip minus the median model time, but never below 0 (the two medians
 * come from different distributions, so on a fast LAN the difference can dip
 * below 0).
 */
export function networkShare(roundTripMedianMs: number, serverMedianMs: number): number {
  return Math.max(0, roundTripMedianMs - serverMedianMs);
}

/**
 * Step 2 — The backend side of a race, or null when the backend never
 * answered (no round trips). `total` summarizes the round trips, `server` the
 * model times, and `networkMedianMs` is step 1 applied to their medians.
 */
export function summarizeCloud(timings: RaceTimings): CloudSummary | null {
  if (timings.cloudRoundTripMs.length === 0) {
    return null;
  }
  const total = summarize(timings.cloudRoundTripMs);
  const server = summarize(timings.cloudServerMs);
  return { total, server, networkMedianMs: networkShare(total.median, server.median) };
}

/** Summarize one race: the browser's timings, and the backend's (step 2). */
export function summarizeRace(timings: RaceTimings): RaceSummary {
  return { local: summarize(timings.localMs), cloud: summarizeCloud(timings) };
}

/** Header of the results table in WORKSHOP.md, matching {@link resultsRow}. */
export const RESULTS_HEADER =
  '| injected WAN | local backend | local median | local p95 | cloud median | cloud p95 | server model | network share |\n' +
  '|---|---|---|---|---|---|---|---|';

/** Step 3 — A duration for the table: one decimal and " ms", e.g. "9.3 ms". */
export function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/**
 * Step 4 — The four backend cells of a results row: cloud median, cloud p95,
 * server model median and network share, each formatted with step 3. When the
 * backend did not answer (`cloud` is null), four dashes: "—".
 */
export function cloudCells(cloud: CloudSummary | null): string[] {
  if (!cloud) {
    return ['—', '—', '—', '—'];
  }
  return [
    formatMs(cloud.total.median),
    formatMs(cloud.total.p95),
    formatMs(cloud.server.median),
    formatMs(cloud.networkMedianMs),
  ];
}

/**
 * One markdown row for the results table, matching the eight columns of
 * RESULTS_HEADER:
 *
 *   | +150 ms | webgpu | 9.3 ms | 9.8 ms | 181.0 ms | 190.2 ms | 6.0 ms | 175.0 ms |
 */
export function resultsRow(delayMs: number, localBackend: string, race: RaceSummary): string {
  const cells = [
    `+${delayMs} ms`,
    localBackend,
    formatMs(race.local.median),
    formatMs(race.local.p95),
    ...cloudCells(race.cloud),
  ];
  return `| ${cells.join(' | ')} |`;
}
