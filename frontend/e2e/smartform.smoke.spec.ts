import { test, expect, ConsoleMessage } from '@playwright/test';

/**
 * Smoke test for the smart-form OCR route. It must load the Tesseract worker +
 * WebAssembly core + language data — all from our own origin — reach the
 * "ready" engine state, and render the typed reactive form, without a CDN and
 * without console errors. It also asserts the "0 bytes uploaded" guarantee.
 *
 * The camera is Chromium's fake device (see playwright.config.ts), so the video
 * element is live; we do not assert OCR field extraction here (that is covered
 * exhaustively by extract-fields.spec.ts against the real receipt text).
 */

/** Tolerated console noise: worker/runtime diagnostics that are not app errors. */
const IGNORED_ERROR_PATTERNS: RegExp[] = [/^\s*(INFO|WARNING):/, /favicon\.ico/i];

function isIgnored(text: string): boolean {
  return IGNORED_ERROR_PATTERNS.some((re) => re.test(text));
}

test('/smartform loads OCR locally and never uploads', async ({ page }) => {
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

  await page.goto('/smartform');
  await expect(page.locator('app-smartform')).toBeVisible();

  // Typed reactive form is present.
  await expect(page.locator('#iban')).toBeVisible();
  await expect(page.locator('#email')).toBeVisible();

  // The OCR engine must load its self-hosted worker/core/langs and go "ready".
  const hud = page.locator('app-smartform-hud');
  await expect(hud).toContainText('wasm');
  await expect(hud).toContainText('ready', { timeout: 60_000 });

  // The camera opens on the fake device, enabling the Scan button.
  await expect(page.getByRole('button', { name: /scan document/i })).toBeEnabled({
    timeout: 30_000,
  });

  // Nothing has been uploaded, and nothing left our origin.
  await expect(page.locator('.sf__net')).toContainText('0 bytes uploaded');
  expect(offOrigin, `Off-origin requests:\n${offOrigin.join('\n')}`).toEqual([]);
  expect(errors, `Console errors:\n${errors.join('\n')}`).toEqual([]);
});
