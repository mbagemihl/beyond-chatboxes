import { Injectable, signal } from '@angular/core';
import { OEM, createWorker, type ImageLike, type Worker } from 'tesseract.js';

/**
 * OCR lifecycle surfaced to the UI. `loading` = spinning up the worker + core;
 * `recognizing` = a scan is in flight.
 */
export type OcrStatus = 'idle' | 'loading' | 'ready' | 'recognizing' | 'error';

/** Languages we recognize: English + German (the talk is a German conference). */
const LANGS = ['eng', 'deu'] as const;

/**
 * Self-hosted asset locations (CLAUDE.md hard rule: never a CDN at runtime).
 *   - worker + WebAssembly core: copied to /wasm/tesseract/ by the postinstall
 *     hook (copy-tesseract-wasm.mjs);
 *   - language data: fetched to /models/tesseract/ by scripts/download-models.sh
 *     as UNCOMPRESSED tessdata_fast files, hence `gzip: false`.
 */
const WORKER_PATH = '/wasm/tesseract/worker.min.js';
const CORE_PATH = '/wasm/tesseract/';
const LANG_PATH = '/models/tesseract/';

/** Result of one recognition pass. */
export interface OcrResult {
  readonly text: string;
  /** Tesseract's mean word confidence for the page, 0–100. */
  readonly confidence: number;
  /** Wall-clock recognition time in milliseconds. */
  readonly ms: number;
}

/**
 * Owns the warm Tesseract.js {@link Worker} and exposes recognition as a
 * signal-driven service. Root-scoped and initialized once: re-entering the
 * smart-form route reuses the warm worker so the on-stage second scan is fast.
 *
 * Tesseract.js always runs on WebAssembly (there is no WebGPU path), so the HUD
 * badge is always `wasm` — reported here for consistency with the other demos.
 * Every failure mode (worker/core missing, language data missing, recognition
 * error) maps to an explicit status + human message, never a blank screen.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  private readonly statusSignal = signal<OcrStatus>('idle');
  private readonly errorSignal = signal<string | null>(null);
  private readonly modelNameSignal = signal<string>(`Tesseract · ${LANGS.join('+')}`);
  private readonly lastMsSignal = signal(0);
  private readonly progressSignal = signal(0);

  /** 'idle' | 'loading' | 'ready' | 'recognizing' | 'error'. */
  readonly status = this.statusSignal.asReadonly();
  /** Human-readable error when status is 'error'. */
  readonly error = this.errorSignal.asReadonly();
  /** The only backend Tesseract offers. */
  readonly backend = signal<'wasm'>('wasm').asReadonly();
  /** Model / language display name for the HUD. */
  readonly modelName = this.modelNameSignal.asReadonly();
  /** Recognition time (ms) of the most recent scan — the headline HUD stat. */
  readonly lastMs = this.lastMsSignal.asReadonly();
  /** Recognition progress 0–1 (Tesseract's own callback), for the scan spinner. */
  readonly progress = this.progressSignal.asReadonly();

  private worker: Worker | null = null;
  /** In-flight init, so concurrent callers await the same warmup. */
  private initPromise: Promise<Worker> | null = null;

  /**
   * Create and warm up the worker once. Idempotent: subsequent calls await the
   * same promise (or return the ready worker). Browser-only — the worker load
   * fails cleanly and sets status 'error' if the self-hosted assets are absent.
   */
  async init(): Promise<void> {
    try {
      await this.ensureWorker();
    } catch {
      /* status/error signals already set by ensureWorker */
    }
  }

  private ensureWorker(): Promise<Worker> {
    if (this.worker) {
      return Promise.resolve(this.worker);
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.statusSignal.set('loading');
    this.errorSignal.set(null);

    this.initPromise = createWorker([...LANGS], OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: LANG_PATH,
      gzip: false,
      cacheMethod: 'none',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          this.progressSignal.set(m.progress);
        }
      },
    })
      .then((worker) => {
        this.worker = worker;
        this.statusSignal.set('ready');
        return worker;
      })
      .catch((err: unknown) => {
        this.fail(
          'Failed to load the OCR engine. Check that /wasm/tesseract/ and ' +
            '/models/tesseract/ are present (run npm install and ' +
            `scripts/download-models.sh). ${this.messageOf(err)}`,
        );
        this.initPromise = null;
        throw err;
      });
    return this.initPromise;
  }

  /**
   * OCR one image (canvas / blob / video frame). Resolves with the recognized
   * text, page confidence and timing. Rejects only if the worker cannot be
   * created; a recognition error sets status 'error' and rejects so the caller
   * can surface it.
   */
  async recognize(image: ImageLike): Promise<OcrResult> {
    const worker = await this.ensureWorker();
    this.statusSignal.set('recognizing');
    this.progressSignal.set(0);
    try {
      const t0 = performance.now();
      const { data } = await worker.recognize(image);
      const ms = performance.now() - t0;
      this.lastMsSignal.set(ms);
      this.progressSignal.set(1);
      this.statusSignal.set('ready');
      return { text: data.text, confidence: data.confidence, ms };
    } catch (err) {
      this.fail(`OCR failed: ${this.messageOf(err)}`);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Terminate the worker (used when the whole demo is torn down). */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.initPromise = null;
    this.statusSignal.set('idle');
    await worker?.terminate();
  }

  private fail(message: string): void {
    this.errorSignal.set(message);
    this.statusSignal.set('error');
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
