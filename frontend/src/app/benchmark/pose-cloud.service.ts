import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  LatencyConfig,
  LatencyConfigSchema,
  PoseInferenceResponse,
  PoseInferenceResponseSchema,
} from './benchmark-schemas';

/** A single cloud inference: the validated response plus the measured round trip. */
export interface CloudInferResult extends PoseInferenceResponse {
  /** Wall-clock client round trip in ms (includes the artificial WAN delay). */
  readonly roundTripMs: number;
}

/**
 * The client for the server-side pose "cloud tier". All responses are
 * zod-validated at the boundary. Methods throw a human-readable `Error` on
 * transport/HTTP/validation failure so the component can surface it (e.g. the
 * backend's 503 when the ONNX model is not present).
 */
@Injectable({ providedIn: 'root' })
export class PoseCloudService {
  private readonly http = inject(HttpClient);

  /** POST one JPEG frame as multipart and return the validated result + round trip. */
  async infer(frame: Blob): Promise<CloudInferResult> {
    const form = new FormData();
    form.append('frame', frame, 'frame.jpg');

    const t0 = performance.now();
    let raw: unknown;
    try {
      raw = await firstValueFrom(this.http.post<unknown>('/api/infer/pose', form));
    } catch (err) {
      throw new Error(this.describe(err));
    }
    const roundTripMs = performance.now() - t0;

    const parsed = PoseInferenceResponseSchema.parse(raw);
    return { ...parsed, roundTripMs };
  }

  async getLatencyConfig(): Promise<LatencyConfig> {
    try {
      const raw = await firstValueFrom(this.http.get<unknown>('/api/latency-config'));
      return LatencyConfigSchema.parse(raw);
    } catch (err) {
      throw new Error(this.describe(err));
    }
  }

  async setLatencyConfig(delayMs: number): Promise<LatencyConfig> {
    try {
      const raw = await firstValueFrom(
        this.http.post<unknown>('/api/latency-config', { delayMs }),
      );
      return LatencyConfigSchema.parse(raw);
    } catch (err) {
      throw new Error(this.describe(err));
    }
  }

  /** Turn an HttpErrorResponse (or anything) into a message worth showing. */
  private describe(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      // The backend's ApiError body: { status, message }.
      const body = err.error as { message?: string } | string | null;
      const detail =
        typeof body === 'string' ? body : (body?.message ?? err.message);
      if (err.status === 0) {
        return 'Cannot reach the backend (is it running on :8080?).';
      }
      return `Server ${err.status}: ${detail}`;
    }
    return err instanceof Error ? err.message : String(err);
  }
}
