/**
 * litert-setup.ts — everything it takes to run a model with LiteRT.js, one step
 * per function: start the runtime, fetch the model, compile it for the best
 * accelerator, and push a tensor through it.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP ACT 2a — Into the browser: one still image                     │
 * │                                                                         │
 * │ Move the Act 1 backend's model into the browser. Each TODO below names  │
 * │ the DJL call it replaces (docs/backend-tour.md, and the table below).   │
 * │ Five LiteRT.js calls do it: loadLiteRt, loadAndCompile, new Tensor,     │
 * │ model.run, tensor.delete().                                             │
 * │                                                                         │
 * │ Implement the TODOs below, in order (steps 1–4 are core).               │
 * │   Check your work:  make verify-1                                       │
 * │   Stuck?            make solve-1                                        │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/pose/still                        │
 * │ The error overlay names the next step until the skeleton appears; then  │
 * │ press "Compare with backend" (keep make backend running).               │
 * │ Call the library through `api` (e.g. `api.loadLiteRt(...)`), never by   │
 * │ importing it: that is what lets the specs check each call.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * LiteRT.js is Google's browser runtime for `.tflite` models (the successor of
 * TensorFlow Lite for the web). Its API is small, and these five calls are the
 * whole lifecycle: `loadLiteRt`, `loadAndCompile`, `new Tensor`, `model.run`,
 * `tensor.delete()`. See STACK.md for how it fits next to the other runtimes.
 *
 * This is a MIGRATION of the Act 1 backend (backend/src/main/kotlin/…/pose/):
 * every step below has a DJL counterpart you have already seen running.
 *
 *   DJL on the JVM                              LiteRT.js in the browser
 *   ─────────────────────────────────────────   ─────────────────────────────
 *   ONNX Runtime natives load on first use      startRuntime   → loadLiteRt
 *   model file on disk (app.pose.model-path)    fetchModelBytes → fetch
 *   Criteria…optEngine("OnnxRuntime").build()   compileOnBestAccelerator
 *                                                  → loadAndCompile + accelerator
 *   @PostConstruct warmup predict               warmup
 *   Translator.processInput: NDManager.create   runModel → new Tensor
 *   predictor.predict                           runModel → model.run + data()
 *   predictor/model .close()                    tensor.delete(), model.delete()
 *
 * The pre/post-processing (letterbox, the [y, x, score] decode) is the same on
 * both sides and already written: MoveNet.kt there, pose-math.ts here.
 *
 * Every function takes the LiteRT.js API as a parameter ({@link LiteRtApi})
 * instead of importing it directly. PoseEngine passes the real library
 * ({@link liteRt}); the specs pass a fake, so each step can be tested without a
 * browser, a GPU or a model file.
 */
import {
  getGlobalLiteRtPromise,
  isWebGPUSupported,
  loadAndCompile,
  loadLiteRt,
  Tensor,
  type TypedArray,
} from '@litertjs/core';

/** An accelerator LiteRT.js can compile a model for. */
export type Accelerator = 'webgpu' | 'wasm';

/** A tensor as far as this module cares: read it back, then free it. */
export interface TensorLike {
  data(): Promise<ArrayLike<number>>;
  delete(): void;
}

/** What the model says about one of its inputs. */
export interface InputDetails {
  readonly shape: ArrayLike<number>;
  readonly dtype: string;
}

/** A compiled model as far as this module cares. */
export interface ModelLike {
  getInputDetails(): readonly InputDetails[];
  run(input: TensorLike): Promise<TensorLike[] | Record<string, TensorLike>>;
  delete(): void;
}

/** The slice of @litertjs/core this module uses. */
export interface LiteRtApi {
  loadLiteRt(wasmPath: string): Promise<unknown>;
  getGlobalLiteRtPromise(): Promise<unknown> | undefined;
  isWebGPUSupported(): boolean;
  loadAndCompile(model: Uint8Array, options: { accelerator: Accelerator }): Promise<ModelLike>;
  createTensor(data: TypedArray, shape: number[]): TensorLike;
}

