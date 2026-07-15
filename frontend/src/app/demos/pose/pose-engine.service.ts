import { Injectable, signal } from '@angular/core';
import {
  CompiledModel,
  DType,
  getGlobalLiteRtPromise,
  isWebGPUSupported,
  loadAndCompile,
  loadLiteRt,
  Tensor,
  TypedArray,
} from '@litertjs/core';
import {
  computeLetterbox,
  Keypoints,
  MOVENET_INPUT_SIZE,
  parseMoveNetOutput,
} from './pose-math';

/** The accelerator actually running inference. */
export type PoseBackend = 'webgpu' | 'wasm';

/** Lifecycle of the engine, surfaced for the UI (spinner / error banner). */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/** One inference result: keypoints plus how long `model.run` took. */
export interface PoseResult {
  readonly keypoints: Keypoints;
  /** Wall-clock inference time in milliseconds (includes GPU readback). */
  readonly inferenceMs: number;
}

/** Served from our own origin (see copy-litert-wasm.mjs / download-models.sh). */
const WASM_PATH = '/wasm/litert/';
const MODEL_URL = '/models/pose/movenet-singlepose-lightning-f16.tflite';

/** Display name for the HUD. */
export const MODEL_NAME = 'MoveNet SinglePose Lightning · f16';

/**
 * Loads and runs the MoveNet SinglePose model via LiteRT.js.
 *
 * Backend policy: prefer WebGPU; if it is unavailable or fails to compile, fall
 * back to wasm (CPU/XNNPACK) and keep working — the UI shows an amber badge.
 * All state (status, backend, error) is exposed as signals so components stay
 * declarative.
 *
 * Memory: LiteRT.js uses manual tensor lifetimes; every input and output tensor
 * created per frame is deleted before the next frame.
 */
@Injectable({ providedIn: 'root' })
export class PoseEngine {
  private readonly statusSignal = signal<EngineStatus>('idle');
  private readonly backendSignal = signal<PoseBackend | null>(null);
  private readonly errorSignal = signal<string | null>(null);

  /** 'idle' | 'loading' | 'ready' | 'error'. */
  readonly status = this.statusSignal.asReadonly();
  /** Active accelerator once ready, otherwise null. */
  readonly backend = this.backendSignal.asReadonly();
  /** Human-readable error when status is 'error'. */
  readonly error = this.errorSignal.asReadonly();
  /** Static model name for the HUD. */
  readonly modelName = MODEL_NAME;

  private model: CompiledModel | null = null;

  // Preprocessing scratch space (allocated once when the model is loaded).
  private inputSize = MOVENET_INPUT_SIZE;
  private inputDType: DType = 'int32';
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private inputBuffer: TypedArray | null = null;

