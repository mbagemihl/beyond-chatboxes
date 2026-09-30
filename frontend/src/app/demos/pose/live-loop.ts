/**
 * live-loop.ts — the real-time half of the pose demo: draw the skeleton on a
 * canvas, and drive camera frames through the model without ever blocking the
 * page.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP ACT 2b — Live camera, real-time skeleton                       │
 * │                                                                         │
 * │ The model works (Act 2a). Now make it live: paint every display frame,  │
 * │ run the model as often as it can keep up, and never let one wait for   │
 * │ the other.                                                              │
 * │                                                                         │
 * │ Implement the TODOs below (drawSkeleton and createFrameLoop are core).  │
 * │   Check your work:  make verify-2                                       │
 * │   Stuck?            make solve-2                                        │
 * │                                                                         │
 * │ Watch it work:  http://localhost:4200/pose?fixture=1                    │
 * │   stage stays black      → createFrameLoop schedules no frames yet      │
 * │   video but no skeleton  → drawSkeleton draws nothing yet               │
 * │   skeleton, fps moving   → done; try /pose for your own webcam          │
 * └─────────────────────────────────────────────────────────────────────────┘
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
 * TODO (act 2b, core) — Draw a skeleton over a `w` × `h` canvas with the 2D
 * canvas API.
 *
 * The model gives NORMALIZED coordinates (0..1 across the frame), so a keypoint
 * lands at pixel (x * w, y * h). Anything scoring below `threshold` is skipped.
 *
 *   1. Bones: for each [a, b] pair in the given SKELETON_EDGES, skip it unless
 *      BOTH keypoints reach the threshold; otherwise set `ctx.strokeStyle` to
 *      `color(min(scoreA, scoreB))`, then beginPath → moveTo(a) → lineTo(b) →
 *      stroke. Set `ctx.lineWidth = Math.max(2, w / 240)` once, first.
 *   2. Dots, after the bones so they sit on top: for each keypoint at or above
 *      the threshold, `ctx.fillStyle = color(score)`, then beginPath →
 *      arc(x, y, radius, 0, 2π) → fill, with `radius = Math.max(3, w / 160)`.
 *
 * Draw nothing when `kps` is null. `threshold` and `color` come from `options`,
 * falling back to KP_THRESHOLD and the given `confColor`.
 */
export function drawSkeleton(
  ctx: Canvas2DLike,
  kps: Keypoints | null,
  w: number,
  h: number,
  options: DrawOptions = {},
): void {}

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
 * TODO (act 2b, core) — Drive a camera through a model in real time.
 *
 * `start()` schedules the first frame with `options.requestFrame(tick)`. Every
 * tick then:
 *   1. schedules the NEXT frame first (so a throwing `draw` cannot end the
 *      loop) and remembers its id for `stop()`;
 *   2. calls `options.draw(latest)` with the latest finished result (null
 *      until the first one);
 *   3. if no inference is in flight, calls `options.infer()`. It returns null
 *      while the model is not ready (then do nothing), or a promise. While that
 *      promise is pending, start no other inference. When it resolves to a
 *      non-null result, store it as `latest` and call `onResult`; when it
 *      rejects, call `onError`; either way the next frame may start a new one.
 *
 * `stop()` stops scheduling (`options.cancelFrame(id)`), and a result that
 * lands after `stop()` is dropped. Calling `start()` twice starts one loop.
 *
 * Why one inference at a time: queueing more would only make every result
 * older by the time it is drawn. The page repaints at 60 fps regardless.
 */
export function createFrameLoop<T>(options: FrameLoopOptions<T>): FrameLoop {
  return { start(): void {}, stop(): void {} };
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
 * TODO (act 2b, stretch) — Turn per-frame measurements into HUD numbers
 * without re-rendering the page 60 times a second.
 *
 * `record(ms)` counts one finished inference and keeps its duration (only the
 * last `window` durations). `maybePublish(now, publish)` does nothing until
 * `intervalMs` has passed since the last publish (or since `startedAt`); then
 * it calls `publish({ fps, avgMs })` with
 *   fps   = inferences since the last publish × 1000 / elapsed ms
 *   avgMs = the mean of the kept durations (0 when there are none)
 * and resets the count (not the durations) and the publish time.
 *
 * Until you do this the HUD shows 0 fps and 0 ms.
 */
export function createStatsThrottle(
  intervalMs: number,
  window: number,
  startedAt: number,
): StatsThrottle {
  return { record(): void {}, maybePublish(): void {} };
}
