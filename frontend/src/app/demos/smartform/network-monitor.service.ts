import { Injectable, signal } from '@angular/core';

/**
 * The monitor that owns the current counters. `fetch`/`XHR` are wrapped exactly
 * once for the lifetime of the page (guarded below), so the wrappers call into
 * whichever monitor instance is currently active via this module-level ref —
 * this keeps counting correct across dev HMR reloads without re-wrapping.
 */
let activeMonitor: NetworkMonitorService | null = null;

/** Global guard so the wrappers are installed only once per page. */
const INSTALLED = Symbol.for('smartform.network-monitor.installed');

/**
 * Counts outbound network activity on the main thread so the demo can prove,
 * live on stage, that scanning a document uploads NOTHING — the whole point of
 * doing OCR in the browser. It wraps `fetch` and `XMLHttpRequest.send` once,
 * tallying the request count and the number of bytes sent in request bodies.
 *
 * Reset at the start of each scan; because recognition runs entirely in the
 * Tesseract worker against already-served, same-origin assets, the counter
 * stays at zero — the "0 bytes uploaded" badge the talk points at.
 *
 * The wrappers only observe; they never alter request behaviour.
 */
@Injectable({ providedIn: 'root' })
export class NetworkMonitorService {
  private readonly requestCountSignal = signal(0);
  private readonly bytesUploadedSignal = signal(0);

  /** Number of fetch/XHR calls observed since the last {@link reset}. */
  readonly requestCount = this.requestCountSignal.asReadonly();
  /** Total request-body bytes sent since the last {@link reset}. */
  readonly bytesUploaded = this.bytesUploadedSignal.asReadonly();

  constructor() {
    activeMonitor = this;
    installOnce();
  }

  /** Zero the counters — call immediately before starting a scan. */
  reset(): void {
    this.requestCountSignal.set(0);
    this.bytesUploadedSignal.set(0);
  }

  /** Record one observed request (called by the global fetch/XHR wrappers). */
  track(bodyBytes: number): void {
    this.requestCountSignal.update((n) => n + 1);
    this.bytesUploadedSignal.update((n) => n + bodyBytes);
  }
}

/** Wrap fetch + XHR exactly once. No-op outside the browser. */
function installOnce(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const guarded = globalThis as unknown as Record<symbol, boolean>;
  if (guarded[INSTALLED]) {
    return;
  }
  guarded[INSTALLED] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    activeMonitor?.track(byteLengthOf(init?.body));
    return originalFetch(input, init);
  };

  const proto = XMLHttpRequest.prototype;
  const originalSend = proto.send;
  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    activeMonitor?.track(byteLengthOf(body));
    originalSend.call(this, body as XMLHttpRequestBodyInit | null);
  };
}

/** Best-effort byte length of a request body (0 for bodyless GETs). */
function byteLengthOf(body: unknown): number {
  if (body == null) {
    return 0;
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body).length;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).length;
  }
  // FormData / Document / other exotic bodies: we cannot cheaply size them, but
  // for this demo no such request is ever made, so treat as unknown (0).
  return 0;
}
