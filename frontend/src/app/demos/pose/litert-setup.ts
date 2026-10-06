/**
 * litert-setup.ts — everything it takes to run a model with LiteRT.js, one step
 * per function: start the runtime, fetch the model, compile it for the best
 * accelerator, and push a tensor through it.
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
 *   ONNX Runtime natives load on first use      1 loadRuntime   → loadLiteRt
 *   model file on disk (app.pose.model-path)    2 modelBytesFrom → fetch
 *   Criteria…optEngine("OnnxRuntime").build()   4 tryCompile    → loadAndCompile
 *   @PostConstruct warmup predict               5 keepIfWarm
 *   Translator.processInput: NDManager.create   runModel        → createTensor
 *   predictor.predict                           6 runTensor     → model.run
 *   processOutput reading the floats            7 readFirstOutput → data()
 *   predictor/model .close()                    8 deleteAll     → tensor.delete()
 *
 * The pre/post-processing (letterbox, the [y, x, score] decode) is the same on
 * both sides and already written: MoveNet.kt there, pose-math.ts here.
 *
 * Each step is one small function. The functions that string the steps
 * together (startRuntime, fetchModelBytes, compileOnBestAccelerator, runModel)
 * are written for you: read them to see where your step fits.
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

/**
 * A workshop step that is not implemented yet. Its message names the step, and
 * it is never swallowed on the way to the demo's error overlay.
 */
export class TodoError extends SetupError {}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// =============================================================================
// The runtime
// =============================================================================

/**
 * Step 1 — Start the LiteRT.js WebAssembly runtime, loaded from OUR origin
 * (`wasmPath`, e.g. `/wasm/litert/`) — never a CDN, so the demo works offline.
 *
 * DJL counterpart: ONNX Runtime loading its native library the first time an
 * engine is used. Here the "native library" is WebAssembly.
 *
 * The runtime is global to the page: if another demo already started it,
 * `getGlobalLiteRtPromise()` returns that load, so wait for it instead of
 * loading a second copy.
 */
export function loadRuntime(api: LiteRtApi, wasmPath: string): Promise<unknown> {
  return api.getGlobalLiteRtPromise() ?? api.loadLiteRt(wasmPath);
}

/** Step 1, with an error message that says what to check. */
export async function startRuntime(api: LiteRtApi, wasmPath: string): Promise<void> {
  try {
    await loadRuntime(api, wasmPath);
  } catch (err) {
    if (err instanceof SetupError) {
      throw err;
    }
    throw new SetupError(
      `LiteRT runtime failed to load from ${wasmPath}. ` +
        `Was the wasm bundle copied (npm postinstall)? ${messageOf(err)}`,
    );
  }
}

// =============================================================================
// The model file
// =============================================================================

/** The error for a model file the server does not have. */
export function modelMissing(status: number, url: string): SetupError {
  return new SetupError(`Model file missing (${status}) at ${url}. Run: lab download`);
}

/**
 * Step 2 — Turn the server's response into the model's bytes. DJL
 * counterpart: `optModelPath(path)` reading the .onnx from disk; in the
 * browser the model is a file on our own server.
 *
 * A response that is not OK (404: nobody ran the download) must fail with
 * `modelMissing`, not hand LiteRT.js an HTML error page to compile.
 */
