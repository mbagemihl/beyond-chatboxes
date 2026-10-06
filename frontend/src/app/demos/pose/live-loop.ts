/**
 * live-loop.ts — the real-time half of the pose demo: drive camera frames
 * through the model without ever blocking the page.
 *
 * Two ideas carry the whole act:
 *   * paint EVERY display frame (requestAnimationFrame, ~60 fps), whatever the
 *     model is doing;
 *   * run the model as often as it keeps up, but never more than ONE inference
 *     at a time. Queueing more would only make every result older by the time
 *     it is drawn.
 *
 * Each step is one small method. `start`, `stop` and `track` are written for
 * you: read them to see where your steps fit. Drawing the skeleton itself is
 * given too, in skeleton.ts.
 *
 * Kept free of Angular and of real browser globals: the frame scheduler and
 * the model are passed in, so live-loop.spec.ts can check each step with fakes
 * (a manual clock, inferences the test resolves by hand).
 */

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

export class FrameLoop<T> {
  /** Between start() and stop(). */
  running = false;
  /** An inference has started and not finished yet. */
  inFlight = false;
  /** The latest finished result, drawn on every frame (null until the first). */
  latest: T | null = null;
  /** The id of the scheduled frame, so stop() can cancel it. */
  frameId = 0;

  constructor(private readonly options: FrameLoopOptions<T>) {}

  /** Start the loop. Calling it twice still runs one loop. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNext();
  }

  /** Stop scheduling frames; a result that lands later is dropped (step 4). */
  stop(): void {
    this.running = false;
    this.options.cancelFrame(this.frameId);
  }

  /**
   * Step 1 — Ask the browser to call `tick` on the next display frame, and
   * remember the frame's id (so stop() can cancel it).
   */
  scheduleNext(): void {
    this.frameId = this.options.requestFrame(() => this.tick());
  }

  /**
   * Step 2 — One display frame. Unless the loop was stopped:
   *   1. schedule the NEXT frame first, so a throwing `draw` cannot end the loop;
   *   2. draw the latest result;
   *   3. maybe start an inference (step 3).
   */
  tick(): void {
    if (!this.running) {
      return;
    }
    this.scheduleNext();
    this.options.draw(this.latest);
    this.maybeStartInference();
  }

  /**
   * Step 3 — Start an inference, unless one is already in flight. `infer()`
   * returns null while the model is not ready: then there is nothing to track.
   */
  maybeStartInference(): void {
    if (this.inFlight) {
      return;
    }
    const pending = this.options.infer();
    if (pending) {
      this.track(pending);
    }
  }

  /** Mark the inference in flight until it settles, and hand its result to step 4. */
  track(pending: Promise<T | null>): void {
    this.inFlight = true;
    pending
      .then((result) => this.accept(result))
      .catch((err: unknown) => this.options.onError?.(err))
      .finally(() => {
        this.inFlight = false;
      });
  }

  /**
   * Step 4 — A finished inference. Keep it as the latest result and report it
   * with `onResult`, but only if it is a result (not null) and the loop is
   * still running: a result that lands after stop() is dropped.
   */
  accept(result: T | null): void {
    if (this.running && result !== null) {
      this.latest = result;
      this.options.onResult?.(result);
    }
  }
}

/** A frame loop over `options`; call start() to run it. */
export function createFrameLoop<T>(options: FrameLoopOptions<T>): FrameLoop<T> {
  return new FrameLoop(options);
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

/**
 * Turns per-frame measurements into HUD numbers without re-rendering the page
 * 60 times a second: the HUD's signals are updated at most once per
 * `intervalMs`.
 */
export class StatsThrottle {
  /** Finished inferences since the last publish. */
  count = 0;
  /** The durations of the last `window` inferences, oldest first. */
  durations: number[] = [];
  private lastPublish: number;

  constructor(
    private readonly intervalMs: number,
    private readonly window: number,
    startedAt: number,
  ) {
    this.lastPublish = startedAt;
  }

  /**
   * Stretch 1 — Record one finished inference: count it, and keep its duration
   * — but only the last `window` durations.
   */
  record(ms: number): void {
    this.count++;
    this.durations.push(ms);
    if (this.durations.length > this.window) {
      this.durations.shift();
    }
  }

  /** Stretch 2 — The mean of the kept durations, or 0 when there are none. */
  averageMs(): number {
    if (this.durations.length === 0) {
      return 0;
    }
    return this.durations.reduce((sum, ms) => sum + ms, 0) / this.durations.length;
  }

  /** Stretch 3 — Inferences per second: the count over `elapsedMs` milliseconds. */
  fps(elapsedMs: number): number {
    return (this.count * 1000) / elapsedMs;
  }

  /** Call every frame; calls `publish` at most once per interval, then starts a new count. */
  maybePublish(now: number, publish: (stats: LiveStats) => void): void {
    const elapsed = now - this.lastPublish;
    if (elapsed < this.intervalMs) {
      return;
    }
    publish({ fps: this.fps(elapsed), avgMs: this.averageMs() });
    this.count = 0;
    this.lastPublish = now;
  }
}

/** HUD stats published every `intervalMs`, averaged over `window` inferences. */
export function createStatsThrottle(
  intervalMs: number,
  window: number,
  startedAt: number,
): StatsThrottle {
  return new StatsThrottle(intervalMs, window, startedAt);
}
