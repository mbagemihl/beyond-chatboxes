/**
 * Unit tests for the pure ranking + keyword-matching logic. No TestBed.
 */
import { Doc, docText, keywordSearch, rankBySimilarity } from './search-core';

const DOCS: Doc[] = [
  { id: 'a', title: 'GPU compute', abstract: 'Shaders and buffers on the GPU.' },
  { id: 'b', title: 'Wellbeing', abstract: 'Taking sick leave to recover.' },
  { id: 'c', title: 'Databases', abstract: 'Boring Postgres does everything.' },
];

describe('docText', () => {
  it('joins title and abstract', () => {
    expect(docText(DOCS[0])).toBe('GPU compute. Shaders and buffers on the GPU.');
  });
});

describe('rankBySimilarity', () => {
  // 2-D unit vectors make the cosine ordering obvious by construction.
  const vectors = [
    [1, 0], // a — points "right"
    [0, 1], // b — points "up"
    [-1, 0], // c — points "left"
  ];

  it('ranks the most similar document first', () => {
    const out = rankBySimilarity([1, 0], DOCS, vectors, 3);
    expect(out.map((r) => r.doc.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].score).toBeCloseTo(1, 6);
    expect(out[1].score).toBeCloseTo(0, 6);
    expect(out[2].score).toBeCloseTo(-1, 6);
  });

  it('respects topK', () => {
    const out = rankBySimilarity([1, 0], DOCS, vectors, 2);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.doc.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for topK <= 0', () => {
    expect(rankBySimilarity([1, 0], DOCS, vectors, 0)).toEqual([]);
  });
});

describe('keywordSearch', () => {
  it('finds a verbatim substring, case-insensitively', () => {
    const out = keywordSearch('POSTGRES', DOCS, 10);
    expect(out.map((r) => r.doc.id)).toEqual(['c']);
  });

  it('is the teaching moment: "doctor" does NOT match "sick leave"', () => {
    // The whole point of the demo — keyword search misses the semantic link.
    expect(keywordSearch('doctor', DOCS, 10)).toEqual([]);
  });

  it('scores by fraction of query terms that hit', () => {
    // "gpu" hits doc a (in title+abstract); "postgres" hits doc c.
    const out = keywordSearch('gpu postgres', DOCS, 10);
    const byId = new Map(out.map((r) => [r.doc.id, r.score]));
    expect(byId.get('a')).toBeCloseTo(0.5, 6); // 1 of 2 terms
    expect(byId.get('c')).toBeCloseTo(0.5, 6);
  });

  it('ranks a full match above a partial one', () => {
    const out = keywordSearch('sick recover', DOCS, 10);
    // doc b contains both "sick" and "recover" -> score 1.0, ranked first.
    expect(out[0].doc.id).toBe('b');
    expect(out[0].score).toBeCloseTo(1, 6);
  });

  it('returns nothing for a blank query', () => {
    expect(keywordSearch('   ', DOCS, 10)).toEqual([]);
  });
});
