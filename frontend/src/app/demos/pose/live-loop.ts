/**
 * live-loop.ts — the real-time half of the pose demo: draw the skeleton on a
 * canvas, and drive camera frames through the model without ever blocking the
 * page.
 *
 * Kept free of Angular and of real browser globals: the canvas context, the
 * frame scheduler and the model are all passed in, so live-loop.spec.ts can
 * check each piece with fakes (a recording canvas, a manual clock).
 */
import { Keypoints, SKELETON_EDGES } from './pose-math';

/** Below this confidence a keypoint is neither drawn nor used for angles. */
export const KP_THRESHOLD = 0.3;

/** The slice of CanvasRenderingContext2D the skeleton needs. */
export interface Canvas2DLike {
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
}

/** Tint from red (low confidence) to accent cyan (high confidence). */
export function confColor(conf: number, threshold = KP_THRESHOLD): string {
  const t = Math.min(1, Math.max(0, (conf - threshold) / (1 - threshold)));
  const r = Math.round(239 + (34 - 239) * t);
  const g = Math.round(68 + (211 - 68) * t);
  const b = Math.round(68 + (238 - 68) * t);
  return `rgba(${r}, ${g}, ${b}, ${(0.55 + 0.45 * t).toFixed(3)})`;
}

export interface DrawOptions {
  /** Skip keypoints (and bones touching them) below this score. */
  readonly threshold?: number;
  /** Colour for a given confidence; defaults to {@link confColor}. */
  readonly color?: (conf: number) => string;
}

/**
 * Draw a skeleton over a `w` × `h` canvas. Keypoints come from the model in
 * NORMALIZED coordinates (0..1 across the frame), so each one lands at pixel
 * `(x * w, y * h)`.
 *
 * Bones first (one line per `SKELETON_EDGES` pair, skipped when either end is
 * below the threshold, coloured by the weaker end), then one dot per keypoint
 * above the threshold, so dots sit on top of the lines.
 */
export function drawSkeleton(
  ctx: Canvas2DLike,
  kps: Keypoints | null,
  w: number,
  h: number,
  options: DrawOptions = {},
): void {
  if (!kps) {
    return;
  }
  const threshold = options.threshold ?? KP_THRESHOLD;
  const color = options.color ?? ((conf: number) => confColor(conf, threshold));

  ctx.lineWidth = Math.max(2, w / 240);
  for (const [a, b] of SKELETON_EDGES) {
    const ka = kps[a];
    const kb = kps[b];
    const conf = Math.min(ka.score, kb.score);
    if (conf < threshold) {
      continue;
    }
    ctx.strokeStyle = color(conf);
    ctx.beginPath();
    ctx.moveTo(ka.x * w, ka.y * h);
    ctx.lineTo(kb.x * w, kb.y * h);
    ctx.stroke();
  }

  const radius = Math.max(3, w / 160);
  for (const kp of kps) {
    if (kp.score < threshold) {
      continue;
    }
    ctx.fillStyle = color(kp.score);
    ctx.beginPath();
    ctx.arc(kp.x * w, kp.y * h, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =============================================================================
// The frame loop
// =============================================================================

export interface FrameLoopOptions<T> {
  /** Schedule `callback` for the next display frame (`requestAnimationFrame`). */
  requestFrame(callback: () => void): number;
  /** Cancel a scheduled frame (`cancelAnimationFrame`). */
  cancelFrame(id: number): void;
  /** Paint one frame, with the latest finished result (null until the first). */
  draw(latest: T | null): void;
  /** Start one inference, or return null when the model is not ready yet. */
  infer(): Promise<T | null> | null;
  /** Called once per finished, non-null inference. */
  onResult?(result: T): void;
  onError?(err: unknown): void;
}

export interface FrameLoop {
  start(): void;
  stop(): void;
}

/**
 * Drive a camera through a model in real time. Every display frame:
 *   1. schedule the next frame first, so a throwing `draw` cannot end the loop;
 *   2. `draw` with the latest finished result;
 *   3. if no inference is in flight, start one.
 *
 * Drawing and inference are decoupled: the page repaints at 60 fps while the
 * model runs at whatever rate it can, and at most ONE inference is ever in
 * flight (queueing more would only add latency). After `stop()` no further
 * frames run, and a result that lands late is dropped.
 */
export function createFrameLoop<T>(options: FrameLoopOptions<T>): FrameLoop {
  let frameId = 0;
  let running = false;
  let inFlight = false;
  let latest: T | null = null;

  const tick = (): void => {
    if (!running) {
      return;
    }
    frameId = options.requestFrame(tick);
    options.draw(latest);
    if (inFlight) {
      return;
    }
    const pending = options.infer();
    if (!pending) {
      return;
    }
    inFlight = true;
    pending
      .then((result) => {
        if (running && result !== null) {
          latest = result;
          options.onResult?.(result);
        }
      })
      .catch((err: unknown) => options.onError?.(err))
      .finally(() => {
        inFlight = false;
      });
  };

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      frameId = options.requestFrame(tick);
    },
    stop(): void {
      running = false;
      options.cancelFrame(frameId);
    },
  };
}

// =============================================================================
// Stretch — HUD stats at ~2 Hz
// =============================================================================

/** What the HUD shows. */
export interface LiveStats {
  /** Finished inferences per second over the last interval. */
  readonly fps: number;
  /** Mean inference time over the last `window` inferences, in ms. */
  readonly avgMs: number;
}

export interface StatsThrottle {
  /** Record one finished inference and how long it took. */
  record(ms: number): void;
  /** Call every frame; calls `publish` at most once per interval. */
  maybePublish(now: number, publish: (stats: LiveStats) => void): void;
}

/**
 * Turn per-frame measurements into HUD numbers without re-rendering the page
 * 60 times a second: count inferences and keep the last `window` durations,
 * and publish only when `intervalMs` has passed since the last publish (or
 * since `startedAt`). fps = inferences since last publish × 1000 / elapsed ms;
 * the count resets after each publish, the duration window does not.
 */
export function createStatsThrottle(
  intervalMs: number,
  window: number,
  startedAt: number,
): StatsThrottle {
  const samples: number[] = [];
  let count = 0;
  let lastPublish = startedAt;
  return {
    record(ms: number): void {
      count++;
      samples.push(ms);
      if (samples.length > window) {
        samples.shift();
      }
    },
    maybePublish(now: number, publish: (stats: LiveStats) => void): void {
      const elapsed = now - lastPublish;
      if (elapsed < intervalMs) {
        return;
      }
      const avgMs = samples.length === 0 ? 0 : samples.reduce((a, b) => a + b, 0) / samples.length;
      publish({ fps: (count * 1000) / elapsed, avgMs });
      count = 0;
      lastPublish = now;
    },
  };
}
