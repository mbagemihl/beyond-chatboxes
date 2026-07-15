/// <reference lib="webworker" />
/**
 * embedding.worker.ts — runs the Transformers.js feature-extraction pipeline off
 * the UI thread. All heavy ML work (model load, tokenization, ONNX inference)
 * happens here so search-as-you-type never janks the main thread.
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
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingBackend, WorkerRequest, WorkerResponse } from './embedding-protocol';

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

let extractor: FeatureExtractionPipeline | null = null;

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

/** One backend option: the device and the weight dtype to load for it. */
interface Candidate {
  readonly backend: EmbeddingBackend;
  readonly dtype: 'fp32' | 'q8';
}

/**
 * Load the pipeline on the best backend that actually works. WebGPU (with fp32
 * weights — int8 only partially delegates) is preferred when a real adapter is
 * available; otherwise wasm with the smaller, faster q8-quantized weights. Each
 * candidate must pass a warmup inference before we accept it.
 */
async function loadModel(): Promise<void> {
  const candidates: Candidate[] = [];
  if (await hasUsableWebGPU()) {
    candidates.push({ backend: 'webgpu', dtype: 'fp32' });
  }
  candidates.push({ backend: 'wasm', dtype: 'q8' });

  for (const { backend, dtype } of candidates) {
    try {
      const candidate = await pipeline('feature-extraction', MODEL_ID, {
        device: backend,
        dtype,
      });
      // Warmup: prove the backend can execute, not just compile.
      await candidate('warmup', { pooling: 'mean', normalize: true });
      extractor = candidate;
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
  if (!extractor) {
    post({ type: 'embed-error', id, error: 'Model not loaded yet.' });
    return;
  }
  try {
    const t0 = performance.now();
    const output = await extractor(texts as string[], {
      pooling: 'mean',
      normalize: true,
    });
    // [batch, hidden] -> number[][]
    const vectors = output.tolist() as number[][];
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