export async function modelBytesFrom(res: Response, url: string): Promise<Uint8Array> {
  if (!res.ok) {
    throw modelMissing(res.status, url);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Download the model. We fetch it ourselves (rather than handing LiteRT.js the
 * URL) to give a precise error when the file is missing, and to reuse the same
 * bytes if the first accelerator fails to compile.
 */
export async function fetchModelBytes(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (err) {
    throw new SetupError(`Could not fetch the model: ${messageOf(err)}`);
  }
  return modelBytesFrom(res, url);
}

// =============================================================================
// Compile for the best accelerator
// =============================================================================

/**
 * Step 3 — Which accelerators to try, in order: WebGPU first when the browser
 * has it, and wasm always as the last resort, so the demo never ends up with
 * nothing.
 */
export function acceleratorsToTry(api: LiteRtApi): Accelerator[] {
  return api.isWebGPUSupported() ? ['webgpu', 'wasm'] : ['wasm'];
}

/**
 * Step 4 — Compile the model for one accelerator. DJL counterpart:
 * `Criteria.builder()…optEngine("OnnxRuntime").build().loadModel()`, except the
 * browser has a choice of accelerator the server did not.
 *
 * A compile error is not fatal (the next accelerator may work): log it with
 * `console.warn` and return null.
 */
export async function tryCompile(
  api: LiteRtApi,
  bytes: Uint8Array,
  accelerator: Accelerator,
): Promise<ModelLike | null> {
  try {
    return await api.loadAndCompile(bytes, { accelerator });
  } catch (err) {
    console.warn(`[litert] '${accelerator}' compile failed:`, err);
    return null;
  }
}

/**
 * Step 5 — A model that compiles can still fail to run (a WebGPU adapter
 * without a working device is common on VMs), so run `warmup` on it. DJL
 * counterpart: the `@PostConstruct` warmup in PoseInferenceService.kt.
 *
 * Passed: true. Failed: delete the model and return false — LiteRT.js memory
 * is freed by hand, never by the garbage collector.
 */
export async function keepIfWarm(
  model: ModelLike,
  warmup: (model: ModelLike) => Promise<boolean>,
): Promise<boolean> {
  if (await warmup(model)) {
    return true;
  }
  model.delete();
  return false;
}

/** A model that compiled AND ran, and the accelerator it runs on. */
export interface ReadyModel {
  readonly model: ModelLike;
  readonly accelerator: Accelerator;
}

/** Steps 4 and 5 for each accelerator in turn; the first that works wins. */
export async function compileOnBestAccelerator(
  api: LiteRtApi,
  bytes: Uint8Array,
  accelerators: readonly Accelerator[],
  warmup: (model: ModelLike) => Promise<boolean>,
): Promise<ReadyModel> {
  for (const accelerator of accelerators) {
    const model = await tryCompile(api, bytes, accelerator);
    if (model && (await keepIfWarm(model, warmup))) {
      return { model, accelerator };
    }
  }
  throw new SetupError('The model failed to run on any available backend (WebGPU / wasm).');
}

// =============================================================================
// Run it
// =============================================================================

/**
 * Step 6 — Run the model on one input tensor. DJL counterpart:
 * `predictor.predict`.
 *
 * `model.run` returns the outputs either as an array (a model's default
 * signature) or as a record of named outputs. Return them as an array either
 * way.
 */
export async function runTensor(model: ModelLike, input: TensorLike): Promise<TensorLike[]> {
  const result = await model.run(input);
  return Array.isArray(result) ? result : Object.values(result);
}

/**
 * Step 7 — Read the values of the first output. DJL counterpart:
 * `processOutput` reading the NDArray as floats.
 *
 * `data()` is async because on WebGPU the result lives on the GPU and has to be
 * copied back. No outputs at all: throw a SetupError.
 */
export async function readFirstOutput(outputs: readonly TensorLike[]): Promise<ArrayLike<number>> {
  if (outputs.length === 0) {
    throw new SetupError('The model returned no outputs.');
  }
  return outputs[0].data();
}

/**
 * Step 8 — Free tensors. At 30 fps a leak is 30 tensors a second. (DJL frees
 * NDArrays when their NDManager closes; LiteRT.js has no such scope, so every
 * tensor is deleted by hand.)
 */
export function deleteAll(tensors: readonly TensorLike[]): void {
  for (const tensor of tensors) {
    tensor.delete();
  }
}

/** One inference: the first output tensor's values, and how long it took. */
export interface RunResult {
  readonly output: ArrayLike<number>;
  /** Wall-clock time of run + readback, in milliseconds. */
  readonly ms: number;
}

/**
 * One inference, steps 6–8: wrap `input` in a tensor of `shape` (DJL:
 * `NDManager.create`), run it, read the first output, and free every tensor
 * even when the run throws. The readback is timed together with the run, or
 * the number on the HUD would be a lie. (The ONNX model wants uint8 input,
 * this tflite int32 — each model's file says which, see readInputSpec.)
 */
export async function runModel(
  api: LiteRtApi,
  model: ModelLike,
  input: TypedArray,
  shape: number[],
): Promise<RunResult> {
  const tensor = api.createTensor(input, shape);
  let outputs: TensorLike[] = [];
  try {
    const t0 = performance.now();
    outputs = await runTensor(model, tensor);
    const output = await readFirstOutput(outputs);
    return { output, ms: performance.now() - t0 };
  } finally {
    deleteAll([tensor, ...outputs]);
  }
}

// =============================================================================
// Stretch — ask the model what it wants, and check its answers
// =============================================================================

/** The model's input, as read from the model file itself. */
export interface InputSpec {
  /** Side of the square input image, in pixels (MoveNet Lightning: 192). */
  readonly size: number;
  readonly dtype: 'float32' | 'int32' | 'uint8';
}

/**
 * Stretch 1 — Read the input size and element type from the compiled model
 * rather than hard-coding them: swap in MoveNet Thunder (256×256) and nothing
 * else changes. The first input's shape is [1, height, width, 3]. Fall back to
 * `fallbackSize` and `int32` when the details are missing, and treat any dtype
 * other than `float32` / `uint8` as `int32`.
 */
export function readInputSpec(model: ModelLike, fallbackSize: number): InputSpec {
  const details = model.getInputDetails()[0];
  const size = details?.shape?.[1] ?? fallbackSize;
  const dtype =
    details?.dtype === 'float32' || details?.dtype === 'uint8' ? details.dtype : 'int32';
  return { size, dtype };
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
 * Stretch 2 — Is this output usable? Every value finite and not all zeros. A
 * broken GPU path tends to return NaNs or silence rather than throwing.
 */
export function isUsableOutput(output: ArrayLike<number>): boolean {
  const values = Array.from(output);
  return values.every(Number.isFinite) && values.some((v) => v !== 0);
}

/**
 * The warmup check: run one neutral grey frame and accept the backend only if
 * its output is usable (stretch 2).
 */
export async function warmup(api: LiteRtApi, model: ModelLike, spec: InputSpec): Promise<boolean> {
  const pixels = allocInput(spec.dtype, spec.size * spec.size * 3).fill(128);
  try {
    const { output } = await runModel(api, model, pixels, [1, spec.size, spec.size, 3]);
    return isUsableOutput(output);
  } catch (err) {
    if (err instanceof TodoError) {
      throw err;
    }
    console.warn('[litert] warmup inference failed:', err);
    return false;
  }
}
