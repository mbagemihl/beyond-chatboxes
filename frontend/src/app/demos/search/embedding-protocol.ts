/**
 * embedding-protocol.ts — the message contract between the UI thread and the
 * embedding Web Worker. Imported by BOTH sides (service + worker) so the two
 * never drift. No runtime code, only types + tiny constructors.
 */

/** Which accelerator the worker's ONNX Runtime actually chose. */
export type EmbeddingBackend = 'webgpu' | 'wasm';

// --- UI thread -> worker ----------------------------------------------------

/** Ask the worker to load the model and report the backend it settled on. */
export interface InitRequest {
  readonly type: 'init';
}

/** Ask the worker to embed a batch of texts. `id` correlates the response. */
export interface EmbedRequest {
  readonly type: 'embed';
  readonly id: number;
  readonly texts: readonly string[];
}

export type WorkerRequest = InitRequest | EmbedRequest;

// --- worker -> UI thread ----------------------------------------------------

/** The model finished loading and warmed up; inference is now possible. */
export interface ReadyMessage {
  readonly type: 'ready';
  readonly backend: EmbeddingBackend;
  readonly modelName: string;
}

/** Model load / warmup failed on every backend. Fatal for the demo. */
export interface InitErrorMessage {
  readonly type: 'init-error';
  readonly error: string;
}

/** A successful embed: `vectors[i]` is the embedding of `texts[i]`. */
export interface EmbeddedMessage {
  readonly type: 'embedded';
  readonly id: number;
  readonly vectors: number[][];
  /** Wall-clock time inside the worker for this batch, in milliseconds. */
  readonly ms: number;
}

/** A single embed request failed (does not tear down the worker). */
export interface EmbedErrorMessage {
  readonly type: 'embed-error';
  readonly id: number;
  readonly error: string;
}

export type WorkerResponse = ReadyMessage | InitErrorMessage | EmbeddedMessage | EmbedErrorMessage;
