import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  NgZone,
  signal,
  viewChild,
} from '@angular/core';
import { CameraService } from './camera.service';
import { PoseEngine } from './pose-engine.service';
import {
  BodyAngles,
  computeBodyAngles,
  Keypoints,
  SKELETON_EDGES,
} from './pose-math';
import { PoseHud } from './pose-hud/pose-hud';
import { PoseAnglePanel } from './pose-angle-panel/pose-angle-panel';

/** Below this confidence we neither draw a keypoint nor use it for angles. */
const KP_THRESHOLD = 0.3;
/** How many recent inference times to average for the HUD. */
const MS_WINDOW = 30;
/** Push throttled stats into signals at ~2 Hz (CLAUDE.md convention). */
const STATS_INTERVAL_MS = 500;

/**
 * The pose demo. Thin and declarative: it wires {@link CameraService} and
 * {@link PoseEngine} together, runs a requestAnimationFrame loop OUTSIDE Angular
 * (per CLAUDE.md — per-frame work must never trigger change detection), draws
 * the video + skeleton overlay to a canvas, and pushes only low-frequency stats
 * (fps, avg ms, joint angles) into signals ~2x/second.
 */
@Component({
  selector: 'app-pose',
  imports: [PoseHud, PoseAnglePanel],
  templateUrl: './pose.html',
  styleUrl: './pose.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Pose {
  private readonly camera = inject(CameraService);
  private readonly engine = inject(PoseEngine);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly videoRef =
    viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  // --- Low-frequency, throttled state exposed to the template ---------------
  protected readonly fps = signal(0);
  protected readonly avgInferenceMs = signal(0);
  protected readonly angles = signal<BodyAngles | null>(null);

  // Engine / camera status is already signal-based; re-expose for the template.
  protected readonly engineStatus = this.engine.status;
  protected readonly engineError = this.engine.error;
  protected readonly backend = this.engine.backend;
  protected readonly modelName = this.engine.modelName;
  protected readonly cameraStatus = this.camera.status;
  protected readonly cameraError = this.camera.error;

  /** A blocking message to show over the stage, or null when all is well. */
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

  // --- Per-frame state (plain fields — never in signals) --------------------
  private rafId = 0;
  private inferring = false;
  private lastKeypoints: Keypoints | null = null;
  private lastAngles: BodyAngles | null = null;
  private readonly msSamples: number[] = [];
  private inferenceCount = 0;
  private lastStatsAt = 0;

  constructor() {
    // afterNextRender runs browser-only and after the view children resolve.
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private setup(): void {
    const video = this.videoRef().nativeElement;
    // Kick off model load and camera in parallel; the loop guards on readiness.
    void this.engine.load();
    void this.camera.start(video);
    this.zone.runOutsideAngular(() => {
      this.lastStatsAt = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    });
  }

  private teardown(): void {
    cancelAnimationFrame(this.rafId);
    this.camera.stop(this.videoRef().nativeElement);
    this.engine.dispose();
  }

  /** The render loop. Runs outside Angular; touches signals only when throttled. */
  private readonly tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);

    const video = this.videoRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0) {
      return; // nothing to draw yet
    }

    // Keep the canvas backing store matched to the camera resolution.
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Draw the current frame, then overlay the most recent skeleton.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.drawSkeleton(ctx, this.lastKeypoints, canvas.width, canvas.height);

    // Fire an inference when the engine is ready and not already busy. This is
    // decoupled from the draw rate: the overlay uses the last completed result.
    if (this.engine.status() === 'ready' && !this.inferring) {
      this.inferring = true;
      this.engine
        .runOnVideoFrame(video)
        .then((res) => {
          if (res) {
            this.lastKeypoints = res.keypoints;
            this.lastAngles = computeBodyAngles(res.keypoints, KP_THRESHOLD);
            this.pushMs(res.inferenceMs);
            this.inferenceCount++;
          }
        })
        .catch((err) => console.error('[Pose] inference failed', err))
        .finally(() => (this.inferring = false));
    }

    this.maybePublishStats();
  };

  private maybePublishStats(): void {
    const now = performance.now();
    const elapsed = now - this.lastStatsAt;
    if (elapsed < STATS_INTERVAL_MS) {
      return;
    }
    // fps = completed inferences per second (the throughput the demo cares
    // about), not the raw rAF redraw rate.
    this.fps.set((this.inferenceCount * 1000) / elapsed);
    this.avgInferenceMs.set(this.averageMs());
    this.angles.set(this.lastAngles);
    this.inferenceCount = 0;
    this.lastStatsAt = now;
  }

  private pushMs(ms: number): void {
    this.msSamples.push(ms);
    if (this.msSamples.length > MS_WINDOW) {
      this.msSamples.shift();
    }
  }

  private averageMs(): number {
    if (this.msSamples.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const s of this.msSamples) {
      sum += s;
    }
    return sum / this.msSamples.length;
  }

  private drawSkeleton(
    ctx: CanvasRenderingContext2D,
    kps: Keypoints | null,
    w: number,
    h: number,
  ): void {
    if (!kps) {
      return;
    }
    ctx.lineWidth = Math.max(2, w / 240);
    for (const [a, b] of SKELETON_EDGES) {
      const ka = kps[a];
      const kb = kps[b];
      const conf = Math.min(ka.score, kb.score);
      if (conf < KP_THRESHOLD) {
        continue;
      }
      ctx.strokeStyle = this.confColor(conf);
      ctx.beginPath();
      ctx.moveTo(ka.x * w, ka.y * h);
      ctx.lineTo(kb.x * w, kb.y * h);
      ctx.stroke();
    }

    const r = Math.max(3, w / 160);
    for (const kp of kps) {
      if (kp.score < KP_THRESHOLD) {
        continue;
      }
      ctx.fillStyle = this.confColor(kp.score);
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Tint from red (low confidence) to accent cyan (high confidence). */
  private confColor(conf: number): string {
    const t = Math.min(1, Math.max(0, (conf - KP_THRESHOLD) / (1 - KP_THRESHOLD)));
    const r = Math.round(239 + (34 - 239) * t);
    const g = Math.round(68 + (211 - 68) * t);
    const b = Math.round(68 + (238 - 68) * t);
    return `rgba(${r}, ${g}, ${b}, ${(0.55 + 0.45 * t).toFixed(3)})`;
  }
}
