/**
 * similarity.ts — pure, framework-free vector math for the semantic search demo.
 *
 * No Angular / DOM / Transformers.js dependencies on purpose: every function is
 * a plain input -> output transform so it is trivially unit-testable without
 * TestBed (see similarity.spec.ts). The embedding service imports from here; it
 * never re-implements the math.
 */

/**
 * Cosine similarity of two equal-length vectors, in the range [-1, 1].
 *
 * Returns 0 when either vector has zero magnitude (an all-zero embedding has no
 * direction, so "similarity" is undefined — 0 is the safe, neutral answer).
 *
 * Note: the embedding pipeline already L2-normalizes its output, so in practice
 * this reduces to a dot product. We still divide by the norms so the function is
 * correct for *any* input and can be reasoned about in isolation.
 *
 * @throws RangeError if the vectors have different lengths.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
