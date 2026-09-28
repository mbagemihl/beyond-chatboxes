/**
 * embedding-setup.ts — everything it takes to run a sentence-embedding model
 * with Transformers.js, one step per function: configure it for offline use,
 * choose a backend, load tokenizer + model, and turn texts into vectors.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BONUS TRACK "search" — Meaning without a server                         │
 * │                                                                         │
 * │ Act 2a's lifecycle, one level up: Transformers.js adds a tokenizer,     │
 * │ weight variants (fp32 / q8) and model loading you point at your own     │
 * │ server. It runs inside a Web Worker, so the page never freezes.         │
 * │                                                                         │
 * │ Implement the TODOs below, in order (steps 1–4 are core).               │
 * │   Check your work:  lab verify bonus-search                             │
 * │   Stuck?            lab solve bonus-search                              │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/search                            │
 * │ The page names the next step until search works. Then try a query       │
 * │ whose words appear in NO document ("doctor" vs a talk about being       │
 * │ unwell): keyword search finds nothing, yours ranks it first.            │
 * └─────────────────────────────────────────────────────────────────────────┘
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
 * TODO (bonus search, step 1) — Point Transformers.js at OUR origin and forbid the
 * Hugging Face Hub, so the demo works with the network cable pulled out. On
 * `env`, set:
 *   - `allowRemoteModels` false, `allowLocalModels` true, and `localModelPath`
 *     `/models/` (model files live at /models/<model id>/);
 *   - if `env.backends.onnx.wasm` exists: `wasmPaths` `/wasm/ort/` (ONNX
 *     Runtime's own wasm binaries), `numThreads` 1 and `proxy` false. Without
 *     cross-origin isolation headers there is no SharedArrayBuffer, so
 *     threading would only fail noisily.
 *
 * Until you do this, the model never loads: the library would try the Hub.
 */
export function configureOffline(env: TransformersEnv): void {}

// =============================================================================
// Step 2 — backend + weights
// =============================================================================

/**
 * TODO (bonus search, step 2) — The ordered (device, dtype) pairs to try.
 * Quantization is a deployment decision, not a detail:
 *   * `webgpu` → `fp32`. int8 ops only partially delegate to the GPU, so q8
 *     would actually be slower there.
 *   * `wasm` → `q8`. 4x smaller weights, faster on CPU, small quality cost.
 * WebGPU first when it is usable, and ALWAYS end with wasm.
 */
export function embeddingCandidates(webgpuUsable: boolean): EmbeddingCandidate[] {
  return [];
}

// =============================================================================
// Step 3 — load
// =============================================================================

/**
 * TODO (bonus search, step 3) — Load the tokenizer once
 * (`api.loadTokenizer(modelId)`), then the model for each candidate in turn
 * (`api.loadModel(modelId, candidate)`), and return the first embedder that
 * can embed a warmup text (`await embedTexts(embedder, ['warmup'])`). A model
 * that loads can still fail on its first run.
 *   * Tokenizer fails to load: throw a `SetupError` right away (it is the same
 *     for every backend); mention scripts/download-models.sh.
 *   * A candidate fails to load or to warm up: `console.warn` and try the next.
 *   * Nothing worked: throw a `SetupError` that includes the LAST failure's
 *     message, so the page shows the actual cause.
 */
export async function loadEmbedder(
  api: TransformersApi,
  modelId: string,
  candidates: readonly EmbeddingCandidate[],
): Promise<Embedder> {
  throw new SetupError(
    'Bonus search, step 3 of 4: load the tokenizer and model. Implement loadEmbedder() in embedding-setup.ts.',
  );
}

// =============================================================================
// Step 4 — texts in, vectors out
// =============================================================================

/**
 * TODO (bonus search, step 4) — Texts in, vectors out:
 *   1. `embedder.tokenizer([...texts], { padding: true, truncation: true })`.
 *      Padding makes every text in the batch the same length; truncation cuts
 *      texts longer than the model's maximum.
 *   2. `await embedder.model(inputs)` — its result has `last_hidden_state`:
 *      one vector PER TOKEN, a tensor with `data` and `dims` [batch, seq, hidden].
 *   3. Pass `last_hidden_state.data`, its dims, and the tokenizer's
 *      `attention_mask.data` (which marks the padding) to the given
 *      `sentenceEmbeddings`: one unit-length vector per text.
 *
 * The outputs are `unknown`: check them with the given `isTensorLike`, and
 * throw a `SetupError` if either tensor is missing.
 */
export async function embedTexts(
  embedder: Embedder,
  texts: readonly string[],
): Promise<number[][]> {
  throw new SetupError(
    'Bonus search, step 4 of 4: turn texts into vectors. Implement embedTexts() in embedding-setup.ts.',
  );
}

// =============================================================================
// Stretch — is WebGPU really there?
// =============================================================================

/** The part of `navigator` the WebGPU probe needs. */
export interface NavigatorLike {
  readonly gpu?: { requestAdapter(): Promise<unknown> };
}

/**
 * TODO (bonus search, stretch) — True only if the browser can hand out an actual
 * WebGPU adapter: `await nav.gpu.requestAdapter()` must return something.
 *
 * Checking `'gpu' in navigator` is not enough: headless Chromium, VMs and
 * browsers with WebGPU switched off expose the object, but `requestAdapter()`
 * resolves to `null` or throws. We must know before loading, because a failed
 * WebGPU attempt leaves ONNX Runtime in a state that breaks the wasm fallback
 * too. Until you do this, everyone runs on wasm.
 */
export async function hasUsableWebGPU(nav: NavigatorLike): Promise<boolean> {
  return false;
}
