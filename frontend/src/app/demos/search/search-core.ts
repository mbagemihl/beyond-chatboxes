/**
 * search-core.ts — pure domain types and ranking logic for the search demo.
 *
 * Like {@link ./similarity}, this module is framework-free so the ranking and
 * keyword-matching heuristics can be unit-tested directly (see
 * search-core.spec.ts). The Angular service owns the embeddings and the worker;
 * the actual "given vectors/text, produce ranked results" logic lives here.
 */
import { cosineSimilarity } from './similarity';

/** One seed document (a conference-talk abstract). Shape of seed-docs.json. */
export interface Doc {
  readonly id: string;
  readonly title: string;
  readonly abstract: string;
}

/** A document paired with the score that ranked it, in [-1, 1] (or 0..1). */
export interface ScoredDoc {
  readonly doc: Doc;
  /** Cosine similarity (semantic) or a normalized keyword score. */
  readonly score: number;
}

/** The single text blob we embed / keyword-match against for a document. */
export function docText(doc: Doc): string {
  return `${doc.title}. ${doc.abstract}`;
}

/**
 * TODO (block 2, core) — Rank documents by cosine similarity of their
 * precomputed embeddings against a query embedding.
 *
 * This is the whole search engine: score every document, sort by score
 * descending, keep the best `topK`. There is no index and no server — for a
 * corpus this size, a linear scan over a few hundred vectors is microseconds.
 * That is the point worth taking home: "semantic search" does not require
 * infrastructure until your corpus is genuinely large.
 *
 * `docVectors[i]` is the embedding of `docs[i]` (same order, same length as
 * `queryVector`). Use {@link cosineSimilarity} for the scoring; a negative
 * `topK` must yield an empty array, not a crash.
 */
export function rankBySimilarity(
  queryVector: readonly number[],
  docs: readonly Doc[],
  docVectors: readonly (readonly number[])[],
  topK: number,
): ScoredDoc[] {
  return [];
}

/**
 * Naive substring ("keyword") search — the deliberately dumb baseline the talk
 * contrasts against semantic search. A document matches only if the query text
 * appears verbatim (case-insensitive) in its title/abstract, which is exactly
 * why a query like "doctor" fails to find a talk about "sick leave".
 *
 * Score = number of query-term hits / number of query terms, so a result that
 * contains every word ranks above one that contains only some. Non-matches are
 * dropped. Ties keep the original document order (stable sort).
 */
export function keywordSearch(query: string, docs: readonly Doc[], topK: number): ScoredDoc[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) {
    return [];
  }
  const results: ScoredDoc[] = [];
  for (const doc of docs) {
    const haystack = docText(doc).toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        hits++;
      }
    }
    if (hits > 0) {
      results.push({ doc, score: hits / terms.length });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.max(0, topK));
}
