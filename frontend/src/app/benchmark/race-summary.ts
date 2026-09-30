/**
 * race-summary.ts — turns the raw timings of one race into the comparison the
 * page shows, and into a row for the results table you fill in during Act 3.
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
 * The part of a backend round trip that is NOT the model: upload, JPEG decode,
 * HTTP, the injected WAN delay, the response. It is the median round trip
 * minus the median model time, clamped at 0 (the two medians come from
 * different distributions, so on a fast LAN the difference can dip below 0).
 */
export function networkShare(roundTripMedianMs: number, serverMedianMs: number): number {
  return Math.max(0, roundTripMedianMs - serverMedianMs);
}

/** Summarize one race. The backend part is null when it produced no timings. */
export function summarizeRace(timings: RaceTimings): RaceSummary {
  const local = summarize(timings.localMs);
  if (timings.cloudRoundTripMs.length === 0) {
    return { local, cloud: null };
  }
  const total = summarize(timings.cloudRoundTripMs);
  const server = summarize(timings.cloudServerMs);
  return {
    local,
    cloud: { total, server, networkMedianMs: networkShare(total.median, server.median) },
  };
}

/** Header of the results table in WORKSHOP.md, matching {@link resultsRow}. */
export const RESULTS_HEADER =
  '| injected WAN | local backend | local median | local p95 | cloud median | cloud p95 | server model | network share |\n' +
  '|---|---|---|---|---|---|---|---|';

/**
 * One markdown row for the results table: the injected delay, then every
 * number in whole-ish milliseconds (one decimal). The backend columns read
 * "—" when the backend did not answer.
 */
export function resultsRow(delayMs: number, localBackend: string, race: RaceSummary): string {
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  const cloud = race.cloud;
  const cells = [
    `+${delayMs} ms`,
    localBackend,
    ms(race.local.median),
    ms(race.local.p95),
    cloud ? ms(cloud.total.median) : '—',
    cloud ? ms(cloud.total.p95) : '—',
    cloud ? ms(cloud.server.median) : '—',
    cloud ? ms(cloud.networkMedianMs) : '—',
  ];
  return `| ${cells.join(' | ')} |`;
}
