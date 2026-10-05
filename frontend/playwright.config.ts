import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_VIDEO_PATH } from './e2e/fixture-path';

/**
 * The dev-server port. Override with E2E_PORT when 4200 is taken, e.g. by
 * another checkout's `ng serve`: the server is reused when present, so the
 * tests would otherwise silently run against the wrong app.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 4200);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Playwright config for the demo smoke tests.
 *
 * The camera is mocked with Chromium's fake device, fed by a generated Y4M clip
 * (see e2e/global-setup.ts). Combined with a granted camera permission this
 * lets the pose route run real inference headlessly.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${FIXTURE_VIDEO_PATH}`,
        // Disable WebGPU so the smoke test deterministically exercises the wasm
        // fallback path (the "≥20fps on wasm" target). Headless CI has no real
        // GPU: WebGPU there compiles but fails at invoke time, so testing it is
        // neither representative nor stable.
        '--disable-features=WebGPU',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `npm start -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
  },
});
