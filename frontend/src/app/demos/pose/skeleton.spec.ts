/** Unit tests for skeleton.ts, with a recording fake canvas. */
import { Keypoint, Keypoints, NUM_KEYPOINTS, SKELETON_EDGES } from './pose-math';
import { Canvas2DLike, drawSkeleton } from './skeleton';

/** Records every drawing call as a short string, e.g. "moveTo 10,20". */
class RecordingCanvas implements Canvas2DLike {
  calls: string[] = [];
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  beginPath(): void {
    this.calls.push('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo ${x},${y}`);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo ${x},${y}`);
  }
  stroke(): void {
    this.calls.push('stroke');
  }
  arc(x: number, y: number, r: number): void {
    this.calls.push(`arc ${x},${y}`);
  }
  fill(): void {
    this.calls.push('fill');
  }
  count(prefix: string): number {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  }
}

/** 17 keypoints, all confident, at (0.5, 0.5) unless overridden. */
function keypoints(overrides: Record<number, Partial<Keypoint>> = {}): Keypoints {
  const kps: Keypoint[] = [];
  for (let i = 0; i < NUM_KEYPOINTS; i++) {
    kps.push({ x: 0.5, y: 0.5, score: 0.9, ...overrides[i] });
  }
  return kps;
}

describe('drawSkeleton', () => {
  it('draws nothing without keypoints', () => {
    const ctx = new RecordingCanvas();
    drawSkeleton(ctx, null, 640, 480);
    expect(ctx.calls).toEqual([]);
  });

  it('draws one line per bone and one dot per keypoint when all are confident', () => {
    const ctx = new RecordingCanvas();
    drawSkeleton(ctx, keypoints(), 640, 480);
    expect(ctx.count('stroke')).toBe(SKELETON_EDGES.length);
    expect(ctx.count('fill')).toBe(NUM_KEYPOINTS);
  });

  it('maps normalized coordinates to canvas pixels (x * width, y * height)', () => {
    const ctx = new RecordingCanvas();
    drawSkeleton(ctx, keypoints({ 0: { x: 0.25, y: 0.75 } }), 640, 480);
    expect(ctx.calls).toContain('arc 160,360');
  });

  it('skips a keypoint below the threshold, and every bone touching it', () => {
    const ctx = new RecordingCanvas();
    const weak = 9; // left wrist: one bone (left elbow – left wrist)
    const bonesTouching = SKELETON_EDGES.filter(([a, b]) => a === weak || b === weak).length;
    drawSkeleton(ctx, keypoints({ [weak]: { score: 0.1 } }), 640, 480);
    expect(ctx.count('fill')).toBe(NUM_KEYPOINTS - 1);
    expect(ctx.count('stroke')).toBe(SKELETON_EDGES.length - bonesTouching);
  });

  it('draws the bones before the dots, so dots sit on top', () => {
    const ctx = new RecordingCanvas();
    drawSkeleton(ctx, keypoints(), 640, 480);
    expect(ctx.calls.lastIndexOf('stroke')).toBeLessThan(ctx.calls.indexOf('fill'));
  });

  it('uses a custom threshold and colour when given', () => {
    const ctx = new RecordingCanvas();
    drawSkeleton(ctx, keypoints({ 0: { score: 0.5 } }), 640, 480, {
      threshold: 0.6,
      color: () => 'orange',
    });
    expect(ctx.count('fill')).toBe(NUM_KEYPOINTS - 1);
    expect(ctx.fillStyle).toBe('orange');
  });
});
