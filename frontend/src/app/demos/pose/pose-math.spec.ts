/**
 * Unit tests for the pure pose-math module. No TestBed, no DOM — just math.
 */
import {
  angleABC,
  computeBodyAngles,
  computeLetterbox,
  jointAngle,
  KEYPOINT,
  Keypoint,
  NUM_KEYPOINTS,
  parseMoveNetOutput,
  SKELETON_EDGES,
  squareToSourceNorm,
} from './pose-math';

/** Build a full 17-keypoint array, overriding specific indices. */
function makeKeypoints(overrides: Record<number, Partial<Keypoint>>): Keypoint[] {
  const kps: Keypoint[] = [];
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    kps.push({ x: 0, y: 0, score: 0, ...overrides[i] });
  }
  return kps;
}

describe('angleABC', () => {
  it('measures a right angle as 90 degrees', () => {
    const angle = angleABC({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(angle).toBeCloseTo(90, 6);
  });

  it('measures a straight line as 180 degrees', () => {
    const angle = angleABC({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(angle).toBeCloseTo(180, 6);
  });

  it('measures fully folded rays as 0 degrees', () => {
    const angle = angleABC({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(angle).toBeCloseTo(0, 6);
  });

  it('measures a 45 degree angle', () => {
    const angle = angleABC({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(angle).toBeCloseTo(45, 6);
  });

  it('returns NaN for a degenerate (coincident) vertex', () => {
    const angle = angleABC({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(Number.isNaN(angle)).toBe(true);
  });

  it('stays within [0, 180] even with floating-point drift', () => {
    // Nearly-collinear points that can push cos slightly past -1.
    const angle = angleABC({ x: -1, y: 1e-9 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThanOrEqual(180);
  });
});

describe('computeLetterbox', () => {
  it('pads the short axis for a 4:3 landscape frame into 192', () => {
    const lb = computeLetterbox(640, 480, 192);
    expect(lb.scale).toBeCloseTo(0.3, 6);
    expect(lb.scaledW).toBeCloseTo(192, 6);
    expect(lb.scaledH).toBeCloseTo(144, 6);
    expect(lb.padX).toBeCloseTo(0, 6);
    expect(lb.padY).toBeCloseTo(24, 6);
  });

  it('produces zero padding for an already-square frame', () => {
    const lb = computeLetterbox(500, 500, 192);
    expect(lb.padX).toBeCloseTo(0, 6);
    expect(lb.padY).toBeCloseTo(0, 6);
    expect(lb.scaledW).toBeCloseTo(192, 6);
  });
});

describe('squareToSourceNorm', () => {
  it('maps the square center to the source center', () => {
    const p = squareToSourceNorm(0.5, 0.5, 640, 480, 192);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });

  it('maps the top padding edge to source y=0', () => {
    // padY = 24 -> ny = 24/192 = 0.125 should map to the top of the source.
    const p = squareToSourceNorm(0.5, 24 / 192, 640, 480, 192);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('maps the bottom padding edge to source y=1', () => {
    const p = squareToSourceNorm(0.5, (192 - 24) / 192, 640, 480, 192);
    expect(p.y).toBeCloseTo(1, 6);
  });

  it('leaves x unchanged when the long axis is horizontal (no x padding)', () => {
    const p = squareToSourceNorm(0.25, 0.5, 640, 480, 192);
    expect(p.x).toBeCloseTo(0.25, 6);
  });
});

describe('parseMoveNetOutput', () => {
  it('parses [y, x, score] triples into source-normalized keypoints', () => {
    // Two keypoints worth of data; rest defaults are irrelevant here.
    const raw = new Float32Array(NUM_KEYPOINTS * 3);
    // keypoint 0 at square-center, score 0.9
    raw[0] = 0.5; // y
    raw[1] = 0.5; // x
    raw[2] = 0.9; // score
    // keypoint 1 at square top-left corner region
    raw[3] = 24 / 192; // y -> source top
    raw[4] = 0.0; // x -> source left
    raw[5] = 0.4;

    const kps = parseMoveNetOutput(raw, 640, 480, 192);
    expect(kps).toHaveLength(NUM_KEYPOINTS);
    expect(kps[0].x).toBeCloseTo(0.5, 6);
    expect(kps[0].y).toBeCloseTo(0.5, 6);
    expect(kps[0].score).toBeCloseTo(0.9, 6);
    expect(kps[1].y).toBeCloseTo(0, 6);
    expect(kps[1].x).toBeCloseTo(0, 6);
    expect(kps[1].score).toBeCloseTo(0.4, 6);
  });

  it('throws when the output tensor is too short', () => {
    expect(() => parseMoveNetOutput(new Float32Array(10), 640, 480)).toThrow();
  });
});

describe('jointAngle', () => {
  it('computes a confident right-angle joint', () => {
    // shoulder above elbow, wrist to the side => 90 degrees at the elbow.
    const kps = makeKeypoints({
      [KEYPOINT.leftShoulder]: { x: 0, y: 0, score: 0.9 },
      [KEYPOINT.leftElbow]: { x: 0, y: 1, score: 0.9 },
      [KEYPOINT.leftWrist]: { x: 1, y: 1, score: 0.9 },
    });
    const result = jointAngle(
      kps,
      KEYPOINT.leftShoulder,
      KEYPOINT.leftElbow,
      KEYPOINT.leftWrist,
    );
    expect(result).not.toBeNull();
    expect(result!.degrees).toBeCloseTo(90, 6);
    expect(result!.confidence).toBeCloseTo(0.9, 6);
  });

  it('returns null when any contributing keypoint is below minScore', () => {
    const kps = makeKeypoints({
      [KEYPOINT.leftShoulder]: { x: 0, y: 0, score: 0.9 },
      [KEYPOINT.leftElbow]: { x: 0, y: 1, score: 0.1 }, // low confidence
      [KEYPOINT.leftWrist]: { x: 1, y: 1, score: 0.9 },
    });
    const result = jointAngle(
      kps,
      KEYPOINT.leftShoulder,
      KEYPOINT.leftElbow,
      KEYPOINT.leftWrist,
      0.3,
    );
    expect(result).toBeNull();
  });

  it('reports confidence as the weakest contributing keypoint', () => {
    const kps = makeKeypoints({
      [KEYPOINT.leftShoulder]: { x: 0, y: 0, score: 0.8 },
      [KEYPOINT.leftElbow]: { x: 0, y: 1, score: 0.55 },
      [KEYPOINT.leftWrist]: { x: 1, y: 1, score: 0.7 },
    });
    const result = jointAngle(
      kps,
      KEYPOINT.leftShoulder,
      KEYPOINT.leftElbow,
      KEYPOINT.leftWrist,
    );
    expect(result!.confidence).toBeCloseTo(0.55, 6);
  });
});

describe('computeBodyAngles', () => {
  it('computes all four joints when confident and null when not', () => {
    const kps = makeKeypoints({
      // Left elbow: straight arm => 180.
      [KEYPOINT.leftShoulder]: { x: 0, y: 0, score: 0.9 },
      [KEYPOINT.leftElbow]: { x: 0, y: 1, score: 0.9 },
      [KEYPOINT.leftWrist]: { x: 0, y: 2, score: 0.9 },
      // Right knee: right angle => 90.
      [KEYPOINT.rightHip]: { x: 0, y: 0, score: 0.9 },
      [KEYPOINT.rightKnee]: { x: 0, y: 1, score: 0.9 },
      [KEYPOINT.rightAnkle]: { x: 1, y: 1, score: 0.9 },
      // Left knee has an unreliable ankle.
      [KEYPOINT.leftHip]: { x: 0, y: 0, score: 0.9 },
      [KEYPOINT.leftKnee]: { x: 0, y: 1, score: 0.9 },
      [KEYPOINT.leftAnkle]: { x: 1, y: 1, score: 0.05 },
    });
    const angles = computeBodyAngles(kps);
    expect(angles.leftElbow!.degrees).toBeCloseTo(180, 6);
    expect(angles.rightKnee!.degrees).toBeCloseTo(90, 6);
    expect(angles.leftKnee).toBeNull();
    // Right elbow keypoints all default to score 0 -> null.
    expect(angles.rightElbow).toBeNull();
  });
});

describe('SKELETON_EDGES', () => {
  it('only references valid keypoint indices', () => {
    for (const [a, b] of SKELETON_EDGES) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(NUM_KEYPOINTS);
      expect(b).toBeLessThan(NUM_KEYPOINTS);
    }
  });
});
