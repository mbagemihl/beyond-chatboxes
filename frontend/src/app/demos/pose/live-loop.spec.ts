/**
 * Unit tests for live-loop.ts. No browser: a recording canvas stands in for
 * CanvasRenderingContext2D, a manual clock stands in for requestAnimationFrame,
 * and inferences are promises the test resolves by hand.
 */
import { Keypoint, Keypoints, NUM_KEYPOINTS, SKELETON_EDGES } from './pose-math';
import {
  Canvas2DLike,
  LiveStats,
  createFrameLoop,
  createStatsThrottle,
  drawSkeleton,
} from './live-loop';

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

/** A requestAnimationFrame you step by hand. */
class ManualFrames {
  private next = new Map<number, () => void>();
  private id = 0;
  cancelled: number[] = [];
  request = (cb: () => void): number => {
    this.next.set(++this.id, cb);
    return this.id;
  };
  cancel = (id: number): void => {
    this.cancelled.push(id);
    this.next.delete(id);
  };
  /** Run every frame callback that is currently scheduled. */
  step(): void {
    const due = [...this.next.values()];
    this.next.clear();
    due.forEach((cb) => cb());
  }
  get pending(): number {
    return this.next.size;
  }
}

/** Let resolved promise callbacks run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** An inference whose result the test decides. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createFrameLoop', () => {
  function setup(infer: () => Promise<string | null> | null) {
    const frames = new ManualFrames();
    const drawn: (string | null)[] = [];
    const results: string[] = [];
    const errors: unknown[] = [];
    const loop = createFrameLoop<string>({
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      draw: (latest) => drawn.push(latest),
      infer,
      onResult: (r) => results.push(r),
      onError: (e) => errors.push(e),
    });
    return { frames, drawn, results, errors, loop };
  }

  it('draws on every frame once started', () => {
    const { frames, drawn, loop } = setup(() => null);
    loop.start();
    frames.step();
    frames.step();
    frames.step();
    expect(drawn.length).toBe(3);
  });

  it('keeps drawing while the model is not ready (infer returns null)', () => {
    const { frames, drawn, loop } = setup(() => null);
    loop.start();
    frames.step();
    frames.step();
    expect(drawn).toEqual([null, null]);
    expect(frames.pending).toBe(1);
  });

  it('never starts a second inference while one is in flight', () => {
    let started = 0;
    const pending = deferred<string | null>();
    const { frames, loop } = setup(() => {
      started++;
      return pending.promise;
    });
    loop.start();
    frames.step();
    frames.step();
    frames.step();
    expect(started).toBe(1);
  });

  it('draws the latest finished result on later frames, and starts the next inference', async () => {
    const first = deferred<string | null>();
    const calls: Promise<string | null>[] = [first.promise];
    let started = 0;
    const { frames, drawn, results, loop } = setup(
      () => calls[started++] ?? deferred<string | null>().promise,
    );
    loop.start();
    frames.step(); // starts inference #1
    first.resolve('pose-1');
    await flush();
    frames.step(); // draws pose-1, starts inference #2
    expect(results).toEqual(['pose-1']);
    expect(drawn.at(-1)).toBe('pose-1');
    expect(started).toBe(2);
  });

  it('reports a failed inference and keeps going', async () => {
    const failing = deferred<string | null>();
    let started = 0;
    const { frames, errors, loop } = setup(() => (started++ === 0 ? failing.promise : null));
    loop.start();
    frames.step();
    failing.reject(new Error('device lost'));
    await flush();
    frames.step();
    expect(errors.length).toBe(1);
    expect(started).toBe(2);
  });

  it('stops scheduling frames after stop()', () => {
    const { frames, drawn, loop } = setup(() => null);
    loop.start();
    frames.step();
    loop.stop();
    frames.step();
    expect(drawn.length).toBe(1);
    expect(frames.pending).toBe(0);
  });

  it('drops a result that lands after stop()', async () => {
    const late = deferred<string | null>();
    const { frames, results, loop } = setup(() => late.promise);
    loop.start();
    frames.step();
    loop.stop();
    late.resolve('too late');
    await flush();
    expect(results).toEqual([]);
  });
});

describe('createStatsThrottle (stretch)', () => {
  it('publishes nothing before the interval has passed', () => {
    const stats = createStatsThrottle(500, 30, 0);
    const published: LiveStats[] = [];
    stats.record(10);
    stats.maybePublish(400, (s) => published.push(s));
    expect(published).toEqual([]);
  });

  it('publishes inferences per second and the average duration', () => {
    const stats = createStatsThrottle(500, 30, 0);
    let last: LiveStats | null = null;
    [10, 20, 30].forEach((ms) => stats.record(ms));
    stats.maybePublish(500, (s) => (last = s));
    expect(last).toEqual({ fps: 6, avgMs: 20 });
  });

  it('counts fps per interval, but averages over the last `window` durations', () => {
    const stats = createStatsThrottle(500, 2, 0);
    let last: LiveStats | null = null;
    [10, 20, 30].forEach((ms) => stats.record(ms));
    stats.maybePublish(500, () => undefined);
    stats.record(40);
    stats.maybePublish(1000, (s) => (last = s));
    expect(last).toEqual({ fps: 2, avgMs: 35 });
  });
});
