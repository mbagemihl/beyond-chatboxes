import { test, expect, ConsoleMessage, Route } from '@playwright/test';

/**
 * Smoke test for /pose/still (workshop Act 2a): the browser model runs once on
 * the bundled still image, and "Compare with backend" overlays the server's
 * answer. The backend is mocked, as in benchmark.smoke.spec.ts.
 */

const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /^\s*(INFO|WARNING|ERROR):/, // native LiteRT runtime diagnostics
  /WebGPU/i,
  /GPU adapter/i,
  /No available adapters/i,
  /favicon\.ico/i,
];

const NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

test('/pose/still runs the model on one image and compares with the backend', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !IGNORED_ERROR_PATTERNS.some((re) => re.test(msg.text()))) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.route('**/api/infer/pose', (route: Route) =>
    route.fulfill({
      json: {
        keypoints: NAMES.map((name, i) => ({ name, x: 0.4, y: 0.1 + i * 0.05, score: 0.8 })),
        inferenceMs: 6.5,
        modelName: 'MoveNet SinglePose Lightning · ONNX (mock)',
        backend: 'onnxruntime',
      },
    }),
  );

  await page.goto('/pose/still');
  await expect(page.locator('app-pose-hud .badge')).toHaveText(/webgpu|wasm/i, {
    timeout: 60_000,
  });
  // The browser row gets a real inference time.
  await expect(page.locator('.still__results .row').first()).toContainText(/\d+\.\d ms/, {
    timeout: 30_000,
  });
  await expect(page.locator('.still__overlay')).toHaveCount(0);

  await page.getByRole('button', { name: /compare with backend/i }).click();
  await expect(page.locator('.still__results')).toContainText('6.5 ms model');
  await expect(page.locator('.still__results')).toContainText('Largest difference');

  expect(errors, `Console errors:\n${errors.join('\n')}`).toEqual([]);
});
