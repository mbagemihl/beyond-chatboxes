/** Unit tests for race-summary.ts, one block per step — pure, no TestBed. */
import {
  RESULTS_HEADER,
  cloudCells,
  formatMs,
  networkShare,
  resultsRow,
  summarizeCloud,
  summarizeRace,
} from './race-summary';

const timings = {
  localMs: [10, 12, 14],
  cloudRoundTripMs: [30, 32, 34],
  cloudServerMs: [6, 6, 7],
};

describe('Step 1 · networkShare', () => {
  it('is the round trip minus the model time', () => {
    expect(networkShare(31, 6)).toBe(25);
  });

  it('never goes below zero', () => {
    expect(networkShare(5, 6)).toBe(0);
  });
});

describe('Step 2 · summarizeCloud', () => {
  it('splits the backend round trip into model time and network share', () => {
    const cloud = summarizeCloud(timings);
    expect(cloud?.total.median).toBe(32);
    expect(cloud?.server.median).toBe(6);
    expect(cloud?.networkMedianMs).toBe(26);
  });

  it('is null when the backend never answered', () => {
    expect(summarizeCloud({ ...timings, cloudRoundTripMs: [], cloudServerMs: [] })).toBeNull();
  });
});

describe('Step 3 · formatMs', () => {
  it('writes one decimal and the unit', () => {
    expect(formatMs(9.25)).toBe('9.3 ms');
    expect(formatMs(181)).toBe('181.0 ms');
  });
});

describe('Step 4 · cloudCells', () => {
  it('formats the four backend numbers', () => {
    const cloud = summarizeCloud({ localMs: [], cloudRoundTripMs: [181], cloudServerMs: [6.04] });
    expect(cloudCells(cloud)).toEqual(['181.0 ms', '181.0 ms', '6.0 ms', '175.0 ms']);
  });

  it('is four dashes when the backend did not answer', () => {
    expect(cloudCells(null)).toEqual(['—', '—', '—', '—']);
  });
});

describe('All steps together (given summarizeRace and resultsRow)', () => {
  it('summarizes the browser timings', () => {
    expect(summarizeRace(timings).local.median).toBe(12);
  });

  it('writes a row that matches the header, one cell per column', () => {
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