  /**
   * Initialize the runtime and compile the model. Idempotent: repeated calls
   * after a successful load are no-ops. On failure the status signal becomes
   * 'error' with a message; it does not throw.
   */
  async load(): Promise<void> {
    if (this.statusSignal() === 'ready' || this.statusSignal() === 'loading') {
      return;
    }
    this.statusSignal.set('loading');
    this.errorSignal.set(null);

    // 1. Bring up the wasm runtime (idempotent across the whole page).
    try {
      if (!getGlobalLiteRtPromise()) {
        await loadLiteRt(WASM_PATH);
      } else {
        await getGlobalLiteRtPromise();
      }
    } catch (err) {
      this.fail(
        `LiteRT runtime failed to load from ${WASM_PATH}. ` +
          `Was the wasm bundle copied (npm postinstall)? ` +
          this.messageOf(err),
      );
      return;
    }

    // 2. Fetch the model bytes ourselves so we can (a) give a precise
    //    "model missing" error and (b) reuse the bytes for both compile attempts
    //    without downloading twice.
    let modelBytes: Uint8Array;
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) {
        this.fail(
          `Model file missing (${res.status}) at ${MODEL_URL}. ` +
            `Run scripts/download-models.sh.`,
        );
        return;
      }
      modelBytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      this.fail(`Could not fetch the model: ${this.messageOf(err)}`);
      return;
    }

    // 3. Compile + warm up, preferring WebGPU. A backend that compiles can still
    //    fail to actually execute (e.g. a WebGPU adapter that has no working
    //    device — common on headless/VM boxes), so each candidate must pass a
    //    warmup inference before we accept it. Otherwise we fall through to wasm.
    const candidates: PoseBackend[] = isWebGPUSupported()
      ? ['webgpu', 'wasm']
      : ['wasm'];

    for (const backend of candidates) {
      const model = await this.tryCompile(modelBytes, backend);
      if (!model) {
        continue;
      }
      if (!(await this.warmup(model))) {
        console.warn(
          `[PoseEngine] '${backend}' compiled but failed warmup; trying next backend`,
        );
        model.delete();
        continue;
      }
      if (!this.configureInput(model)) {
        model.delete();
        return; // fail() already called (2D context unavailable)
      }
      this.model = model;
      this.backendSignal.set(backend);
      this.statusSignal.set('ready');
      return;
    }

    this.fail('The model failed to run on any available backend (WebGPU / wasm).');
  }

  /**
   * Run the model on the current frame of `video`. Returns keypoints (in source
   * frame normalized coords) and the inference time, or `null` if the engine is
   * not ready or the video has no frame yet.
   *
   * Necessarily async: reading model output back from the GPU is asynchronous.
   */
  async runOnVideoFrame(video: HTMLVideoElement): Promise<PoseResult | null> {
    const model = this.model;
    const ctx = this.ctx;
    const buffer = this.inputBuffer;
    if (!model || !ctx || !buffer) {
      return null;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) {
      return null; // camera not producing frames yet
    }

    // Letterbox the frame into the square model input, preserving aspect ratio.
    const size = this.inputSize;
    const { scaledW, scaledH, padX, padY } = computeLetterbox(vw, vh, size);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(video, padX, padY, scaledW, scaledH);
    const rgba = ctx.getImageData(0, 0, size, size).data;

    // Pack RGBA -> RGB into the (reused) typed input buffer. MoveNet expects
    // pixel values in [0, 255] regardless of quantization.
    for (let p = 0, s = 0; p < size * size; p++, s += 3) {
      const o = p * 4;
      buffer[s] = rgba[o];
      buffer[s + 1] = rgba[o + 1];
      buffer[s + 2] = rgba[o + 2];
    }

    const input = new Tensor(buffer, [1, size, size, 3]);
    let outputs: Tensor[] | null = null;
    try {
      const t0 = performance.now();
      const result = await model.run(input);
      // Default signature returns positional tensors.
      outputs = result as Tensor[];
      const raw = await outputs[0].data();
      const inferenceMs = performance.now() - t0;
      const keypoints = parseMoveNetOutput(raw, vw, vh, size);
      return { keypoints, inferenceMs };
    } finally {
      // Manual memory management: free the per-frame tensors.
      input.delete();
      if (outputs) {
        for (const t of outputs) {
          t.delete();
        }
      }
    }
  }

  /** Release the compiled model (call from the demo component's cleanup). */
  dispose(): void {
    this.model?.delete();
    this.model = null;
    this.inputBuffer = null;
    this.canvas = null;
    this.ctx = null;
    if (this.statusSignal() === 'ready') {
      this.statusSignal.set('idle');
    }
  }

  private async tryCompile(
    bytes: Uint8Array,
    backend: PoseBackend,
  ): Promise<CompiledModel | null> {
    try {
      return await loadAndCompile(bytes, { accelerator: backend });
    } catch (err) {
      console.warn(`[PoseEngine] '${backend}' compile failed:`, err);
      return null;
    }
  }

  /**
   * Run one dummy inference to confirm the backend can actually execute (not
   * just compile). Returns false if the run throws or produces invalid output.
   */
  private async warmup(model: CompiledModel): Promise<boolean> {
    const details = model.getInputDetails()[0];
    const size = details?.shape?.[1] ?? MOVENET_INPUT_SIZE;
    const dtype: DType = details?.dtype ?? 'int32';
    const len = size * size * 3;
    const dummy = this.allocInput(dtype, len);
    dummy.fill(128); // neutral gray

    const input = new Tensor(dummy, [1, size, size, 3]);
    let outputs: Tensor[] | null = null;
    try {
      outputs = (await model.run(input)) as Tensor[];
      const raw = await outputs[0].data();
      return this.isValidOutput(raw);
    } catch (err) {
      console.warn('[PoseEngine] warmup inference failed:', err);
      return false;
    } finally {
      input.delete();
      if (outputs) {
        for (const t of outputs) {
          t.delete();
        }
      }
    }
  }

  /** Output is usable if every value is finite and it is not all zeros. */
  private isValidOutput(raw: ArrayLike<number>): boolean {
    let anyNonZero = false;
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i];
      if (!Number.isFinite(v)) {
        return false;
      }
      if (v !== 0) {
        anyNonZero = true;
      }
    }
    return anyNonZero;
  }

  /** Size the reusable preprocessing buffers. Returns false if no 2D context. */
  private configureInput(model: CompiledModel): boolean {
    const input = model.getInputDetails()[0];
    // MoveNet input shape is [1, H, W, 3] with H === W.
    const size = input?.shape?.[1] ?? MOVENET_INPUT_SIZE;
    this.inputSize = size;
    this.inputDType = input?.dtype ?? 'int32';

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      this.fail('Could not create a 2D context for preprocessing.');
      return false;
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.inputBuffer = this.allocInput(this.inputDType, size * size * 3);
    return true;
  }

  private allocInput(dtype: DType, len: number): TypedArray {
    if (dtype === 'float32') {
      return new Float32Array(len);
    }
    if (dtype === 'uint8') {
      return new Uint8Array(len);
    }
    return new Int32Array(len);
  }

  private fail(message: string): void {
    this.errorSignal.set(message);
    this.statusSignal.set('error');
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
