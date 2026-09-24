/**
 * pooling.ts — turns the embedding model's raw output into sentence vectors.
 *
 * A sentence-transformer does not output "an embedding". It outputs one 384-dim
 * vector PER TOKEN (`last_hidden_state`, shape [batch, seq, hidden]), padded so
 * every sentence in the batch has the same `seq` length. Collapsing that into
 * one vector per sentence is part of the model's contract — all-MiniLM-L6-v2 was
 * trained with mean pooling followed by L2 normalization, and any other recipe
 * silently produces worse rankings.
 *
 * No Angular / DOM / Transformers.js dependencies on purpose: the worker hands
 * over plain typed arrays, so this is unit-testable against a recorded model
 * output (see pooling.spec.ts and pooling.fixture.json).
 */

/** Shape of a token-embedding tensor: [batch, seq, hidden]. */
export type TokenDims = readonly [batch: number, seq: number, hidden: number];

/**
 * Average each sentence's token vectors, counting ONLY real tokens.
 *
 * `hidden` is the flat, row-major `last_hidden_state` buffer: the vector for
 * token `t` of sentence `b` starts at `(b * seq + t) * hiddenSize`. `mask` is
 * the tokenizer's flat [batch, seq] `attention_mask` — 1 for a real token, 0 for
 * padding. Transformers.js stores it as a BigInt64Array, hence `bigint`.
 *
 * Padding positions still carry non-zero vectors, so averaging over all `seq`
 * positions drags every short sentence toward the "padding" direction. A
 * sentence with no real tokens yields a zero vector rather than NaN.
 */
export function meanPool(
  hidden: ArrayLike<number>,
  dims: TokenDims,
  mask: ArrayLike<number | bigint>,
): number[][] {
  const [batch, seq, size] = dims;
  if (hidden.length !== batch * seq * size) {
    throw new RangeError(`meanPool: expected ${batch * seq * size} values, got ${hidden.length}`);
  }
  if (mask.length !== batch * seq) {
    throw new RangeError(`meanPool: expected mask of ${batch * seq}, got ${mask.length}`);
  }
  const out: number[][] = [];
  for (let b = 0; b < batch; b++) {
    const sum = new Array<number>(size).fill(0);
    let count = 0;
    for (let t = 0; t < seq; t++) {
      if (Number(mask[b * seq + t]) === 0) {
        continue;
      }
      count++;
      const offset = (b * seq + t) * size;
      for (let h = 0; h < size; h++) {
        sum[h] += hidden[offset + h];
      }
    }
    out.push(count === 0 ? sum : sum.map((x) => x / count));
  }
  return out;
}

/**
 * Scale a vector to unit length. After this, cosine similarity is a plain dot
 * product — and, more importantly, every document competes on direction alone,
 * not on how long its abstract happened to be. A zero vector stays zero.
 */
export function l2Normalize(v: readonly number[]): number[] {
  let norm = 0;
  for (const x of v) {
    norm += x * x;
  }
  if (norm === 0) {
    return [...v];
  }
  const inv = 1 / Math.sqrt(norm);
  return v.map((x) => x * inv);
}

/** The full recipe the model was trained with: mean pool, then normalize. */
export function sentenceEmbeddings(
  hidden: ArrayLike<number>,
  dims: TokenDims,
  mask: ArrayLike<number | bigint>,
): number[][] {
  return meanPool(hidden, dims, mask).map(l2Normalize);
}

// =============================================================================
// Backend + weights
// =============================================================================

/** Which accelerator to run on, and which weight file to load for it. */
export interface EmbeddingCandidate {
  readonly backend: 'webgpu' | 'wasm';
  readonly dtype: 'fp32' | 'q8';
}

/**
 * The ordered list of (backend, dtype) pairs the worker tries. Quantization is
 * a deployment decision, not a detail: WebGPU gets full fp32 weights (int8 ops
 * only partially delegate to the GPU, so q8 would be slower there), while wasm
 * gets the 4x smaller q8 weights, which run faster on CPU for a small quality
 * cost. wasm is always the last resort, so the demo never ends up with nothing.
 */
export function embeddingCandidates(webgpuUsable: boolean): EmbeddingCandidate[] {
  const wasm: EmbeddingCandidate = { backend: 'wasm', dtype: 'q8' };
  return webgpuUsable ? [{ backend: 'webgpu', dtype: 'fp32' }, wasm] : [wasm];
}
