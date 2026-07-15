import { generateY4m } from './fixtures/generate-y4m';
import { FIXTURE_VIDEO_PATH } from './fixture-path';

/**
 * Playwright global setup: (re)generate the fake-camera Y4M fixture that the
 * Chromium launch args point at. Runs once before any browser starts.
 */
export default function globalSetup(): void {
  generateY4m(FIXTURE_VIDEO_PATH);
}
