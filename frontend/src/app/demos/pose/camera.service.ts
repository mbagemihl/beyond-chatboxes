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

  /** Current permission / stream status. */
  readonly status = this.statusSignal.asReadonly();
  /** Human-readable error detail when status is 'denied' | 'unsupported' | 'error'. */
  readonly error = this.errorSignal.asReadonly();

  private stream: MediaStream | null = null;

  /**
   * Request the camera at 640x480 and attach it to `video`. Resolves once the
   * stream is playing; on failure it resolves too (the status signal carries the
   * outcome) so callers never need a try/catch around it.
   */
  async start(video: HTMLVideoElement): Promise<void> {
    // Guard: getUserMedia is only present on secure origins (https / localhost).
    if (!navigator.mediaDevices?.getUserMedia) {
      this.errorSignal.set(
        'Camera API unavailable. Use https or localhost (a secure origin).',
      );
      this.statusSignal.set('unsupported');
      return;
    }

    this.errorSignal.set(null);
    this.statusSignal.set('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: CAMERA_WIDTH },
          height: { ideal: CAMERA_HEIGHT },
          facingMode: 'user',
        },
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

  /** Stop all tracks and detach from the video element. Safe to call repeatedly. */
  stop(video?: HTMLVideoElement): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (video) {
      video.srcObject = null;
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
