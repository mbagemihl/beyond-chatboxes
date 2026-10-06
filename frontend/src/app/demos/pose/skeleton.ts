/**
 * skeleton.ts — draws a pose on a canvas: a line per bone, a dot per keypoint.
 *
 * Given, not a workshop exercise: drawing lines teaches canvas, not on-device
 * AI. Kept free of Angular and of the real canvas (the context is passed in), so
 * skeleton.spec.ts can check it with a recording fake.
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
