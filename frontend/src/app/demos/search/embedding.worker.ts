/// <reference lib="webworker" />
/**
 * embedding.worker.ts — runs the embedding model off the UI thread. All heavy ML
 * work (model load, tokenization, ONNX inference) happens here so
 * search-as-you-type never janks the main thread.
 *
 * The Transformers.js steps themselves (offline config, backend choice, load,
 * embed) live in embedding-setup.ts; this file only sequences them and speaks
 * the message protocol.
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
import { env } from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from './embedding-protocol';
import {
  Embedder,
  SetupError,
  configureOffline,
  embedTexts,
  embeddingCandidates,
  hasUsableWebGPU,
  loadEmbedder,
  transformers,
} from './embedding-setup';

/** Xenova's ONNX export of sentence-transformers/all-MiniLM-L6-v2. */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let embedder: Embedder | null = null;

function post(message: WorkerResponse): void {
  postMessage(message);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The Transformers.js steps from embedding-setup.ts, in order: configure for
 * offline use, probe WebGPU, load on the best backend that warms up.
 */
async function loadModel(): Promise<void> {
  try {
    configureOffline(env);
    // Hard rule: never fetch from a CDN or the Hub at runtime. Refuse to load
    // rather than silently fall back to the network.
    if (env.allowRemoteModels || env.localModelPath !== '/models/') {
      throw new SetupError(
        'Transformers.js is not configured for offline use, so it would fetch the model ' +
          'from the Hugging Face Hub. See configureOffline() in embedding-setup.ts (block 2, step 1).',
      );
    }
    const candidates = embeddingCandidates(await hasUsableWebGPU(navigator));
    if (candidates.length === 0) {
      throw new SetupError(
        'No backend to try: embeddingCandidates() in embedding-setup.ts returned nothing (block 2, step 2).',
      );
    }
    embedder = await loadEmbedder(transformers, MODEL_ID, candidates);
    post({
      type: 'ready',
      backend: embedder.candidate.device,
      modelName: `all-MiniLM-L6-v2 · ${embedder.candidate.dtype}`,
    });
  } catch (err) {
    post({
      type: 'init-error',
      error: err instanceof SetupError ? err.message : `Model setup failed: ${messageOf(err)}`,
    });
  }
}

/** Embed a batch, mean-pooled and L2-normalized (so cosine == dot product). */
async function embed(id: number, texts: readonly string[]): Promise<void> {
  if (!embedder) {
    post({ type: 'embed-error', id, error: 'Model not loaded yet.' });
    return;
  }
  try {
    const t0 = performance.now();
    const vectors = await embedTexts(embedder, texts);
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
