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
import { PoseCloudService } from '../../benchmark/pose-cloud.service';
import { drawSkeleton } from '../pose/live-loop';
import { PoseEngine } from '../pose/pose-engine.service';
import { FixtureCredit } from '../pose/fixture-credit';
import { PoseHud } from '../pose/pose-hud/pose-hud';
import { Keypoints } from '../pose/pose-math';
import { compareTiers, toKeypoints } from './compare-tiers';

/** The workshop still (committed; see public/fixtures/ATTRIBUTION.md). */
const STILL_URL = '/fixtures/pose-still.jpg';
/** The backend's skeleton is drawn in amber, the browser's in the usual cyan. */
const SERVER_COLOR = 'rgba(245, 158, 11, 0.9)';

/** What the backend answered for the same image. */
interface ServerAnswer {
  readonly keypoints: Keypoints;
  readonly inferenceMs: number;
  readonly roundTripMs: number;
  readonly backend: string;
}

/**
 * Act 2a of the workshop: the backend's model, now in the browser, on ONE still
 * image. Runs PoseEngine (LiteRT.js, set up in litert-setup.ts) once on the
 * image and draws the skeleton. "Compare with backend" sends the very same file
 * to the Spring Boot + DJL service from Act 1 and overlays its answer, to show
 * the two runtimes agree.
 */
@Component({
  selector: 'app-pose-still',
  imports: [PoseHud, FixtureCredit, DecimalPipe],
  templateUrl: './pose-still.html',
  styleUrl: './pose-still.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoseStill {
  private readonly engine = inject(PoseEngine);
  private readonly cloud = inject(PoseCloudService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly imgRef = viewChild.required<ElementRef<HTMLImageElement>>('img');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly stillUrl = STILL_URL;
  protected readonly backend = this.engine.backend;
  protected readonly modelName = this.engine.modelName;
  protected readonly engineStatus = this.engine.status;

  protected readonly inferenceMs = signal(0);
  protected readonly browserKeypoints = signal<Keypoints | null>(null);
  protected readonly server = signal<ServerAnswer | null>(null);
  protected readonly cloudError = signal<string | null>(null);
  protected readonly comparing = signal(false);
  private readonly imageError = signal<string | null>(null);
  private readonly imageSize = signal<{ w: number; h: number } | null>(null);

  /** How far apart the two tiers' answers are, once both exist. */
  protected readonly difference = computed(() => {
    const browser = this.browserKeypoints();
    const server = this.server();
    const size = this.imageSize();
    return browser && server && size
      ? compareTiers(browser, server.keypoints, size.w, size.h)
      : null;
  });

  protected readonly overlayMessage = computed<string | null>(() => {
    if (this.imageError()) {
      return this.imageError();
    }
    if (this.engineStatus() === 'error') {
      return this.engine.error();
    }
    if (this.engineStatus() === 'loading') {
      return 'Loading the model…';
    }
    return null;
  });

  constructor() {
    afterNextRender(() => void this.setup());
    this.destroyRef.onDestroy(() => this.engine.dispose());
  }

  private async setup(): Promise<void> {
    const img = this.imgRef().nativeElement;
    try {
      await imageLoaded(img);
    } catch {
      this.imageError.set(
        `Still image missing (${STILL_URL}). It ships with the repo — check the checkout.`,
      );
      return;
    }
    this.imageSize.set({ w: img.naturalWidth, h: img.naturalHeight });
    this.redraw();
    await this.engine.load();
    await this.run();
  }

  /** Run the browser model on the still image once. */
  protected async run(): Promise<void> {
    const img = this.imgRef().nativeElement;
    const result = await this.engine.runOnFrame(img, img.naturalWidth, img.naturalHeight);
    if (result) {
      this.inferenceMs.set(result.inferenceMs);
      this.browserKeypoints.set(result.keypoints);
      this.redraw();
    }
  }

  /** Send the same file to the Act 1 backend and overlay its answer. */
  protected async compare(): Promise<void> {
    this.comparing.set(true);
    this.cloudError.set(null);
    try {
      const file = await (await fetch(STILL_URL)).blob();
      const answer = await this.cloud.infer(file);
      const keypoints = toKeypoints(answer.keypoints);
      if (!keypoints) {
        throw new Error('The backend returned an incomplete set of keypoints.');
      }
      this.server.set({
        keypoints,
        inferenceMs: answer.inferenceMs,
        roundTripMs: answer.roundTripMs,
        backend: answer.backend,
      });
      this.redraw();
    } catch (err) {
      this.cloudError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.comparing.set(false);
    }
  }

  private redraw(): void {
    const img = this.imgRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || img.naturalWidth === 0) {
      return;
    }
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    // Backend first, browser on top: where the two agree only cyan shows, and
    // any disagreement peeks out in amber.
    drawSkeleton(ctx, this.server()?.keypoints ?? null, canvas.width, canvas.height, {
      color: () => SERVER_COLOR,
    });
    drawSkeleton(ctx, this.browserKeypoints(), canvas.width, canvas.height);
  }
}

/**
 * Resolves once `img` has pixels. Not `img.decode()`: Chromium defers that
 * while the tab is hidden, so a page opened in a background tab would never
 * start. The load/error events fire regardless of visibility.
 */
function imageLoaded(img: HTMLImageElement): Promise<void> {
  if (img.complete) {
    return img.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error('image failed'));
  }
  return new Promise((resolve, reject) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error('image failed')), { once: true });
  });
}
