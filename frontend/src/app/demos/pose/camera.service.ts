import { Injectable, signal } from '@angular/core';

/**
 * Lifecycle of the camera permission / stream, surfaced as a signal so the
 * template can react (spinner while requesting, amber banner when denied, etc).
 */
export type CameraStatus =
  | 'idle' // nothing requested yet
  | 'requesting' // getUserMedia in flight (permission prompt may be showing)
  | 'granted' // stream is live and attached to the video element
  | 'denied' // user (or policy) refused camera access
  | 'unsupported' // getUserMedia is not available in this context (e.g. non-secure origin)
  | 'error'; // any other failure (no device, hardware in use, …)

/** Where the pixels come from: the live camera or a bundled fixture file. */
export type CameraSource = 'live' | 'fixture';

/** Camera capture size requested for the pose demo (MoveNet-friendly 4:3). */
export const CAMERA_WIDTH = 640;
export const CAMERA_HEIGHT = 480;

/**
 * Wraps `getUserMedia`, requesting a 640x480 stream and attaching it to a
 * caller-provided <video>. Business logic only — the component stays thin.
 *
 * Reliability (CLAUDE.md hard rule): every failure mode is mapped to an
 * explicit {@link CameraStatus} plus a human message, never an unhandled
 * rejection or a blank screen.
 */
@Injectable({ providedIn: 'root' })
export class CameraService {
  private readonly statusSignal = signal<CameraStatus>('idle');
  private readonly errorSignal = signal<string | null>(null);
  private readonly sourceSignal = signal<CameraSource>('live');

  /** Current permission / stream status. */
  readonly status = this.statusSignal.asReadonly();
  /** Human-readable error detail when status is 'denied' | 'unsupported' | 'error'. */
  readonly error = this.errorSignal.asReadonly();
  /** 'fixture' when the video plays a bundled file instead of the camera. */
  readonly source = this.sourceSignal.asReadonly();

  private stream: MediaStream | null = null;
  /** Removes fixture-mode listeners from the video element; set by startFixture. */
  private fixtureCleanup: (() => void) | null = null;

  /**
   * Request the camera and attach it to `video`. Defaults to a 640x480
   * user-facing stream (the pose demo); callers that need a different capture
   * (e.g. the smart-form scanner wants higher resolution for OCR) pass their own
   * {@link MediaTrackConstraints}. Resolves once the stream is playing; on
   * failure it resolves too (the status signal carries the outcome) so callers
   * never need a try/catch around it.
   */
  async start(
    video: HTMLVideoElement,
    constraints: MediaTrackConstraints = {
      width: { ideal: CAMERA_WIDTH },
      height: { ideal: CAMERA_HEIGHT },
      facingMode: 'user',
    },
  ): Promise<void> {
    // Guard: getUserMedia is only present on secure origins (https / localhost).
    if (!navigator.mediaDevices?.getUserMedia) {
      this.errorSignal.set(
        'Camera API unavailable. Use https or localhost (a secure origin).',
      );
      this.statusSignal.set('unsupported');
      return;
    }

    this.sourceSignal.set('live');
    this.errorSignal.set(null);
    this.statusSignal.set('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
        audio: false,
      });
      this.stream = stream;
      video.srcObject = stream;
      // The element must be muted + playsinline (set in the template) for
      // autoplay. play() can still reject on some browsers; that is non-fatal
      // because the stream is attached and frames will flow.
      try {
        await video.play();
      } catch {
        /* autoplay policy hiccup — frames still arrive once decoded */
      }
      this.statusSignal.set('granted');
    } catch (err) {
      this.handleError(err);
    }
  }

  /**
   * Fixture mode (`?fixture=1`): loop a bundled video file through the same
   * <video> element instead of the camera — the stage fallback when lighting
   * or permissions fail. No permission prompt, no getUserMedia. A missing
   * fixture file maps to a clear 'error' status (CLAUDE.md: never a blank
   * screen), because both dev server and jar answer unknown paths with
   * index.html, which then fails to decode as video.
   */
  async startFixture(video: HTMLVideoElement, url: string): Promise<void> {
    this.stop(video);
    this.sourceSignal.set('fixture');
    this.errorSignal.set(null);
    this.statusSignal.set('requesting');

    const outcome = await new Promise<'playing' | 'failed'>((resolve) => {
      const onReady = () => resolve('playing');
      const onError = () => resolve('failed');
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.loop = true;
      video.src = url;
      video.load();
    });

    if (outcome === 'failed') {
      this.errorSignal.set(
        `Fixture video missing or unplayable (${url}). ` +
          'Run scripts/download-models.sh to fetch it.',
      );
      this.statusSignal.set('error');
      return;
    }

    // Belt and braces for a live stage: browsers may pause a muted looping
    // file video on their own (energy saver, occlusion heuristics, embedded
    // viewers). A camera MediaStream is exempt, a fixture file is not — so
    // resume shortly after any pause we did not ask for.
    let resumeTimer = 0;
    const resume = () => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        void video.play().catch(() => {
          /* still refused — the next pause event retries */
        });
      }, 300);
    };
    video.addEventListener('pause', resume);
    this.fixtureCleanup = () => {
      window.clearTimeout(resumeTimer);
      video.removeEventListener('pause', resume);
    };

    try {
      await video.play();
    } catch {
      /* autoplay policy hiccup — the element is muted, the resume handler retries */
    }
    this.statusSignal.set('granted');
  }

  /** Stop all tracks and detach from the video element. Safe to call repeatedly. */
  stop(video?: HTMLVideoElement): void {
    this.fixtureCleanup?.();
    this.fixtureCleanup = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (video) {
      video.srcObject = null;
      if (video.src) {
        video.removeAttribute('src');
        video.load();
      }
    }
    if (this.statusSignal() === 'granted') {
      this.statusSignal.set('idle');
    }
  }

  private handleError(err: unknown): void {
    const name = err instanceof DOMException ? err.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        this.errorSignal.set(
          'Camera permission denied. Allow camera access and reload.',
        );
        this.statusSignal.set('denied');
        break;
      case 'NotFoundError':
      case 'OverconstrainedError':
        this.errorSignal.set('No suitable camera device was found.');
        this.statusSignal.set('error');
        break;
      case 'NotReadableError':
        this.errorSignal.set('The camera is already in use by another app.');
        this.statusSignal.set('error');
        break;
      default:
        this.errorSignal.set(
          err instanceof Error ? err.message : 'Failed to start the camera.',
        );
        this.statusSignal.set('error');
    }
  }
}
