/**
 * Unit tests for the pure similarity module. No TestBed, no DOM — just math.
 */
import { cosineSimilarity } from './similarity';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('returns 1 for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 0, 0], [5, 0, 0])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6);
  });

  it('is symmetric', () => {
    const a = [0.2, -0.5, 0.9, 0.1];
    const b = [0.7, 0.3, -0.2, 0.6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 12);
  });

  it('matches a hand-computed value', () => {
    // dot = 1*3 + 2*4 = 11; |a| = sqrt(5); |b| = 5; cos = 11 / (sqrt(5)*5)
    const expected = 11 / (Math.sqrt(5) * 5);
    expect(cosineSimilarity([1, 2], [3, 4])).toBeCloseTo(expected, 12);
  });

  it('treats a zero vector as similarity 0 (no direction)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
});
