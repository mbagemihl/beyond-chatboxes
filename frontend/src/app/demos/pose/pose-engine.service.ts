import { Injectable, signal } from '@angular/core';
import type { TypedArray } from '@litertjs/core';
import {
  InputSpec,
  ModelLike,
  SetupError,
  acceleratorsToTry,
  allocInput,
  compileOnBestAccelerator,
  fetchModelBytes,
  liteRt,
  readInputSpec,
  runModel,
  startRuntime,
  warmup,
} from './litert-setup';
import { computeLetterbox, Keypoints, MOVENET_INPUT_SIZE, parseMoveNetOutput } from './pose-math';

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
 * Loads and runs the MoveNet SinglePose model via LiteRT.js. The LiteRT.js
 * steps themselves (runtime, fetch, compile with fallback, run) live in
 * litert-setup.ts; this service sequences them and does the pixel work.
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

  private model: ModelLike | null = null;

  // Preprocessing scratch space (allocated once when the model is loaded).
  private inputSize = MOVENET_INPUT_SIZE;
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

    try {
      await startRuntime(liteRt, WASM_PATH);
      const bytes = await fetchModelBytes(MODEL_URL);
      const { model, accelerator } = await compileOnBestAccelerator(
        liteRt,
        bytes,
        acceleratorsToTry(liteRt),
        (candidate) => warmup(liteRt, candidate, readInputSpec(candidate, MOVENET_INPUT_SIZE)),
      );
      if (!this.configureInput(readInputSpec(model, MOVENET_INPUT_SIZE))) {
        model.delete();
        return; // fail() already called (2D context unavailable)
      }
      this.model = model;
      this.backendSignal.set(accelerator);
      this.statusSignal.set('ready');
    } catch (err) {
      this.fail(
        err instanceof SetupError ? err.message : `Model setup failed: ${this.messageOf(err)}`,
      );
    }
  }

  /**
   * Run the model on the current frame of `video`. Returns keypoints (in source
   * frame normalized coords) and the inference time, or `null` if the engine is
   * not ready or the video has no frame yet.
   *
   * Necessarily async: reading model output back from the GPU is asynchronous.
   */
  async runOnVideoFrame(video: HTMLVideoElement): Promise<PoseResult | null> {
    return this.runOnFrame(video, video.videoWidth, video.videoHeight);
  }

  /**
   * Run the model on an arbitrary frame source (a `<video>`, a captured
   * `<canvas>`, an `ImageBitmap`, …) whose intrinsic size is `srcW x srcH`.
   * Returns keypoints in that source's normalized coords plus inference time,
   * or `null` if the engine is not ready or the source has no pixels yet.
   *
   * The benchmark uses this to score the SAME captured still frame the cloud
   * tier receives; the live demo passes its video element via
   * {@link runOnVideoFrame}.
   */
  async runOnFrame(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
  ): Promise<PoseResult | null> {
    const model = this.model;
    const ctx = this.ctx;
    const buffer = this.inputBuffer;
    if (!model || !ctx || !buffer) {
      return null;
    }
    const vw = srcW;
    const vh = srcH;
    if (vw === 0 || vh === 0) {
      return null; // source not producing frames yet
    }

    // Letterbox the frame into the square model input, preserving aspect ratio.
    const size = this.inputSize;
    const { scaledW, scaledH, padX, padY } = computeLetterbox(vw, vh, size);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, padX, padY, scaledW, scaledH);
    const rgba = ctx.getImageData(0, 0, size, size).data;

    // Pack RGBA -> RGB into the (reused) typed input buffer. MoveNet expects
    // pixel values in [0, 255] regardless of quantization.
    for (let p = 0, s = 0; p < size * size; p++, s += 3) {
      const o = p * 4;
      buffer[s] = rgba[o];
      buffer[s + 1] = rgba[o + 1];
      buffer[s + 2] = rgba[o + 2];
    }

    try {
      const { output, ms } = await runModel(liteRt, model, buffer, [1, size, size, 3]);
      const keypoints = parseMoveNetOutput(output, vw, vh, size);
      return { keypoints, inferenceMs: ms };
    } catch (err) {
      // A setup problem will fail every frame the same way: stop the loop and
      // show it once in the overlay, instead of logging it 60 times a second.
      if (err instanceof SetupError) {
        this.fail(err.message);
        return null;
      }
      throw err;
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

  /** Size the reusable preprocessing buffers. Returns false if no 2D context. */
  private configureInput(spec: InputSpec): boolean {
    const size = spec.size;
    this.inputSize = size;

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
    this.inputBuffer = allocInput(spec.dtype, size * size * 3);
    return true;
  }

  private fail(message: string): void {
    this.errorSignal.set(message);
    this.statusSignal.set('error');
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
