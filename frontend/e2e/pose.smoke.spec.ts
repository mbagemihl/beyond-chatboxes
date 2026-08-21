import { test, expect, ConsoleMessage } from '@playwright/test';

/**
 * Smoke test for the demo routes: each must render and reach a working state
 * without logging console errors or throwing uncaught exceptions. The camera is
 * mocked by Chromium's fake device (see playwright.config.ts).
 */

const DEMO_ROUTES = ['/pose'];

/**
 * Console errors we tolerate: third-party noise that does not indicate a broken
 * demo. Keep this list tight — real app errors and uncaught exceptions must
 * still fail the test.
 *
 * The LiteRT.js runtime routes its native INFO/WARNING diagnostics to
 * console.error; those are not application errors. A GPU-less CI box also emits
 * WebGPU-probe noise, which the engine handles by falling back to wasm.
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

for (const route of DEMO_ROUTES) {
  test(`${route} renders without console errors`, async ({ page }) => {
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

    await page.goto(route);

    // The stage and its canvas must be present.
    await expect(page.locator('app-pose')).toBeVisible();
    await expect(page.locator('canvas.pose__canvas')).toBeVisible();

    // The engine must reach a real backend (webgpu or wasm) — proving the wasm
    // runtime loaded and the model compiled. Generous timeout for model load.
    const badge = page.locator('app-pose-hud .badge').first();
    await expect(badge).toHaveText(/webgpu|wasm/i, { timeout: 60_000 });

    // No blocking error overlay should be shown.
    await expect(page.locator('.pose__overlay')).toHaveCount(0);

    // The angle panel renders all four joints.
    await expect(page.locator('app-pose-angle-panel .row')).toHaveCount(4);

    // Let a few inference frames run, then assert the fps stat advanced past 0.
    await page.waitForTimeout(3_000);
    const fpsText = await page.locator('app-pose-hud .stat', { hasText: 'fps' })
      .locator('.value')
      .innerText();
    expect(Number.parseFloat(fpsText)).toBeGreaterThan(0);

    expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toEqual(
      [],
    );
  });
}
