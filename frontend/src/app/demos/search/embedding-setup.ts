/**
 * embedding-setup.ts — everything it takes to run a sentence-embedding model
 * with Transformers.js, one step per function: configure it for offline use,
 * choose a backend, load tokenizer + model, and turn texts into vectors.
 *
 * Transformers.js is Hugging Face's JavaScript port of the Python
 * `transformers` library. It runs `.onnx` models on ONNX Runtime Web (WebGPU or
 * wasm) and ships the matching tokenizers. See STACK.md for the overview.
 *
 * Every function takes the library as a parameter ({@link TransformersApi},
 * {@link TransformersEnv}) instead of importing it. The worker passes the real
 * library ({@link transformers}); the specs pass fakes, so each step can be
 * tested without a browser, a GPU or a model file. The maths after the model
 * (mean pooling, normalization) is given, in pooling.ts.
 */
import { AutoModel, AutoTokenizer } from '@huggingface/transformers';
import { sentenceEmbeddings } from './pooling';

// =============================================================================
// The library, as far as this module cares
// =============================================================================

/** A tensor Transformers.js hands back: flat data plus its shape. */
export interface TensorLike {
  readonly data: ArrayLike<number | bigint>;
  readonly dims: readonly number[];
}

/** A tokenizer: texts in, model inputs (input_ids, attention_mask, …) out. */
export type TokenizerLike = (
  texts: string[],
  options: { padding: boolean; truncation: boolean },
) => Record<string, unknown>;

/** A model: tokenizer output in, named output tensors out. */
export type ModelLike = (inputs: Record<string, unknown>) => Promise<unknown>;

/** Where ONNX Runtime runs, and which weights to load for it. */
export interface EmbeddingCandidate {
  readonly device: 'webgpu' | 'wasm';
  readonly dtype: 'fp32' | 'q8';
}

/** The slice of @huggingface/transformers this module uses. */
export interface TransformersApi {
  loadTokenizer(modelId: string): Promise<TokenizerLike>;
  loadModel(modelId: string, options: EmbeddingCandidate): Promise<ModelLike>;
}

/** The part of Transformers.js' global `env` that controls where files come from. */
export interface TransformersEnv {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  localModelPath: string;
  backends?: {
    onnx?: {
      wasm?: { wasmPaths?: unknown; numThreads?: unknown; proxy?: unknown };
    };
  };
}

/** The real library, adapted to {@link TransformersApi}. */
export const transformers: TransformersApi = {
  loadTokenizer: async (modelId) => {
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    return (texts, options) => tokenizer(texts, options);
  },
  loadModel: async (modelId, { device, dtype }) => {
    const model = await AutoModel.from_pretrained(modelId, { device, dtype });
    return (inputs) => model(inputs);
  },
};

/**
 * A setup step failed. `message` is written for the person looking at the
 * screen — the search demo shows it as-is.
 */
export class SetupError extends Error {
  override readonly name = 'SetupError';
}

/** A ready-to-use tokenizer + model pair, and what it runs on. */
export interface Embedder {
  readonly tokenizer: TokenizerLike;
  readonly model: ModelLike;
  readonly candidate: EmbeddingCandidate;
}

function isTensorLike(value: unknown): value is TensorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'dims' in value &&
    Array.isArray(value.dims)
  );
}

// =============================================================================
// Step 1 — offline configuration
// =============================================================================

/**
 * Point Transformers.js at OUR origin and forbid the Hugging Face Hub, so the
 * demo works with the network cable pulled out:
 *   - no remote models, local models from `/models/`;
 *   - ONNX Runtime's wasm binaries from `/wasm/ort/`, one thread, no proxy
 *     worker (without cross-origin isolation headers there is no
 *     SharedArrayBuffer, so threading would only fail noisily).
 */
export function configureOffline(env: TransformersEnv): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = '/wasm/ort/';
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
}

// =============================================================================
// Step 2 — backend + weights
// =============================================================================

/**
 * The ordered (device, dtype) pairs to try. Quantization is a deployment
 * decision, not a detail: WebGPU gets full fp32 weights (int8 ops only
 * partially delegate to the GPU, so q8 would be slower there), while wasm gets
 * the 4x smaller q8 weights, faster on CPU for a small quality cost. wasm is
 * always the last resort.
 */
