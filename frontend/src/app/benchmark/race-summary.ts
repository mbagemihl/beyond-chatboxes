/**
 * race-summary.ts — turns the raw timings of one race into the comparison the
 * page shows, and into a row for the results table you fill in during Act 3.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP ACT 3 — Race your own backend                                  │
 * │                                                                         │
 * │ Keep `make backend` running. Implement the TODOs below, then race at    │
 * │ +0, +50 and +150 ms injected WAN latency and copy each results row      │
 * │ into the table in WORKSHOP.md.                                          │
 * │   Check your work:  make verify-3                                       │
 * │   Stuck?            make solve-3                                        │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/benchmark?fixture=1               │
 * │ Until summarizeRace works, a race ends without results.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Pure and framework-free (tested in race-summary.spec.ts). The statistics
 * themselves (median, p95) are given, in stats.ts.
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
 * TODO (act 3) — The part of a backend round trip that is NOT the model:
 * upload, JPEG decode, HTTP, the injected WAN delay, the response.
 *
 *   network share = round-trip median − model-time median, but never below 0
 *
 * (The two medians come from different distributions, so on a fast LAN the
 * difference can dip below 0; clamp it.)
 */
export function networkShare(roundTripMedianMs: number, serverMedianMs: number): number {
  return 0;
}

/**
 * TODO (act 3) — Summarize one race with the given `summarize` (median + p95):
 *   - `local`: the summary of `localMs`;
 *   - `cloud`: null when `cloudRoundTripMs` is empty (the backend never
 *     answered), otherwise `total` (round trips), `server` (model times) and
 *     `networkMedianMs` from your `networkShare`.
 */
export function summarizeRace(timings: RaceTimings): RaceSummary {
  throw new Error('Act 3: implement summarizeRace() in race-summary.ts.');
}

/** Header of the results table in WORKSHOP.md, matching {@link resultsRow}. */
export const RESULTS_HEADER =
  '| injected WAN | local backend | local median | local p95 | cloud median | cloud p95 | server model | network share |\n' +
  '|---|---|---|---|---|---|---|---|';

/**
 * TODO (act 3) — One markdown row for the results table, matching the eight
 * columns of RESULTS_HEADER:
 *
 *   | +150 ms | webgpu | 9.3 ms | 9.8 ms | 181.0 ms | 190.2 ms | 6.0 ms | 175.0 ms |
 *
 * i.e. `+<delay> ms`, the local backend, local median and p95, cloud median
 * and p95, server model median, network share. Every number with one decimal
 * (`toFixed(1)`) and " ms"; the four backend cells are "—" when `race.cloud`
 * is null.
 */
export function resultsRow(delayMs: number, localBackend: string, race: RaceSummary): string {
  return '';
}
