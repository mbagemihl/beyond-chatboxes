import { test, expect, ConsoleMessage, Route } from '@playwright/test';

/**
 * Smoke test for the /benchmark route. It must render, bring up the local engine
 * (wasm in headless CI, WebGPU disabled per config) on the fake camera, and run
 * a full "Race" to completion producing BOTH latency bars — without console
 * errors. The backend "cloud tier" is mocked here so the test is hermetic (the
 * real server path is covered by the backend's MockMvc + DJL tests); the mock
 * still exercises the component's zod validation, interleaving and SVG render.
 */

const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /^\s*(INFO|WARNING):/, // native LiteRT runtime diagnostics
  /WebGPU/i,
  /GPU adapter/i,
  /No available adapters/i,
  /favicon\.ico/i,
];

function isIgnored(text: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(text));
}

/** A schema-valid fake pose response (17 MoveNet keypoints). */
function fakePoseResponse() {
  const names = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ];
  return {
    keypoints: names.map((name, i) => ({
      name,
      x: 0.5,
      y: 0.1 + i * 0.05,
      score: 0.8,
    })),
    inferenceMs: 6.5,
    modelName: 'MoveNet SinglePose Lightning · ONNX (mock)',
    backend: 'onnxruntime',
  };
}

test('/benchmark races local vs cloud and renders both bars', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isIgnored(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    if (!isIgnored(err.message)) {
      errors.push(`pageerror: ${err.message}`);
    }
  });

  // Mock the backend cloud tier so the smoke test needs no running server.
  await page.route('**/api/latency-config', (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { delayMs: number };
      return route.fulfill({
        json: { delayMs: body.delayMs, allowedMs: [0, 50, 150] },
      });
    }
    return route.fulfill({ json: { delayMs: 0, allowedMs: [0, 50, 150] } });
  });
  await page.route('**/api/infer/pose', (route: Route) =>
    route.fulfill({ json: fakePoseResponse() }),
  );

  await page.goto('/benchmark');
  await expect(page.locator('app-benchmark')).toBeVisible();

  // Local engine reaches a real backend (wasm in CI).
  await expect(page.locator('.bench__local-badge .badge')).toHaveText(
    /webgpu|wasm/i,
    { timeout: 60_000 },
  );

  // Race becomes enabled (camera granted + engine ready); give the fake video a
  // moment to produce a frame, then run it.
  const raceBtn = page.getByRole('button', { name: /race|running/i });
  await expect(raceBtn).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await raceBtn.click();

  // Results: both legend rows and the SVG bars render.
  await expect(page.locator('.legend__name', { hasText: 'Local' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.legend__name', { hasText: 'Cloud' })).toBeVisible();
  await expect(page.locator('.legend__breakdown')).toContainText('network share');
  await expect(page.locator('svg.chart .bar--local')).toBeVisible();
  await expect(page.locator('svg.chart .bar--cloud-server')).toBeVisible();

  expect(errors, `Console errors:\n${errors.join('\n')}`).toEqual([]);
});
