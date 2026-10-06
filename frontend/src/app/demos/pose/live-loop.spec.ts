/**
 * Unit tests for live-loop.ts, one block per step, in the order you implement
 * them. No browser: a manual clock stands in for requestAnimationFrame, and
 * inferences are promises the test resolves by hand.
 */
import { FrameLoop, FrameLoopOptions, LiveStats, StatsThrottle } from './live-loop';

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

/** A loop over fakes, plus everything it drew, reported and failed. */
function setup(infer: FrameLoopOptions<string>['infer'] = () => null) {
  const frames = new ManualFrames();
  const drawn: (string | null)[] = [];
  const results: string[] = [];
  const errors: unknown[] = [];
  const loop = new FrameLoop<string>({
    requestFrame: frames.request,
    cancelFrame: frames.cancel,
    draw: (latest) => drawn.push(latest),
    infer,
    onResult: (r) => results.push(r),
    onError: (e) => errors.push(e),
  });
  return { frames, drawn, results, errors, loop };
}

describe('Step 1 · scheduleNext', () => {
  it('asks the browser for one frame', () => {
    const { frames, loop } = setup();
    loop.scheduleNext();
    expect(frames.pending).toBe(1);
  });

  it('remembers the frame id, so stop() can cancel it', () => {
    const { frames, loop } = setup();
    loop.start();
    loop.stop();
    expect(frames.cancelled).toEqual([1]);
    expect(frames.pending).toBe(0);
  });
});

describe('Step 2 · tick', () => {
  it('draws on every frame once started', () => {
    const { frames, drawn, loop } = setup();
    loop.start();
    frames.step();
    frames.step();
    frames.step();
    expect(drawn).toEqual([null, null, null]);
  });

  it('schedules the next frame even when drawing throws', () => {
    const frames = new ManualFrames();
    const loop = new FrameLoop<string>({
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      draw: () => {
        throw new Error('no canvas yet');
      },
      infer: () => null,
    });
    loop.start();
    expect(() => frames.step()).toThrow('no canvas yet');
    expect(frames.pending).toBe(1);
  });

  it('does nothing after stop()', () => {
    const { frames, drawn, loop } = setup();
    loop.start();
    frames.step();
    loop.stop();
    loop.tick();
    expect(drawn.length).toBe(1);
    expect(frames.pending).toBe(0);
  });
});

describe('Step 3 · maybeStartInference', () => {
  it('starts an inference on a frame', () => {
    let started = 0;
    const { frames, loop } = setup(() => {
      started++;
      return deferred<string | null>().promise;
    });
    loop.start();
    frames.step();
    expect(started).toBe(1);
    expect(loop.inFlight).toBe(true);
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

  it('keeps going while the model is not ready (infer returns null)', () => {
    const { frames, drawn, loop } = setup(() => null);
    loop.start();
    frames.step();
    frames.step();
    expect(drawn).toEqual([null, null]);
    expect(loop.inFlight).toBe(false);
  });
});

describe('Step 4 · accept', () => {
  it('keeps the result as the latest and reports it', () => {
    const { results, loop } = setup();
    loop.start();
    loop.accept('pose-1');
    expect(loop.latest).toBe('pose-1');
    expect(results).toEqual(['pose-1']);
  });

  it('ignores a null result', () => {
    const { results, loop } = setup();
    loop.start();
    loop.accept('pose-1');
    loop.accept(null);
    expect(loop.latest).toBe('pose-1');
    expect(results).toEqual(['pose-1']);
  });

  it('drops a result that lands after stop()', () => {
    const { results, loop } = setup();
    loop.start();
    loop.stop();
    loop.accept('too late');
    expect(loop.latest).toBeNull();
    expect(results).toEqual([]);
  });
});

describe('All steps together', () => {
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
});

describe('Stretch 1 · record', () => {
  it('counts inferences', () => {
    const stats = new StatsThrottle(500, 30, 0);
    stats.record(10);
    stats.record(20);
    expect(stats.count).toBe(2);
  });

  it('keeps only the last `window` durations', () => {
    const stats = new StatsThrottle(500, 2, 0);
    [10, 20, 30].forEach((ms) => stats.record(ms));
    expect(stats.durations).toEqual([20, 30]);
  });
});

describe('Stretch 2 · averageMs', () => {
  it('is the mean of the kept durations', () => {
    const stats = new StatsThrottle(500, 30, 0);
    [10, 20, 30].forEach((ms) => stats.record(ms));
    expect(stats.averageMs()).toBe(20);
  });

  it('is 0 before the first inference', () => {
    expect(new StatsThrottle(500, 30, 0).averageMs()).toBe(0);
  });
});

describe('Stretch 3 · fps', () => {
  it('is inferences per second', () => {
    const stats = new StatsThrottle(500, 30, 0);
    [10, 20, 30].forEach((ms) => stats.record(ms));
    expect(stats.fps(500)).toBe(6);
  });
});

describe('Stretch, all together (given maybePublish)', () => {
  it('publishes nothing before the interval has passed', () => {
    const stats = new StatsThrottle(500, 30, 0);
    const published: LiveStats[] = [];
    stats.record(10);
    stats.maybePublish(400, (s) => published.push(s));
    expect(published).toEqual([]);
  });

  it('counts fps per interval, but averages over the last `window` durations', () => {
    const stats = new StatsThrottle(500, 2, 0);
    let last: LiveStats | null = null;
    [10, 20, 30].forEach((ms) => stats.record(ms));
    stats.maybePublish(500, () => undefined);
    stats.record(40);
    stats.maybePublish(1000, (s) => (last = s));
    expect(last).toEqual({ fps: 2, avgMs: 35 });
  });
});