/** The real library, adapted to {@link LiteRtApi}. */
export const liteRt: LiteRtApi = {
  loadLiteRt: (wasmPath) => loadLiteRt(wasmPath),
  getGlobalLiteRtPromise: () => getGlobalLiteRtPromise(),
  isWebGPUSupported: () => isWebGPUSupported(),
  loadAndCompile: async (model, options) => {
    const compiled = await loadAndCompile(model, options);
    return {
      getInputDetails: () => compiled.getInputDetails(),
      run: (input) => {
        // Inputs always come from createTensor below, so this never fires; it
        // narrows the structural TensorLike back to the library's class.
        if (!(input instanceof Tensor)) {
          throw new TypeError('LiteRT.js can only run tensors made by createTensor().');
        }
        return compiled.run(input);
      },
      delete: () => compiled.delete(),
    };
  },
  createTensor: (data, shape) => new Tensor(data, shape),
};

/**
 * A setup step failed. `message` is written for the person looking at the
 * screen — PoseEngine shows it in the demo's error overlay as-is.
 */
export class SetupError extends Error {
  override readonly name = 'SetupError';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// =============================================================================
// Step 1 — the runtime
// =============================================================================

/**
 * TODO (act 2a, step 1) — [DJL: ONNX Runtime loading its native library]
 * Start the LiteRT.js WebAssembly runtime, loaded from
 * OUR origin: `api.loadLiteRt(wasmPath)` with e.g. `/wasm/litert/`. Never a
 * CDN, so the demo works offline.
 *
 * The runtime is global to the page. If another demo already started it,
 * `api.getGlobalLiteRtPromise()` returns that load (otherwise `undefined`):
 * wait for it instead of loading a second copy.
 *
 * If loading fails, throw a `SetupError` whose message names `wasmPath` and
 * hints at the fix ("was the wasm bundle copied by npm postinstall?"). That
 * message is exactly what the demo's error overlay will show.
 */
export async function startRuntime(api: LiteRtApi, wasmPath: string): Promise<void> {
  throw new SetupError(
    'Act 2a, step 1 of 4: start the LiteRT.js runtime. Implement startRuntime() in litert-setup.ts.',
  );
}

// =============================================================================
// Step 2 — the model file
// =============================================================================

/**
 * TODO (act 2a, step 2) — [DJL: optModelPath(path) reading the .onnx]
 * Download the model file and return its bytes
 * (`new Uint8Array(await res.arrayBuffer())`). Use `fetchFn`, not `fetch`
 * directly, so the specs can hand you a fake response.
 *
 * We fetch it ourselves (rather than handing LiteRT.js the URL) to give a
 * precise error when the file is missing, and to reuse the same bytes if the
 * first accelerator fails to compile. Throw a `SetupError`:
 *   * on a non-OK response: include the status code, the URL, and the fix,
 *     "Run scripts/download-models.sh.";
 *   * when the fetch itself fails (network, CORS).
 */
export async function fetchModelBytes(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  throw new SetupError(
    'Act 2a, step 2 of 4: fetch the model file. Implement fetchModelBytes() in litert-setup.ts.',
  );
}

// =============================================================================
// Step 3 — compile for the best accelerator
// =============================================================================

/**
 * TODO (act 2a, step 3a) — Which accelerators to try, in order: WebGPU first
 * when `api.isWebGPUSupported()`, and wasm ALWAYS as the last resort, so the
 * demo never ends up with nothing. Until you do this, everyone runs on wasm.
 */
export function acceleratorsToTry(api: LiteRtApi): Accelerator[] {
  return ['wasm'];
}

/** A model that compiled AND ran, and the accelerator it runs on. */
export interface ReadyModel {
  readonly model: ModelLike;
  readonly accelerator: Accelerator;
}

/**
 * TODO (act 2a, step 3b) — [DJL: Criteria…optEngine("OnnxRuntime")…loadModel()
 * plus the @PostConstruct warmup] Compile the model for each accelerator in turn
 * (`api.loadAndCompile(bytes, { accelerator })`) and return the first one that
 * both compiles AND passes `warmup(model)`.
 *
 * A backend that compiles can still fail to execute (a WebGPU adapter without
 * a working device is common on VMs), so compiling alone proves nothing.
 *   * A compile error: log it (`console.warn`) and try the next accelerator.
 *   * Compiled but failed warmup: call `model.delete()` before moving on.
 *     LiteRT.js memory is freed manually, never by the garbage collector.
 *   * Nothing worked: throw a `SetupError`.
 */
export async function compileOnBestAccelerator(
  api: LiteRtApi,
  bytes: Uint8Array,
  accelerators: readonly Accelerator[],
  warmup: (model: ModelLike) => Promise<boolean>,
): Promise<ReadyModel> {
  throw new SetupError(
    'Act 2a, step 3 of 4: compile the model. Implement compileOnBestAccelerator() in litert-setup.ts.',
  );
}

// =============================================================================
// Step 4 — run it
// =============================================================================

/** One inference: the first output tensor's values, and how long it took. */
export interface RunResult {
  readonly output: ArrayLike<number>;
  /** Wall-clock time of run + readback, in milliseconds. */
  readonly ms: number;
}

/**
 * TODO (act 2a, step 4) — [DJL: Translator.processInput (NDManager.create),
 * predictor.predict, processOutput] Run one inference:
 *   1. wrap `input` in a tensor: `api.createTensor(input, shape)`;
 *   2. `await model.run(tensor)` — it returns positional outputs (an array) or
 *      named ones (a record); take the first output either way;
 *   3. `await output.data()` — async, because on WebGPU the result lives on
 *      the GPU and has to be copied back. Time steps 2 and 3 together with
 *      `performance.now()`, or the number on the HUD is a lie.
 *
 * Then delete EVERY tensor — the input and all outputs — even when `run`
 * throws (use `finally`). At 30 fps a leak is 30 tensors a second.
 */
export async function runModel(
  api: LiteRtApi,
  model: ModelLike,
  input: TypedArray,
  shape: number[],
): Promise<RunResult> {
  throw new SetupError(
    'Act 2a, step 4 of 4: run the model. Implement runModel() in litert-setup.ts.',
  );
}

// =============================================================================
// Stretch — ask the model what it wants
// =============================================================================

/** The model's input, as read from the model file itself. */
export interface InputSpec {
  /** Side of the square input image, in pixels (MoveNet Lightning: 192). */
  readonly size: number;
  readonly dtype: 'float32' | 'int32' | 'uint8';
}

/**
 * TODO (act 2a, stretch) — Read the input size and element type from the
 * compiled model instead of hard-coding them: swap in MoveNet Thunder
 * (256×256) and nothing else changes.
 *
 * `model.getInputDetails()[0]` has `shape` — [1, height, width, 3] — and
 * `dtype`. Fall back to `fallbackSize` and `int32` when the details are
 * missing, and treat any dtype other than `float32` / `uint8` as `int32`.
 */
export function readInputSpec(model: ModelLike, fallbackSize: number): InputSpec {
  return { size: fallbackSize, dtype: 'int32' };
}

/** A zeroed buffer of `length` elements of the given element type. */
export function allocInput(dtype: InputSpec['dtype'], length: number): TypedArray {
  switch (dtype) {
    case 'float32':
      return new Float32Array(length);
    case 'uint8':
      return new Uint8Array(length);
    case 'int32':
      return new Int32Array(length);
  }
}

/**
 * TODO (act 2a, stretch) — The warmup check: run one neutral grey frame (every
 * value 128, shaped [1, size, size, 3]) through `runModel` and accept the
 * backend only if the output is usable — every value finite and not all
 * zeros. A broken GPU path tends to return NaNs or silence rather than throw,
 * so return false for those, and for a run that throws.
 *
 * Until you do this, every backend that compiles is trusted blindly.
 */
export async function warmup(api: LiteRtApi, model: ModelLike, spec: InputSpec): Promise<boolean> {
  return true;
}
