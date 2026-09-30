/**
 * compare-tiers.ts — "same model, same answer?" Puts the backend's keypoints
 * (DJL + ONNX Runtime) next to the browser's (LiteRT.js) for one image.
 *
 * Given code, not an exercise: pure and framework-free, tested in
 * compare-tiers.spec.ts.
 */
import { KEYPOINT_NAMES, Keypoint, Keypoints } from '../pose/pose-math';

/** A keypoint as the backend sends it (validated by benchmark-schemas.ts). */
export interface NamedKeypoint {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/**
 * The backend's named keypoints in the browser's index order (both tiers use
 * the COCO order, but matching by name makes that an assertion, not an
 * assumption). Returns null if any keypoint is missing.
 */
export function toKeypoints(named: readonly NamedKeypoint[]): Keypoints | null {
  const byName = new Map(named.map((k) => [k.name, k]));
  const out: Keypoint[] = [];
  for (const name of KEYPOINT_NAMES) {
    const k = byName.get(name);
    if (!k) {
      return null;
    }
    out.push({ x: k.x, y: k.y, score: k.score });
  }
  return out;
}

/** How far the two tiers' answers are apart on a `w` × `h` image. */
export interface TierDifference {
  /** Largest distance between matching keypoints, in image pixels. */
  readonly maxPx: number;
  /** Name of the keypoint where it is largest. */
  readonly worst: string;
  /** Keypoints both tiers were confident about (and that were compared). */
  readonly compared: number;
}

/**
 * Compare keypoints both tiers are confident about (score ≥ `threshold` on
 * both sides). Null when there is nothing to compare.
 */
export function compareTiers(
  browser: Keypoints,
  server: Keypoints,
  w: number,
  h: number,
  threshold = 0.3,
): TierDifference | null {
  let maxPx = -1;
  let worst = '';
  let compared = 0;
  for (let i = 0; i < Math.min(browser.length, server.length); i++) {
    const a = browser[i];
    const b = server[i];
    if (a.score < threshold || b.score < threshold) {
      continue;
    }
    compared++;
    const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
    if (d > maxPx) {
      maxPx = d;
      worst = KEYPOINT_NAMES[i] ?? String(i);
    }
  }
  return compared === 0 ? null : { maxPx, worst, compared };
}
