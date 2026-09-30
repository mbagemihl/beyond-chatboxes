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
import { ActivatedRoute } from '@angular/router';
import { CameraService } from './camera.service';
import { PoseEngine, PoseResult } from './pose-engine.service';
import { BodyAngles, computeBodyAngles } from './pose-math';
import {
  FrameLoop,
  KP_THRESHOLD,
  StatsThrottle,
  createFrameLoop,
  createStatsThrottle,
  drawSkeleton,
} from './live-loop';
import { PoseHud } from './pose-hud/pose-hud';
import { PoseAnglePanel } from './pose-angle-panel/pose-angle-panel';

/** How many recent inference times to average for the HUD. */
const MS_WINDOW = 30;
/** Push throttled stats into signals at ~2 Hz (CLAUDE.md convention). */
const STATS_INTERVAL_MS = 500;
/** Bundled stage-fallback clip for `?fixture=1` (fetched by download-models.sh). */
const FIXTURE_VIDEO_URL = '/fixtures/pose.webm';

/**
 * The pose demo. Thin and declarative: it wires {@link CameraService} and
 * {@link PoseEngine} together, runs the frame loop from live-loop.ts OUTSIDE
 * Angular (per CLAUDE.md — per-frame work must never trigger change detection),
 * draws the video + skeleton overlay to a canvas, and pushes only low-frequency
 * stats (fps, avg ms, joint angles) into signals ~2x/second.
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
  private readonly route = inject(ActivatedRoute);

  /** `?fixture=1` — run on the bundled clip instead of the live camera. */
  protected readonly fixtureMode = this.route.snapshot.queryParamMap.get('fixture') === '1';

  private readonly videoRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

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
  private loop: FrameLoop | null = null;
  private stats: StatsThrottle | null = null;
  private lastAngles: BodyAngles | null = null;

  constructor() {
    // afterNextRender runs browser-only and after the view children resolve.
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private setup(): void {
    const video = this.videoRef().nativeElement;
    // Kick off model load and camera in parallel; the loop guards on readiness.
    void this.engine.load();
    if (this.fixtureMode) {
      void this.camera.startFixture(video, FIXTURE_VIDEO_URL);
    } else {
      void this.camera.start(video);
    }
    this.zone.runOutsideAngular(() => {
      this.stats = createStatsThrottle(STATS_INTERVAL_MS, MS_WINDOW, performance.now());
      this.loop = createFrameLoop<PoseResult>({
        requestFrame: (cb) => requestAnimationFrame(cb),
        cancelFrame: (id) => cancelAnimationFrame(id),
        draw: (latest) => this.draw(latest),
        infer: () => (this.engine.status() === 'ready' ? this.engine.runOnVideoFrame(video) : null),
        onResult: (res) => {
          this.lastAngles = computeBodyAngles(res.keypoints, KP_THRESHOLD);
          this.stats?.record(res.inferenceMs);
        },
        onError: (err) => console.error('[Pose] inference failed', err),
      });
      this.loop.start();
    });
  }

  private teardown(): void {
    this.loop?.stop();
    this.camera.stop(this.videoRef().nativeElement);
    this.engine.dispose();
  }

  /** Paint one frame. Runs outside Angular; touches signals only when throttled. */
  private draw(latest: PoseResult | null): void {
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

    // The current frame, then the most recent skeleton on top.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawSkeleton(ctx, latest?.keypoints ?? null, canvas.width, canvas.height);

    this.stats?.maybePublish(performance.now(), ({ fps, avgMs }) => {
      this.fps.set(fps);
      this.avgInferenceMs.set(avgMs);
      this.angles.set(this.lastAngles);
    });
  }
}