export function embeddingCandidates(webgpuUsable: boolean): EmbeddingCandidate[] {
  const wasm: EmbeddingCandidate = { device: 'wasm', dtype: 'q8' };
  return webgpuUsable ? [{ device: 'webgpu', dtype: 'fp32' }, wasm] : [wasm];
}

// =============================================================================
// Step 3 — load
// =============================================================================

/**
 * Load the tokenizer once, then the model for each candidate in turn, and keep
 * the first one that can embed a warmup text. A model that loads can still
 * fail on its first run, so loading alone proves nothing.
 *
 * A tokenizer that fails to load is fatal (it is the same for every backend).
 * A candidate that fails to load or warm up is logged and skipped, and the
 * final error names the last failure, so the page shows the actual cause.
 */
export async function loadEmbedder(
  api: TransformersApi,
  modelId: string,
  candidates: readonly EmbeddingCandidate[],
): Promise<Embedder> {
  let tokenizer: TokenizerLike;
  try {
    tokenizer = await api.loadTokenizer(modelId);
  } catch (err) {
    throw new SetupError(
      `The tokenizer for ${modelId} failed to load. Run scripts/download-models.sh. ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  let lastError = 'no candidates';
  for (const candidate of candidates) {
    try {
      const model = await api.loadModel(modelId, candidate);
      const embedder: Embedder = { tokenizer, model, candidate };
      await embedTexts(embedder, ['warmup']);
      return embedder;
    } catch (err) {
      console.warn(`[embedding] '${candidate.device}' failed:`, err);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new SetupError(
    `The embedding model failed to load on any backend (WebGPU / wasm): ${lastError} ` +
      `Check that /models/${modelId}/ and /wasm/ort/ are present ` +
      '(run scripts/download-models.sh and npm install).',
  );
}

// =============================================================================
// Step 4 — texts in, vectors out
// =============================================================================

/**
 * Tokenize a batch (padded so every text has the same length, truncated to
 * the model's maximum), run the model, and turn its output into one vector
 * per text.
 *
 * The model returns `last_hidden_state`: one vector PER TOKEN, shape
 * [batch, seq, hidden]. Hand it to the given `sentenceEmbeddings` together
 * with the tokenizer's `attention_mask`, which marks the padding to ignore.
 */
export async function embedTexts(
  embedder: Embedder,
  texts: readonly string[],
): Promise<number[][]> {
  const inputs = embedder.tokenizer([...texts], { padding: true, truncation: true });
  const outputs = await embedder.model(inputs);
  const hidden: unknown =
    typeof outputs === 'object' && outputs !== null && 'last_hidden_state' in outputs
      ? outputs.last_hidden_state
      : undefined;
  const mask: unknown = inputs['attention_mask'];
  if (!isTensorLike(hidden) || hidden.dims.length !== 3) {
    throw new SetupError('Model output has no [batch, seq, hidden] last_hidden_state.');
  }
  if (!isTensorLike(mask)) {
    throw new SetupError('Tokenizer output has no attention_mask.');
  }
  const [batch, seq, size] = hidden.dims;
  return sentenceEmbeddings(hidden.data as ArrayLike<number>, [batch, seq, size], mask.data);
}

// =============================================================================
// Stretch — is WebGPU really there?
// =============================================================================

/** The part of `navigator` the WebGPU probe needs. */
export interface NavigatorLike {
  readonly gpu?: { requestAdapter(): Promise<unknown> };
}

/**
 * True only if the browser can hand out an actual WebGPU adapter. Checking
 * `'gpu' in navigator` is not enough: headless Chromium, VMs and browsers with
 * WebGPU switched off expose the object, but `requestAdapter()` resolves to
 * `null` or throws. We must know before loading, because a failed WebGPU
 * attempt leaves ONNX Runtime in a state that breaks the wasm fallback too.
 */
export async function hasUsableWebGPU(nav: NavigatorLike): Promise<boolean> {
  if (!nav.gpu) {
    return false;
  }
  try {
    return (await nav.gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}
