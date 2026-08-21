import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CameraService } from '../demos/pose/camera.service';
import { PoseEngine } from '../demos/pose/pose-engine.service';
import { PoseCloudService } from './pose-cloud.service';
import { LatencySummary, summarize } from './stats';

/** How many timed runs per tier. */
const N = 20;
/** JPEG quality for the frame sent to the cloud tier. */
const JPEG_QUALITY = 0.85;

type Phase = 'idle' | 'running' | 'done';

/** Median/p95 of the cloud tier plus the server/network split. */
interface CloudSummary {
  readonly total: LatencySummary;
  readonly server: LatencySummary;
  /** median(total) − median(server), clamped ≥ 0 — the "distance" segment. */
  readonly networkMedianMs: number;
  readonly backend: string;
  readonly model: string;
}

interface RaceResults {
  readonly n: number;
  readonly local: LatencySummary;
  readonly localBackend: string | null;
  /** null when the cloud tier was unreachable/unavailable (see cloudError). */
  readonly cloud: CloudSummary | null;
}

// SVG layout (fixed user-space; scales uniformly via viewBox).
const SVG_X0 = 150;
const SVG_USABLE = 800;

/**
 * "Local vs Cloud" benchmark. Captures ONE camera frame and runs it N times
 * in-browser (LiteRT.js via {@link PoseEngine}) and N times against the backend
 * "cloud tier" (`POST /api/infer/pose`, zod-validated), interleaved, then draws
 * the two latency distributions as plain SVG bars. A dropdown injects artificial
 * WAN latency via the config endpoint so the same model can be shown "with 100 ms
 * of distance added" live.
 */
