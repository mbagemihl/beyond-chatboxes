/**
 * similarity.ts — pure, framework-free vector math for the semantic search demo.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP BLOCK 2 — Meaning without a server                             │
 * │                                                                         │
 * │ An embedding model turns text into geometry: 384 floats per document,   │
 * │ where "close together" means "similar in meaning". That is enough to    │
 * │ beat keyword search — with no index server anywhere.                    │
 * │                                                                         │
 * │ Implement the TODOs here and in search-core.ts.                         │
 * │   Check your work:  make verify-2                                       │
 * │   Stuck?            make solve-2                                        │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/search                            │
 * │ Try a query whose words appear in NO document ("sick leave" vs a talk   │
 * │ about "doctor"). Keyword search finds nothing; yours should rank it #1. │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * No Angular / DOM / Transformers.js dependencies on purpose: every function is
 * a plain input -> output transform so it is trivially unit-testable without
 * TestBed (see similarity.spec.ts). The embedding service imports from here; it
 * never re-implements the math.
 */

/**
 * TODO (block 2, core) — Cosine similarity of two equal-length vectors, in the
 * range [-1, 1].
 *
 * Cosine similarity is the cosine of the angle between two vectors: the dot
 * product divided by the product of their magnitudes. It measures DIRECTION and
 * ignores length, which is what you want — a long document and a three-word
 * query can still point the same way.
 *
 *   dot(a, b) / (|a| * |b|)
 *
 * Two rules the specs check:
 *   * Return 0 when either vector has zero magnitude. An all-zero embedding has
 *     no direction, so similarity is undefined and 0 is the safe answer —
 *     dividing by zero would poison the whole ranking with NaN.
 *   * The length-mismatch guard below is given; keep it.
 *
 * Note: the embedding pipeline already L2-normalizes its output, so in practice
 * this reduces to a dot product. Divide by the norms anyway, so the function is
 * correct for *any* input and can be reasoned about in isolation.
 *
 * @throws RangeError if the vectors have different lengths.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  return 0;
}
