/**
 * pose-math.ts — pure, framework-free geometry for MoveNet SinglePose.
 *
 * This module has NO Angular / DOM / LiteRT dependencies on purpose: every
 * function here is a plain input -> output transform so it can be unit-tested
 * without TestBed (see pose-math.spec.ts). The pose engine and the demo
 * component import from here; they never re-implement the math.
 *
 * Coordinate convention: keypoint `x`/`y` are normalized to [0, 1] relative to
 * the ORIGINAL source video frame (top-left origin, y grows downward), AFTER
 * the letterbox padding used for inference has been undone. Callers multiply by
 * their canvas width/height to draw, independent of the model's 192x192 input.
 */

/** MoveNet's native square input size for the SinglePose Lightning model. */
export const MOVENET_INPUT_SIZE = 192;

/** Number of keypoints MoveNet SinglePose predicts (COCO topology). */
export const NUM_KEYPOINTS = 17;

/** A point in normalized source-frame coordinates ([0, 1] on each axis). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A detected keypoint: normalized position plus the model's confidence. */
export interface Keypoint extends Point {
  /** Model confidence in [0, 1]. */
  readonly score: number;
}

/** The 17 keypoints in MoveNet / COCO order. */
export type Keypoints = readonly Keypoint[];

/**
 * COCO keypoint indices, in the exact order MoveNet emits them. Using named
 * constants keeps the skeleton and angle definitions readable.
 */
export const KEYPOINT = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

