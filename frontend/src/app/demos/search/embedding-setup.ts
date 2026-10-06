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
 *
 * Each step is one small function. The functions that string the steps
 * together (configureOffline, loadEmbedder, embedTexts) are written for you.
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

/**
 * A workshop step that is not implemented yet. Its message names the step, and
 * it is never swallowed on the way to the page.
 */
export class TodoError extends SetupError {}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
// Offline configuration
// =============================================================================

/**
 * Step 1 — Model files come from OUR origin, never the Hugging Face Hub, so
 * the demo works with the network cable pulled out: no remote models, local
 * models from `/models/` (a model id resolves to /models/<model id>/).
 */
export function configureModelFiles(env: TransformersEnv): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
}

/**
 * Step 2 — ONNX Runtime's own wasm binaries come from `/wasm/ort/`, with one
 * thread and no proxy worker: without cross-origin isolation headers there is
 * no SharedArrayBuffer, so threading would only fail noisily. Some builds of
 * the library have no `env.backends.onnx.wasm`: then there is nothing to set.
 */
export function configureWasm(env: TransformersEnv): void {
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = '/wasm/ort/';
    wasm.numThreads = 1;
    wasm.proxy = false;
  }
}

/** Steps 1 and 2: everything from our own origin. */
export function configureOffline(env: TransformersEnv): void {
  configureModelFiles(env);
  configureWasm(env);
}

// =============================================================================
// Backend + weights
// =============================================================================

/**
 * Step 3 — The ordered (device, dtype) pairs to try. Quantization is a
 * deployment decision, not a detail:
 *   * `webgpu` gets full `fp32` weights: int8 ops only partially delegate to
 *     the GPU, so q8 would actually be slower there;
 *   * `wasm` gets the 4x smaller `q8` weights: faster on CPU, small quality cost.
 * WebGPU first when it is usable, and wasm always as the last resort.
 */
export function embeddingCandidates(webgpuUsable: boolean): EmbeddingCandidate[] {
  const wasm: EmbeddingCandidate = { device: 'wasm', dtype: 'q8' };
  return webgpuUsable ? [{ device: 'webgpu', dtype: 'fp32' }, wasm] : [wasm];
}

// =============================================================================
// Load
// =============================================================================

/**
 * Step 4 — Load the model for one candidate and prove it works: build the
 * embedder, embed one warmup text (a model that loads can still fail on its
 * first run), and return it. Let any error escape: loadEmbedder then tries the
 * next candidate.
 */
export async function tryCandidate(
  api: TransformersApi,
  modelId: string,
  tokenizer: TokenizerLike,
  candidate: EmbeddingCandidate,
): Promise<Embedder> {
  const model = await api.loadModel(modelId, candidate);
  const embedder: Embedder = { tokenizer, model, candidate };
  await embedTexts(embedder, ['warmup']);
  return embedder;
}

/**
 * Load the tokenizer once (a missing one is fatal: it is the same for every
 * backend), then step 4 for each candidate in turn. The final error names the
 * last failure, so the page shows the actual cause.
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
      `The tokenizer for ${modelId} failed to load. Run: lab download. ` + messageOf(err),
    );
  }
  let lastError = 'no candidates';
  for (const candidate of candidates) {
    try {
      return await tryCandidate(api, modelId, tokenizer, candidate);
    } catch (err) {
      if (err instanceof TodoError) {
        throw err;
      }
      console.warn(`[embedding] '${candidate.device}' failed:`, err);
      lastError = messageOf(err);
    }
  }
  throw new SetupError(
    `The embedding model failed to load on any backend (WebGPU / wasm): ${lastError} ` +
      `Check that /models/${modelId}/ and /wasm/ort/ are present ` +
      '(run lab download and npm install).',
  );
}

// =============================================================================
// Texts in, vectors out
// =============================================================================

/**
 * Step 5 — Tokenize a batch of texts. Padding makes every text in the batch the
 * same length; truncation cuts texts longer than the model's maximum.
 */
export function tokenize(embedder: Embedder, texts: readonly string[]): Record<string, unknown> {
  return embedder.tokenizer([...texts], { padding: true, truncation: true });
}

/**
 * Step 6 — Take the tensor called `name` out of a library result. Results are
 * `unknown`: check that `name` is there and is a tensor (the given
 * `isTensorLike`), and throw a SetupError naming it when it is not.
 */
export function tensorNamed(result: unknown, name: string): TensorLike {
  const value: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, name) : undefined;
  if (!isTensorLike(value)) {
    throw new SetupError(`The model result has no ${name}.`);
  }
  return value;
}

/**
 * Texts in, vectors out: tokenize (step 5), run the model, and pool its
 * `last_hidden_state` — one vector PER TOKEN, [batch, seq, hidden] — into one
 * unit-length vector per text, ignoring the padding the `attention_mask`
 * marks. The pooling maths is given, in pooling.ts.
 */
export async function embedTexts(
  embedder: Embedder,
  texts: readonly string[],
): Promise<number[][]> {
  const inputs = tokenize(embedder, texts);
  const outputs = await embedder.model(inputs);
  const hidden = tensorNamed(outputs, 'last_hidden_state');
  const mask = tensorNamed(inputs, 'attention_mask');
  if (hidden.dims.length !== 3) {
    throw new SetupError('The model result has no [batch, seq, hidden] last_hidden_state.');
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
 * Stretch — True only if the browser can hand out an actual WebGPU adapter.
 * Checking `'gpu' in navigator` is not enough: headless Chromium, VMs and browsers with
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
