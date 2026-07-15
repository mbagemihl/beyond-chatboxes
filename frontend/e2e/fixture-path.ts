import { resolve } from 'node:path';

/**
 * Absolute path to the generated fake-camera fixture (see global-setup.ts).
 * Uses __dirname (Playwright transpiles its config/tests to CommonJS).
 */
export const FIXTURE_VIDEO_PATH = resolve(__dirname, 'fixtures/camera.y4m');