/** Human-readable names indexed by keypoint index. */
export const KEYPOINT_NAMES: readonly string[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

/**
 * Edges of the skeleton, as pairs of keypoint indices. Used to draw the
 * connecting lines of the overlay. This is the standard COCO/MoveNet topology.
 */
export const SKELETON_EDGES: readonly (readonly [number, number])[] = [
  // Face
  [KEYPOINT.nose, KEYPOINT.leftEye],
  [KEYPOINT.nose, KEYPOINT.rightEye],
  [KEYPOINT.leftEye, KEYPOINT.leftEar],
  [KEYPOINT.rightEye, KEYPOINT.rightEar],
  // Arms
  [KEYPOINT.leftShoulder, KEYPOINT.leftElbow],
  [KEYPOINT.leftElbow, KEYPOINT.leftWrist],
  [KEYPOINT.rightShoulder, KEYPOINT.rightElbow],
  [KEYPOINT.rightElbow, KEYPOINT.rightWrist],
  // Shoulders / torso
  [KEYPOINT.leftShoulder, KEYPOINT.rightShoulder],
  [KEYPOINT.leftShoulder, KEYPOINT.leftHip],
  [KEYPOINT.rightShoulder, KEYPOINT.rightHip],
  [KEYPOINT.leftHip, KEYPOINT.rightHip],
  // Legs
  [KEYPOINT.leftHip, KEYPOINT.leftKnee],
  [KEYPOINT.leftKnee, KEYPOINT.leftAnkle],
  [KEYPOINT.rightHip, KEYPOINT.rightKnee],
  [KEYPOINT.rightKnee, KEYPOINT.rightAnkle],
];

/**
 * Geometry of the letterbox transform used to fit a `srcW x srcH` frame into a
 * `square x square` model input while preserving aspect ratio (padding the
 * short axis with equal borders, matching TF's `resize_with_pad`).
 */
export interface Letterbox {
  readonly scale: number;
  readonly scaledW: number;
  readonly scaledH: number;
  readonly padX: number;
  readonly padY: number;
}

/**
 * Compute the letterbox geometry for fitting `srcW x srcH` into a centered
 * square of side `square`, preserving aspect ratio.
 */
export function computeLetterbox(
  srcW: number,
  srcH: number,
  square: number = MOVENET_INPUT_SIZE,
): Letterbox {
  const scale = square / Math.max(srcW, srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  return {
    scale,
    scaledW,
    scaledH,
    padX: (square - scaledW) / 2,
    padY: (square - scaledH) / 2,
  };
}

/**
 * Convert a coordinate that is normalized over the padded `square x square`
 * model input back into a coordinate normalized over the original source frame.
 * Inverts {@link computeLetterbox}.
 */
export function squareToSourceNorm(
  nx: number,
  ny: number,
  srcW: number,
  srcH: number,
  square: number = MOVENET_INPUT_SIZE,
): Point {
  const { scaledW, scaledH, padX, padY } = computeLetterbox(srcW, srcH, square);
  return {
    x: (nx * square - padX) / scaledW,
    y: (ny * square - padY) / scaledH,
  };
}

/**
 * Parse a raw MoveNet SinglePose output tensor into keypoints in source-frame
 * normalized coordinates.
 *
 * The output tensor has shape [1, 1, 17, 3]; flattened it is 51 numbers, three
 * per keypoint in the order **[y, x, score]** (y and x are normalized over the
 * padded square input). This undoes the letterbox so the returned x/y are
 * normalized over the original source frame.
 */
export function parseMoveNetOutput(
  raw: ArrayLike<number>,
  srcW: number,
  srcH: number,
  square: number = MOVENET_INPUT_SIZE,
): Keypoints {
  if (raw.length < NUM_KEYPOINTS * 3) {
    throw new Error(
      `MoveNet output too short: expected ${NUM_KEYPOINTS * 3}, got ${raw.length}`,
    );
  }
  const keypoints: Keypoint[] = [];
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    const ny = raw[i * 3];
    const nx = raw[i * 3 + 1];
    const score = raw[i * 3 + 2];
    const { x, y } = squareToSourceNorm(nx, ny, srcW, srcH, square);
    keypoints.push({ x, y, score });
  }
  return keypoints;
}

/**
 * Interior angle, in degrees, at vertex `b` formed by the rays b->a and b->c.
 * Returns a value in [0, 180], or `NaN` if either ray has zero length
 * (degenerate — coincident points).
 */
export function angleABC(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const uMag = Math.hypot(ux, uy);
  const vMag = Math.hypot(vx, vy);
  if (uMag === 0 || vMag === 0) {
    return NaN;
  }
  const cos = (ux * vx + uy * vy) / (uMag * vMag);
  // Clamp to guard against floating-point drift outside [-1, 1].
  const clamped = Math.min(1, Math.max(-1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/** A computed joint angle plus the confidence we have in it. */
export interface JointAngle {
  /** Angle in degrees, [0, 180]. */
  readonly degrees: number;
  /** Confidence = the weakest of the three contributing keypoints. */
  readonly confidence: number;
}

/**
 * Compute the angle at `bIdx` formed by keypoints `aIdx`-`bIdx`-`cIdx`.
 * Returns `null` when any of the three keypoints is below `minScore`, so the
 * UI can show "—" instead of a misleading number from an unreliable keypoint.
 */
export function jointAngle(
  keypoints: Keypoints,
  aIdx: number,
  bIdx: number,
  cIdx: number,
  minScore = 0.3,
): JointAngle | null {
  const a = keypoints[aIdx];
  const b = keypoints[bIdx];
  const c = keypoints[cIdx];
  if (!a || !b || !c) {
    return null;
  }
  const confidence = Math.min(a.score, b.score, c.score);
  if (confidence < minScore) {
    return null;
  }
  const degrees = angleABC(a, b, c);
  if (Number.isNaN(degrees)) {
    return null;
  }
  return { degrees, confidence };
}

/**
 * The four joint angles the demo tracks for bowling-approach analysis:
 * both elbows (shoulder-elbow-wrist) and both knees (hip-knee-ankle).
 * Any field is `null` when its keypoints are not confident enough.
 */
export interface BodyAngles {
  readonly leftElbow: JointAngle | null;
  readonly rightElbow: JointAngle | null;
  readonly leftKnee: JointAngle | null;
  readonly rightKnee: JointAngle | null;
}

/** Compute both elbow and both knee angles from a set of keypoints. */
export function computeBodyAngles(keypoints: Keypoints, minScore = 0.3): BodyAngles {
  return {
    leftElbow: jointAngle(
      keypoints,
      KEYPOINT.leftShoulder,
      KEYPOINT.leftElbow,
      KEYPOINT.leftWrist,
      minScore,
    ),
    rightElbow: jointAngle(
      keypoints,
      KEYPOINT.rightShoulder,
      KEYPOINT.rightElbow,
      KEYPOINT.rightWrist,
      minScore,
    ),
    leftKnee: jointAngle(
      keypoints,
      KEYPOINT.leftHip,
      KEYPOINT.leftKnee,
      KEYPOINT.leftAnkle,
      minScore,
    ),
    rightKnee: jointAngle(
      keypoints,
      KEYPOINT.rightHip,
      KEYPOINT.rightKnee,
      KEYPOINT.rightAnkle,
      minScore,
    ),
  };
}
