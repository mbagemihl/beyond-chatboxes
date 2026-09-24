/**
 * Unit tests for pooling.ts — pure functions, no TestBed, no model at test time.
 * The last group replays a recorded all-MiniLM-L6-v2 forward pass
 * (pooling.fixture.json, from scripts/generate-pooling-fixture.mjs) and checks
 * that our pooling reproduces what Transformers.js' own pipeline produced.
 */
import fixture from './pooling.fixture.json';
import { cosineSimilarity } from './similarity';
import {
  TokenDims,
  embeddingCandidates,
  l2Normalize,
  meanPool,
  sentenceEmbeddings,
} from './pooling';

function expectClose(actual: readonly number[], expected: readonly number[], digits = 5): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((x, i) => expect(x).toBeCloseTo(expected[i], digits));
}

describe('meanPool', () => {
  // batch 1, seq 2, hidden 2: tokens [1, 2] and [3, 4].
  it('averages the token vectors of one sentence', () => {
    const out = meanPool([1, 2, 3, 4], [1, 2, 2], [1, 1]);
    expectClose(out[0], [2, 3]);
  });

  it('ignores padding positions (mask = 0)', () => {
    // The padding token's vector is large on purpose: including it would show.
    const out = meanPool([1, 2, 100, 100], [1, 2, 2], [1, 0]);
    expectClose(out[0], [1, 2]);
  });

  it('pools each sentence of a batch with its own mask', () => {
    // Sentence 0: two real tokens. Sentence 1: one real token + padding.
    const hidden = [1, 1, 3, 3, /* | */ 5, 7, 9, 9];
    const out = meanPool(hidden, [2, 2, 2], [1, 1, 1, 0]);
    expectClose(out[0], [2, 2]);
    expectClose(out[1], [5, 7]);
  });

  it('accepts the BigInt64Array mask the tokenizer really produces', () => {
    const out = meanPool(new Float32Array([2, 4, 8, 8]), [1, 2, 2], new BigInt64Array([1n, 0n]));
    expectClose(out[0], [2, 4]);
  });

  it('returns a zero vector, not NaN, for a sentence with no real tokens', () => {
    const out = meanPool([1, 2, 3, 4], [1, 2, 2], [0, 0]);
    expect(out[0]).toEqual([0, 0]);
  });

  it('throws when the buffer does not match the dims', () => {
    expect(() => meanPool([1, 2, 3], [1, 2, 2], [1, 1])).toThrow(RangeError);
  });
});

describe('l2Normalize', () => {
  it('scales a vector to unit length', () => {
    expectClose(l2Normalize([3, 4]), [0.6, 0.8]);
  });

  it('keeps direction', () => {
    expect(cosineSimilarity(l2Normalize([2, 5, -1]), [2, 5, -1])).toBeCloseTo(1, 6);
  });

  it('leaves a zero vector at zero', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('sentenceEmbeddings on a real model output', () => {
  const dims = fixture.dims as unknown as TokenDims;
  const vectors = sentenceEmbeddings(fixture.hidden, dims, fixture.mask);

  it('produces one 384-dim vector per input text', () => {
    expect(vectors.length).toBe(fixture.texts.length);
    vectors.forEach((v) => expect(v.length).toBe(384));
  });

  it('produces unit-length vectors', () => {
    vectors.forEach((v) => expect(Math.hypot(...v)).toBeCloseTo(1, 5));
  });

  it("matches Transformers.js' own mean-pooling pipeline", () => {
    vectors.forEach((v, i) => expectClose(v, fixture.expected[i], 4));
  });

  it('really needed the mask: pooling the padding too gives a different vector', () => {
    // Same data, but pretend every position is a real token.
    const allOnes = fixture.mask.map(() => 1);
    const unmasked = sentenceEmbeddings(fixture.hidden, dims, allOnes);
    // The short text is mostly padding, so its vector must move noticeably.
    expect(cosineSimilarity(unmasked[0], fixture.expected[0])).toBeLessThan(0.99);
  });
});

describe('embeddingCandidates (stretch)', () => {
  it('prefers WebGPU with fp32, and keeps wasm q8 as the fallback', () => {
    expect(embeddingCandidates(true)).toEqual([
      { backend: 'webgpu', dtype: 'fp32' },
      { backend: 'wasm', dtype: 'q8' },
    ]);
  });

  it('goes straight to wasm q8 without a usable GPU', () => {
    expect(embeddingCandidates(false)).toEqual([{ backend: 'wasm', dtype: 'q8' }]);
  });
});