@Component({
  selector: 'app-benchmark',
  imports: [DecimalPipe],
  templateUrl: './benchmark.html',
  styleUrl: './benchmark.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Benchmark {
  private readonly camera = inject(CameraService);
  private readonly engine = inject(PoseEngine);
  private readonly cloud = inject(PoseCloudService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly videoRef =
    viewChild.required<ElementRef<HTMLVideoElement>>('video');

  // --- State (all signals) --------------------------------------------------
  protected readonly phase = signal<Phase>('idle');
  protected readonly progress = signal(0);
  protected readonly total = signal(N);
  protected readonly results = signal<RaceResults | null>(null);
  /** Fatal race error (e.g. no camera frame). */
  protected readonly raceError = signal<string | null>(null);
  /** Cloud-tier-specific error; local results still shown when set. */
  protected readonly cloudError = signal<string | null>(null);

  protected readonly delayMs = signal(0);
  protected readonly allowedMs = signal<number[]>([0, 50, 150]);

  // Re-expose engine/camera status for the template.
  protected readonly engineStatus = this.engine.status;
  protected readonly engineError = this.engine.error;
  protected readonly localBackend = this.engine.backend;
  protected readonly modelName = this.engine.modelName;
  protected readonly cameraStatus = this.camera.status;
  protected readonly cameraError = this.camera.error;

  protected readonly overlayMessage = computed<string | null>(() => {
    const cam = this.cameraStatus();
    if (cam === 'denied' || cam === 'unsupported' || cam === 'error') {
      return this.cameraError();
    }
    if (this.engineStatus() === 'error') {
      return this.engineError();
    }
    if (this.engineStatus() === 'loading' || cam === 'requesting') {
      return 'Loading model and camera…';
    }
    return null;
  });

  protected readonly canRace = computed(
    () =>
      this.cameraStatus() === 'granted' &&
      this.engineStatus() === 'ready' &&
      this.phase() !== 'running',
  );

  /**
   * Everything the SVG needs, in fixed user-space units, so the template stays
   * declarative. null until a race has produced results.
   */
  protected readonly chart = computed(() => {
    const r = this.results();
    if (!r) {
      return null;
    }
    const maxMs = Math.max(r.local.p95, r.cloud?.total.p95 ?? 0, 1);
    const w = (ms: number) => (ms / maxMs) * SVG_USABLE;
    const x = (ms: number) => SVG_X0 + w(ms);
    return {
      maxMs,
      local: {
        barW: w(r.local.median),
        p95X: x(r.local.p95),
      },
      cloud: r.cloud
        ? {
            serverW: w(r.cloud.server.median),
            networkW: w(Math.max(0, r.cloud.total.median - r.cloud.server.median)),
            p95X: x(r.cloud.total.p95),
          }
        : null,
    };
  });

  constructor() {
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private setup(): void {
    const video = this.videoRef().nativeElement;
    void this.engine.load();
    void this.camera.start(video);
    void this.refreshLatencyConfig();
  }

  private teardown(): void {
    this.camera.stop(this.videoRef().nativeElement);
    this.engine.dispose();
  }

  private async refreshLatencyConfig(): Promise<void> {
    try {
      const cfg = await this.cloud.getLatencyConfig();
      this.allowedMs.set(cfg.allowedMs);
      this.delayMs.set(cfg.delayMs);
    } catch {
      // Backend not up yet — keep defaults; the race will surface any error.
    }
  }

  /** Change the artificial WAN latency on the server. */
  protected async onDelayChange(value: string): Promise<void> {
    const ms = Number(value);
    try {
      const cfg = await this.cloud.setLatencyConfig(ms);
      this.delayMs.set(cfg.delayMs);
    } catch (err) {
      this.cloudError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /** Run the benchmark: capture one frame, N local + N cloud runs, interleaved. */
  protected async race(): Promise<void> {
    if (!this.canRace()) {
      return;
    }
    this.phase.set('running');
    this.raceError.set(null);
    this.cloudError.set(null);
    this.results.set(null);
    this.progress.set(0);
    this.total.set(N);

    const video = this.videoRef().nativeElement;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      this.raceError.set('The camera has not produced a frame yet.');
      this.phase.set('idle');
      return;
    }

    // Capture ONE frame — the exact same pixels feed both tiers.
    const cap = document.createElement('canvas');
    cap.width = w;
    cap.height = h;
    const cctx = cap.getContext('2d');
    if (!cctx) {
      this.raceError.set('Could not create a 2D context to capture the frame.');
      this.phase.set('idle');
      return;
    }
    cctx.drawImage(video, 0, 0, w, h);
    const blob = await this.toJpeg(cap);
    if (!blob) {
      this.raceError.set('Could not encode the captured frame as JPEG.');
      this.phase.set('idle');
      return;
    }

    const localMs: number[] = [];
    const cloudTotalMs: number[] = [];
    const cloudServerMs: number[] = [];
    let cloudBackend = '';
    let cloudModel = '';
    let cloudUp = true;

    // Untimed warmup (one each) so first-call effects (JIT, TLS/keep-alive)
    // don't skew the medians.
    try {
      await this.engine.runOnFrame(cap, w, h);
    } catch {
      /* engine ready was checked; ignore a stray warmup miss */
    }
    try {
      const warm = await this.cloud.infer(blob);
      cloudBackend = warm.backend;
      cloudModel = warm.modelName;
    } catch (err) {
      cloudUp = false;
      this.cloudError.set(err instanceof Error ? err.message : String(err));
    }

    for (let i = 0; i < N; i++) {
      // Local
      const t0 = performance.now();
      const local = await this.engine.runOnFrame(cap, w, h);
      if (local) {
        localMs.push(performance.now() - t0);
      }

      // Cloud (interleaved right after each local run)
      if (cloudUp) {
        try {
          const c = await this.cloud.infer(blob);
          cloudTotalMs.push(c.roundTripMs);
          cloudServerMs.push(c.inferenceMs);
          cloudBackend = c.backend;
          cloudModel = c.modelName;
        } catch (err) {
          cloudUp = false;
          this.cloudError.set(err instanceof Error ? err.message : String(err));
        }
      }

      this.progress.set(i + 1);
    }

    const local = summarize(localMs);
    const cloud: CloudSummary | null =
      cloudTotalMs.length > 0
        ? {
            total: summarize(cloudTotalMs),
            server: summarize(cloudServerMs),
            networkMedianMs: Math.max(
              0,
              summarize(cloudTotalMs).median - summarize(cloudServerMs).median,
            ),
            backend: cloudBackend,
            model: cloudModel,
          }
        : null;

    this.results.set({
      n: N,
      local,
      localBackend: this.localBackend(),
      cloud,
    });
    this.phase.set('done');
  }

  private toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
    );
  }
}
