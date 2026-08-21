import { describe, expect, it } from 'vitest';
import { median, percentile, summarize } from './stats';

describe('percentile', () => {
  it('returns NaN for an empty array', () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it('returns the only value for a single-element array', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it('interpolates between ranks (R-7 method)', () => {
    // For [1,2,3,4], p50 rank = 0.5*(3) = 1.5 -> between 2 and 3 -> 2.5
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
    // p95 rank = 0.95*3 = 2.85 -> between 3 and 4 -> 3.85
    expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 10);
  });

  it('is order-independent (does not rely on pre-sorted input)', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBeCloseTo(2.5, 10);
  });

  it('hits exact ranks without interpolation', () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 100)).toBe(30);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    percentile(input, 50);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('median', () => {
  it('odd length -> middle value', () => {
    expect(median([1, 2, 3])).toBe(2);
  });
  it('even length -> mean of the two middle values', () => {
    expect(median([1, 2, 3, 4])).toBeCloseTo(2.5, 10);
  });
});

describe('summarize', () => {
  it('bundles median, p95 and count', () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.median).toBeCloseTo(2.5, 10);
    expect(s.p95).toBeCloseTo(3.85, 10);
    expect(s.count).toBe(4);
  });
});
