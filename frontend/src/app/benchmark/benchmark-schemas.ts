import { z } from 'zod';

/**
 * zod schemas for the backend "cloud tier" responses. Per CLAUDE.md, every
 * backend response is validated with zod BEFORE it enters a signal, so a shape
 * change or a proxy returning HTML never silently corrupts the UI — it fails
 * loudly at the edge instead.
 */

export const KeypointSchema = z.object({
  name: z.string(),
  x: z.number(),
  y: z.number(),
  score: z.number(),
});

export const PoseInferenceResponseSchema = z.object({
  keypoints: z.array(KeypointSchema),
  /** Server-side model time only (not the round trip), in ms. */
  inferenceMs: z.number(),
  modelName: z.string(),
  backend: z.string(),
});
export type PoseInferenceResponse = z.infer<typeof PoseInferenceResponseSchema>;

export const LatencyConfigSchema = z.object({
  delayMs: z.number(),
  allowedMs: z.array(z.number()),
});
export type LatencyConfig = z.infer<typeof LatencyConfigSchema>;
