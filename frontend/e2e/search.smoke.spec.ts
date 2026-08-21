import { test, expect, ConsoleMessage } from '@playwright/test';

/**
 * Smoke test for the semantic-search route. It must load the embedding model in
 * the worker, index the corpus, and answer a semantic query — all without a CDN
 * and without logging console errors.
 *
 * WebGPU is disabled in playwright.config.ts, so this deterministically
 * exercises the wasm (q8) fallback path that CI hardware can actually run.
 */

/**
 * Tolerated console noise: onnxruntime-web / native runtime diagnostics that are
 * not application errors. Keep this tight — real app errors and uncaught
 * exceptions must still fail the test.
 */
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /^\s*(INFO|WARNING):/, // native runtime diagnostics
  /onnxruntime/i,
  /WebGPU/i,
  /GPU adapter/i,
  /No available adapters/i,
  /favicon\.ico/i,
];

function isIgnored(text: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(text));
}

test('/search embeds locally and ranks by meaning', async ({ page }) => {
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

  // Fail loudly if anything is fetched from outside our own origin (the hard
  // "no CDN at runtime" rule). Same-origin and data/blob URLs are fine.
  const offOrigin: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (!/^(https?:\/\/localhost:4200|data:|blob:)/.test(url)) {
      offOrigin.push(url);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('/search');
  await expect(page.locator('app-search')).toBeVisible();

  // The worker must load the model on a real backend and finish indexing.
  const hud = page.locator('app-search-hud');
  await expect(hud).toContainText(/webgpu|wasm/i, { timeout: 60_000 });
  await expect(hud).toContainText('ready', { timeout: 60_000 });

  // Semantic query: "doctor" must surface the "sick leave / unwell" talk even
  // though that word never appears in it — the whole point of the demo.
  await page.fill('.search__input', 'doctor');
  const results = page.locator('.result');
  await expect(results.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.results')).toContainText(/Wellbeing and Burnout/i);

  // Keyword mode is pure substring matching, so "doctor" must find nothing —
  // the contrast the talk demonstrates live.
  await page.getByRole('checkbox').check();
  await expect(page.locator('.search__empty')).toBeVisible();
  await expect(results).toHaveCount(0);

  expect(offOrigin, `Off-origin requests:\n${offOrigin.join('\n')}`).toEqual([]);
  expect(errors, `Console errors:\n${errors.join('\n')}`).toEqual([]);
});
