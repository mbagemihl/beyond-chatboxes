/**
 * pose-math.ts — pure, framework-free geometry for MoveNet SinglePose.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WORKSHOP BLOCK 1 — Pixels in, keypoints out                             │
 * │                                                                         │
 * │ A model is a function from one fixed-shape tensor to another. Almost    │
 * │ all the real work happens on either side of it: a 640x480 camera frame  │
 * │ is not a 192x192 tensor, and the model's 51 output numbers are not a    │
 * │ skeleton until you decode them.                                         │
 * │                                                                         │
 * │ Implement the functions marked TODO below.                              │
 * │   Check your work:  make verify-1                                       │
 * │   Stuck?            make solve-1                                        │
 * │                                                                         │
 * │ The demo runs before you start — it just draws nothing, because every   │
 * │ keypoint comes back with confidence 0. Watch it come alive.             │
 * │   http://localhost:4200/pose?fixture=1                                  │
 * └─────────────────────────────────────────────────────────────────────────┘
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
 * TODO (block 1, core) — Compute the letterbox geometry for fitting
 * `srcW x srcH` into a centered square of side `square`, preserving aspect
 * ratio.
 *
 * Why this matters: squashing a 4:3 frame into a square would distort every
 * body it sees, and the model was not trained on distorted people. Instead scale
 * by the LONG axis so the whole frame fits, then pad the short axis equally on
 * both sides — the same thing TensorFlow's `resize_with_pad` does.
 *
 *   scale     = square / max(srcW, srcH)
 *   scaledW/H = the source multiplied by that scale
 *   padX/padY = the leftover space on each axis, split in half
 *
 * The stub below stretches the frame to fill the square (scale 1, no padding),
 * which is exactly the bug this function exists to prevent.
 */
export function computeLetterbox(
  srcW: number,
  srcH: number,
  square: number = MOVENET_INPUT_SIZE,
): Letterbox {
  return { scale: 1, scaledW: square, scaledH: square, padX: 0, padY: 0 };
}

/**
 * TODO (block 1, core) — Convert a coordinate that is normalized over the padded
 * `square x square` model input back into a coordinate normalized over the
 * original source frame. This inverts {@link computeLetterbox}.
 *
 * The model reports positions in ITS OWN padded square space. To draw on the
 * source frame you must undo the padding and the scale, in that order:
 * multiply the normalized value up to square pixels, subtract the padding, then
 * divide by the scaled size.
 *
 * Get this wrong and the skeleton is subtly offset from the body — the classic
 * "it almost works" bug of on-device vision.
 */
export function squareToSourceNorm(
  nx: number,
  ny: number,
  srcW: number,
  srcH: number,
  square: number = MOVENET_INPUT_SIZE,
): Point {
  return { x: 0, y: 0 };
}

/**
 * TODO (block 1, core) — Parse a raw MoveNet SinglePose output tensor into
 * keypoints in source-frame normalized coordinates.
 *
 * The output tensor has shape [1, 1, 17, 3]; flattened it is 51 numbers, three
 * per keypoint in the order **[y, x, score]** — note y comes FIRST, which is the
 * single most common mistake here. y and x are normalized over the padded square
 * input, so each pair needs {@link squareToSourceNorm} applied to it.
 *
 * Return exactly {@link NUM_KEYPOINTS} keypoints, in model order. The length
 * guard below is given; keep it.
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
  // Every keypoint scored 0 means nothing is drawn and no angle is computed —
  // a working app with an empty overlay, until you implement this.
  const keypoints: Keypoint[] = [];
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    keypoints.push({ x: 0, y: 0, score: 0 });
  }
  return keypoints;
}

/**
 * TODO (block 1, stretch) — Interior angle, in degrees, at vertex `b` formed by
 * the rays b->a and b->c. Return a value in [0, 180], or `NaN` if either ray has
 * zero length (degenerate — coincident points).
 *
 * The dot product of the two rays, divided by the product of their magnitudes,
 * is the cosine of the angle between them; `Math.acos` recovers the angle, and
 * `Math.hypot` gives you a magnitude. Clamp the cosine into [-1, 1] before
 * calling acos — floating-point drift will otherwise hand you NaN for angles
 * that are exactly 0 or 180 degrees.
 */
export function angleABC(a: Point, b: Point, c: Point): number {
  return NaN;
}

/** A computed joint angle plus the confidence we have in it. */
export interface JointAngle {
  /** Angle in degrees, [0, 180]. */
  readonly degrees: number;
  /** Confidence = the weakest of the three contributing keypoints. */
  readonly confidence: number;
}

/**
 * TODO (block 1, stretch) — Compute the angle at `bIdx` formed by keypoints
 * `aIdx`-`bIdx`-`cIdx`.
 *
 * Return `null` when any of the three keypoints is missing or below `minScore`,
 * so the UI shows "—" instead of a confident-looking number derived from a
 * keypoint the model was unsure about. Refusing to answer is a feature: this is
 * the difference between a demo that lies and one you can trust.
 *
 * The confidence of the angle is the weakest of its three keypoints.
 */
export function jointAngle(
  keypoints: Keypoints,
  aIdx: number,
  bIdx: number,
  cIdx: number,
  minScore = 0.3,
): JointAngle | null {
  return null;
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

/**
 * TODO (block 1, stretch) — Compute both elbow and both knee angles from a set
 * of keypoints, using {@link jointAngle} and the {@link KEYPOINT} indices.
 *
 * An elbow is shoulder-elbow-wrist; a knee is hip-knee-ankle.
 */
export function computeBodyAngles(keypoints: Keypoints, minScore = 0.3): BodyAngles {
  return { leftElbow: null, rightElbow: null, leftKnee: null, rightKnee: null };
}
