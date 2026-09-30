/** Unit tests for race-summary.ts — pure, no TestBed. */
import { RESULTS_HEADER, networkShare, resultsRow, summarizeRace } from './race-summary';

describe('networkShare', () => {
  it('is the round trip minus the model time', () => {
    expect(networkShare(31, 6)).toBe(25);
  });

  it('never goes below zero', () => {
    expect(networkShare(5, 6)).toBe(0);
  });
});

describe('summarizeRace', () => {
  const timings = {
    localMs: [10, 12, 14],
    cloudRoundTripMs: [30, 32, 34],
    cloudServerMs: [6, 6, 7],
  };

  it('summarizes the browser timings', () => {
    expect(summarizeRace(timings).local.median).toBe(12);
  });

  it('splits the backend round trip into model time and network share', () => {
    const cloud = summarizeRace(timings).cloud;
    expect(cloud?.total.median).toBe(32);
    expect(cloud?.server.median).toBe(6);
    expect(cloud?.networkMedianMs).toBe(26);
  });

  it('has no backend part when the backend never answered', () => {
    expect(summarizeRace({ ...timings, cloudRoundTripMs: [], cloudServerMs: [] }).cloud).toBeNull();
  });
});

describe('resultsRow', () => {
  it('matches the header, one cell per column', () => {
    const row = resultsRow(
      0,
      'wasm',
      summarizeRace({ localMs: [10], cloudRoundTripMs: [30], cloudServerMs: [6] }),
    );
    const columns = RESULTS_HEADER.split('\n')[0].split('|').length;
    expect(row.split('|').length).toBe(columns);
  });

  it('writes the delay and every number with one decimal', () => {
    const row = resultsRow(
      150,
      'webgpu',
      summarizeRace({ localMs: [9.25], cloudRoundTripMs: [181], cloudServerMs: [6.04] }),
    );
    expect(row).toBe(
      '| +150 ms | webgpu | 9.3 ms | 9.3 ms | 181.0 ms | 181.0 ms | 6.0 ms | 175.0 ms |',
    );
  });

  it('shows dashes for the backend when it did not answer', () => {
    const row = resultsRow(
      0,
      'wasm',
      summarizeRace({ localMs: [10], cloudRoundTripMs: [], cloudServerMs: [] }),
    );
    expect(row).toBe('| +0 ms | wasm | 10.0 ms | 10.0 ms | — | — | — | — |');
  });
});
