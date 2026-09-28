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
 * Start the LiteRT.js WebAssembly runtime, loaded from OUR origin (`wasmPath`,
 * e.g. `/wasm/litert/`) — never a CDN, so the demo works offline.
 *
 * The runtime is global to the page: if another demo already started it,
 * `getGlobalLiteRtPromise()` returns that load, and we wait for it instead of
 * loading a second copy.
 */
export async function startRuntime(api: LiteRtApi, wasmPath: string): Promise<void> {
  try {
    const running = api.getGlobalLiteRtPromise();
    await (running ?? api.loadLiteRt(wasmPath));
  } catch (err) {
    throw new SetupError(
      `LiteRT runtime failed to load from ${wasmPath}. ` +
        `Was the wasm bundle copied (npm postinstall)? ${messageOf(err)}`,
    );
  }
}

// =============================================================================
// Step 2 — the model file
// =============================================================================

/**
 * Download the model as bytes. We fetch it ourselves (rather than handing
 * LiteRT.js the URL) to give a precise error when the file is missing, and to
 * reuse the same bytes if the first accelerator fails to compile.
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
  if (!res.ok) {
    throw new SetupError(
      `Model file missing (${res.status}) at ${url}. Run scripts/download-models.sh.`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

// =============================================================================
// Step 3 — compile for the best accelerator
// =============================================================================

/** WebGPU first when the browser has it, and wasm always as the last resort. */
export function acceleratorsToTry(api: LiteRtApi): Accelerator[] {
  return api.isWebGPUSupported() ? ['webgpu', 'wasm'] : ['wasm'];
}

/** A model that compiled AND ran, and the accelerator it runs on. */
export interface ReadyModel {
  readonly model: ModelLike;
  readonly accelerator: Accelerator;
}

/**
 * Compile the model for each accelerator in turn and keep the first one that
 * both compiles and passes `warmup`. A backend that compiles can still fail to
 * execute (a WebGPU adapter without a working device is common on VMs), so
 * compiling alone proves nothing.
 *
 * A compile error is logged and skipped. A model that compiled but failed its
 * warmup must be deleted — LiteRT.js memory is freed manually, never by the
 * garbage collector.
 */
export async function compileOnBestAccelerator(
  api: LiteRtApi,
  bytes: Uint8Array,
  accelerators: readonly Accelerator[],
  warmup: (model: ModelLike) => Promise<boolean>,
): Promise<ReadyModel> {
  for (const accelerator of accelerators) {
    let model: ModelLike;
    try {
      model = await api.loadAndCompile(bytes, { accelerator });
    } catch (err) {
      console.warn(`[litert] '${accelerator}' compile failed:`, err);
      continue;
    }
    if (await warmup(model)) {
      return { model, accelerator };
    }
    console.warn(`[litert] '${accelerator}' compiled but failed warmup; trying next`);
    model.delete();
  }
  throw new SetupError('The model failed to run on any available backend (WebGPU / wasm).');
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
 * Wrap `input` in a tensor of `shape`, run the model, and read back the first
 * output. `run` returns positional outputs (an array) for a model's default
 * signature, or named ones (a record) — take the first either way.
 *
 * Reading the output (`await tensor.data()`) is async because on WebGPU the
 * result lives on the GPU and has to be copied back; time it together with
 * `run`, or the number on the HUD is a lie.
 *
 * Every tensor — the input and ALL outputs — must be deleted afterwards, even
 * when `run` throws. At 30 fps a leak is 30 tensors a second.
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
    const result = await model.run(tensor);
    outputs = Array.isArray(result) ? result : Object.values(result);
    if (outputs.length === 0) {
      throw new SetupError('The model returned no outputs.');
    }
    const output = await outputs[0].data();
    return { output, ms: performance.now() - t0 };
  } finally {
    tensor.delete();
    for (const t of outputs) {
      t.delete();
    }
  }
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
 * Read the input size and element type from the compiled model rather than
 * hard-coding them: swap in MoveNet Thunder (256×256) and nothing else changes.
 * The first input's shape is [1, height, width, 3]. Fall back to `fallbackSize`
 * and `int32` when the details are missing, and treat any dtype other than
 * `float32` / `uint8` as `int32`.
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
 * The warmup check: run one neutral grey frame and accept the backend only if
 * the output is usable — every value finite and not all zeros. (A broken GPU
 * path tends to return NaNs or silence rather than throwing.)
 */
export async function warmup(api: LiteRtApi, model: ModelLike, spec: InputSpec): Promise<boolean> {
  const pixels = allocInput(spec.dtype, spec.size * spec.size * 3).fill(128);
  try {
    const { output } = await runModel(api, model, pixels, [1, spec.size, spec.size, 3]);
    let anyNonZero = false;
    for (let i = 0; i < output.length; i++) {
      if (!Number.isFinite(output[i])) {
        return false;
      }
      anyNonZero ||= output[i] !== 0;
    }
    return anyNonZero;
  } catch (err) {
    console.warn('[litert] warmup inference failed:', err);
    return false;
  }
}
