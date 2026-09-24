/// <reference lib="webworker" />
/**
 * embedding.worker.ts — runs the embedding model off the UI thread. All heavy ML
 * work (model load, tokenization, ONNX inference) happens here so
 * search-as-you-type never janks the main thread.
 *
 * We call the tokenizer and the model directly rather than the one-line
 * `pipeline('feature-extraction')`, so the step that turns per-token outputs
 * into one sentence vector is ours and visible — see pooling.ts.
 *
 * Hard rules (CLAUDE.md) enforced here, in the worker, because this is where the
 * ONNX Runtime actually runs:
 *   - Never touch a CDN at runtime. `env.allowRemoteModels = false` forbids the
 *     Hugging Face Hub; model files are served from our origin under /models/,
 *     and the ORT wasm binaries from /wasm/ort/ (see copy-ort-wasm.mjs +
 *     download-models.sh).
 *   - Prefer WebGPU; fall back to wasm if it is unavailable or fails, and report
 *     which backend won so the HUD can show the amber "wasm" badge.
 */
import {
  AutoModel,
  AutoTokenizer,
  Tensor,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from './embedding-protocol';
import { embeddingCandidates, sentenceEmbeddings, type TokenDims } from './pooling';

/** Xenova's ONNX export of sentence-transformers/all-MiniLM-L6-v2. */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// --- Offline / self-hosted configuration ------------------------------------
// Forbid the Hub entirely and pin every artifact to our own origin.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
const wasmBackend = env.backends?.onnx?.wasm;
if (wasmBackend) {
  wasmBackend.wasmPaths = '/wasm/ort/';
  // No cross-origin isolation headers are set, so SharedArrayBuffer threading
  // is unavailable anyway; pin to a single thread and skip the proxy worker so
  // the runtime never tries (and noisily fails) to spawn threads.
  wasmBackend.numThreads = 1;
  wasmBackend.proxy = false;
}

/** A loaded tokenizer + model pair; both must exist before we can embed. */
interface Embedder {
  readonly tokenizer: PreTrainedTokenizer;
  readonly model: PreTrainedModel;
}

let embedder: Embedder | null = null;

function post(message: WorkerResponse): void {
  postMessage(message);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Probe for an *actually usable* WebGPU device. Checking `'gpu' in navigator` is
 * not enough: headless Chromium (and browsers with WebGPU disabled) expose the
 * object but `requestAdapter()` returns null / throws. We must resolve an
 * adapter, because a failed WebGPU pipeline attempt poisons ONNX Runtime's
 * backend state and breaks the subsequent wasm fallback — so we only ever build
 * the backend we know can work.
 */
async function hasUsableWebGPU(): Promise<boolean> {
  const gpu = (
    navigator as unknown as {
      gpu?: { requestAdapter(): Promise<unknown> };
    }
  ).gpu;
  if (!gpu) {
    return false;
  }
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * Tokenize a batch, run the model, and pool its per-token output into one
 * unit-length vector per text. Padding makes the batch rectangular; the
 * attention mask tells the pooling which positions are real.
 */
async function runEmbedder({ tokenizer, model }: Embedder, texts: string[]): Promise<number[][]> {
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const outputs: unknown = await model(inputs);
  const hidden: unknown =
    outputs && typeof outputs === 'object' && 'last_hidden_state' in outputs
      ? outputs.last_hidden_state
      : undefined;
  if (!(hidden instanceof Tensor) || hidden.dims.length !== 3) {
    throw new Error('Model output has no [batch, seq, hidden] last_hidden_state.');
  }
  const mask: unknown = inputs.attention_mask;
  if (!(mask instanceof Tensor)) {
    throw new Error('Tokenizer output has no attention_mask.');
  }
  const [batch, seq, size] = hidden.dims;
  const dims: TokenDims = [batch, seq, size];
  return sentenceEmbeddings(
    hidden.data as ArrayLike<number>,
    dims,
    mask.data as ArrayLike<number | bigint>,
  );
}

/**
 * Load tokenizer + model on the best backend that actually works; the order and
 * the weight precision per backend come from `embeddingCandidates`. Each
 * candidate must pass a warmup inference before we accept it.
 */
async function loadModel(): Promise<void> {
  let tokenizer: PreTrainedTokenizer;
  try {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  } catch (err) {
    console.warn('[embedding.worker] tokenizer failed to load:', err);
    postInitError();
    return;
  }

  for (const { backend, dtype } of embeddingCandidates(await hasUsableWebGPU())) {
    try {
      const model = await AutoModel.from_pretrained(MODEL_ID, { device: backend, dtype });
      const candidate: Embedder = { tokenizer, model };
      // Warmup: prove the backend can execute, not just compile.
      await runEmbedder(candidate, ['warmup']);
      embedder = candidate;
      post({
        type: 'ready',
        backend,
        modelName: `all-MiniLM-L6-v2 · ${dtype}`,
      });
      return;
    } catch (err) {
      console.warn(`[embedding.worker] '${backend}' backend failed:`, err);
    }
  }
  postInitError();
}

function postInitError(): void {
  post({
    type: 'init-error',
    error:
      'The embedding model failed to load on any backend (WebGPU / wasm). ' +
      'Check that /models/Xenova/all-MiniLM-L6-v2/ and /wasm/ort/ are present ' +
      '(run scripts/download-models.sh and npm install).',
  });
}

/** Embed a batch, mean-pooled and L2-normalized (so cosine == dot product). */
async function embed(id: number, texts: readonly string[]): Promise<void> {
  if (!embedder) {
    post({ type: 'embed-error', id, error: 'Model not loaded yet.' });
    return;
  }
  try {
    const t0 = performance.now();
    const vectors = await runEmbedder(embedder, [...texts]);
    const ms = performance.now() - t0;
    post({ type: 'embedded', id, vectors, ms });
  } catch (err) {
    post({ type: 'embed-error', id, error: messageOf(err) });
  }
}

addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      void loadModel();
      break;
    case 'embed':
      void embed(msg.id, msg.texts);
      break;
  }
});
